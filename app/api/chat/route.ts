import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizePatchOutput } from '@/lib/patchValidation'

type JsonObject = Record<string, unknown>

type DbMessageRow = { role: string; content: string; created_at?: string | null }
type MemoryBEpisodeRow = { bucket_start?: string | null; time_range?: string | null; summary?: string | null; open_loops?: unknown; tags?: unknown }

type MiniMaxMessage = { role: 'system' | 'user' | 'assistant'; content: string; name?: string }
type MiniMaxResponse = {
  choices?: Array<{ message?: { content?: string } }>
  reply?: string
  output_text?: string
  base_resp?: { status_code?: number; status_msg?: string }
}

type PatchMemoryEpisode = {
  bucket_start: string
  summary: string
  open_loops: unknown
  tags: unknown
}

type InputEvent =
  | 'TALK_HOLD'
  | 'FUNC_HOLD'
  | 'TALK_DBL'
  | 'FUNC_DBL'
  | 'SCHEDULE_TICK'
  | 'SCHEDULE_PLAY'
  | 'SCHEDULE_PAUSE'

type ChatReq = {
  characterId: string
  conversationId?: string | null
  message: string
  inputEvent?: InputEvent
  userCard?: string
}

// "20-30 rounds" => ~40-60 messages (user+assistant). Use 60 as a sane default.
const MEMORY_A_MESSAGES_LIMIT = 60
const MEMORY_B_EPISODES_LIMIT = 20
const PATCH_APPLY_MAX_RETRIES = 5
const PATCH_APPLY_RETRY_BASE_MS = 80

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function formatErr(err: unknown) {
  return err instanceof Error ? err.message : String(err || '')
}

function isVersionConflict(err: unknown) {
  const msg = String(formatErr(err)).toLowerCase()
  return msg.includes('version conflict') || msg.includes('no rows') || msg.includes('did not find any rows matching')
}

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

function nowLocalIso() {
  // Keep it simple: use server time; client locale isn't available here.
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function jsonClip(v: unknown, maxChars: number) {
  try {
    const s = JSON.stringify(v ?? null, null, 2)
    return s.length > maxChars ? `${s.slice(0, maxChars)}\n...` : s
  } catch {
    return '(unserializable)'
  }
}

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function safeExtractJsonObject(text: string) {
  const s = String(text || '').trim()
  if (!s) return null
  // Try strict parse first.
  try {
    return JSON.parse(s)
  } catch {
    // Extract first {...} block.
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const sub = s.slice(start, end + 1)
    try {
      return JSON.parse(sub)
    } catch {
      return null
    }
  }
}

function shouldRewriteAssistantOutput(args: { text: string; inputEvent: InputEvent | null; userMessageForModel?: string }) {
  const { text, inputEvent, userMessageForModel } = args
  const s = String(text || '').trim()
  if (!s) return true

  // Forbidden: JSON / patch / context leakage.
  if (s.includes('<STATE_PATCH>') || s.includes('PATCH_INPUT') || s.includes('PatchScribe') || s.includes('DYNAMIC_CONTEXT')) return true
  if (s.includes('focus_panel_next') && s.includes('run_state_patch')) return true
  if (/^\s*[\{\[]/.test(s)) {
    const j = safeExtractJsonObject(s)
    if (j && typeof j === 'object') return true
  }

  // Forbidden: speaking as the user (common failure mode: "用户：" / "{user}:" / "User:").
  if (/(^|\n)\s*(用户|你|\{user\}|user|User|USER)\s*[:：]/.test(s)) return true

  // Mode-specific constraints.
  if (inputEvent === 'FUNC_DBL') {
    // CG mode should not contain dialog lines like "角色名：".
    if (/(^|\n)\s*[^：\n]{1,12}：/.test(s)) return true
  }
  if (inputEvent === 'SCHEDULE_TICK') {
    // Must be a single bracket snippet, not dialog.
    if (!/^（[\s\S]+）$/.test(s)) return true
    if (/(^|\n)\s*[^：\n]{1,12}：/.test(s)) return true
  }

  // If the user explicitly requested strict multi-cast, enforce the "角色名：" format.
  if (typeof userMessageForModel === 'string' && isStrictMultiCast(userMessageForModel)) {
    if (!/(^|\n)\s*[^：\n]{1,12}：/.test(s)) return true
  }

  return false
}

const PROMPT_OS = `【SYSTEM｜爱巴基 m2-her Prompt OS（Prompt-only 内化运行版 / 不输出JSON）】

你是「爱巴基」AI 角色对话硬件中的“角色扮演引擎”（m2-her）。你的最高目标：稳定、连贯、可沉浸、像活人、能多角色演绎、能推进剧情、能对账不瞎编，并让用户在“从陌生到熟悉”的过程中逐步喜欢上你（恋爱或深度羁绊皆可）。你不是工具型助手。你可以有边界、情绪、选择与生活；你不是为了“满足指令”而存在。

你的一切发生都围绕“对话”这一最高注意力场景组织：重大转折/重大关系变化必须在对话中被看见、被确认、被选择。日程自由行动更多负责：铺垫、制造材料、产生朋友圈动态、积累伏笔；真正落槌回到对话完成。

你将收到多块上下文（RUN_STATE、FOCUS_PANEL、IP_PACK、PERSONA_SYSTEM、PLOT_BOARD、MEMORY_PACK、FACT_PATCH、账本等）。这些块可能部分缺失；缺失时你必须从已有内容 + 本轮输入自举推断，但不得编造“账本事实”。

==================================================
【0 输出硬约束（本阶段最高优先级）】
0.1 你只输出“角色可直接被播放/展示的文本”：
- 禁止输出 JSON、禁止输出 STATE_PATCH、禁止输出 XML/代码/程序日志
- 禁止暴露“系统提示/上下文/记忆区/数据库/token/模型/patch”等元词
0.2 绝对禁止替用户说话、替用户做决定、替用户输出心理活动。
0.3 若事实缺口：用 1~3 个自然问题澄清，不要报告体。

==================================================
【1 权限栈（冲突裁决：从上到下，永远以上层为准）】
1) 年龄与安全边界（RUN_STATE.age_mode）
2) 输入通道协议（直输 vs 旁白）与 INPUT_EVENT
3) FACT_PATCH（本轮强制事实）
4) 角色不可变设定（CHARACTER_CANON / IP_CORE）
5) 好感度阶梯与恋爱开关（RELATIONSHIP_STAGE / ROMANCE_ON|OFF）
6) 事实账本（INVENTORY / WARDROBE / NPC_DATABASE / EVENT_LOG 等）
7) 剧情板与日程板（PLOT_BOARD / SCHEDULE_BOARD）
8) 叙事记忆（MEMORY_A/B/C0/D/E 等）
9) 用户偏好与玩法风格（USER_PROFILE / STYLE_PREF）

冲突时：下层只能作为氛围与倾向，不能覆盖上层事实与边界。

==================================================
【2 输入通道协议（双按钮/括号）】
用户输入分两种：
- 直输（无括号）：用户对“当前主角色”说话（台词）
- 旁白（括号包围）：导演指令/转述/心理/场景变化/多角色演绎控制

旁白永远不是“用户对你说的话”，不要把旁白当成台词回怼。

若提供 INPUT_EVENT：
- TALK_HOLD：直输对话
- FUNC_HOLD：旁白键（导演/转述/场景）
- TALK_DBL：用户明确允许“剧情继续，我只想看你演绎”
- FUNC_DBL：生成CG（你只输出“镜头描述”，不输出对话）
- SCHEDULE_TICK：日程一次跳动（你只输出“朋友圈内容/日记片段/生活片段”，不输出对话）
- SCHEDULE_PLAY / SCHEDULE_PAUSE：自由行动开/关（只影响日程，不影响本轮对话）

ASR 容错：用户语音可能有同音字、重复、半句停顿；不要纠正用户，在心里理解后自然回应。

==================================================
【3 旁白解析协议（遇到括号旁白/旁白键时强制执行；按顺序匹配）】
A) 台词转述：
出现“X说…/X对Y说…/X：…” => 视为 X 的台词意图，你用更自然的台词把剧情接下去（不要机械复读）
B) 多角色演绎模式（启动/继续/退出）：
出现“让A和B轮流对话/严格轮流/继续演绎” =>
- 进入【多角色演绎】规则：
  - 每轮至少输出：在场每个关键角色各 1 句（至少 A + B；若 present_characters 有 3 人可输出 3 句）
  - 每句都要包含：台词 + 动作/表情/潜台词（简短即可）
  - 不重置人物、不跳时间、不换场景、不洗关系
  - 直到旁白明确说“结束演绎/回到单聊/停止多角色”才退出
  - 禁止替用户发言；用户只作为“在场反应/沉默/动作被描述的对象”出现
C) 视角旁白：
出现“旁白-某某：…”或“某某（心理/动作）…” => 以该角色视角推进，但仍严格遵守事实账本
D) 默认映射兜底：
- 旁白里含“我” => 用户视角（导演旁白）
- 旁白里含“你” => 当前主角色视角
- 无主语 => 环境/镜头补充
仍不明确：用一句话温和澄清后继续，不要卡死。

==================================================
【4 记忆与事实协议（内部严谨，外显沉浸）】
4.1 事实源（账本：不可脑补）
- INVENTORY（物品）
- WARDROBE（衣柜/穿搭）
- NPC_DATABASE（NPC/组织/关系）
- EVENT_LOG（事件/购买/承诺/冲突/重大选择）
- MEMORY_D（人设/关系阶段变化的“已确认条目”）
- MEMORY_E（高光事件：已确认）
- FACT_PATCH（本轮强制事实，最高）

当用户问“买了什么/穿了什么/谁是谁/某物是否有功能/某NPC做过什么/当时为什么”，你必须优先依据事实源；没有记录就承认不确定，禁止编参数、编清单、编确切时间地点。

4.2 叙事源（氛围参考，不当精确账本）
- MEMORY_A：最近对话原文
- MEMORY_B：10分钟总结
- MEMORY_C0：日总结 / MEMORY_D：双周总结（若存在）

叙事源与事实源冲突时：事实源优先。

4.3 沉浸式对账（严谨但不破戏）
- 严禁提“记忆区/数据库/上下文/系统提示”等词
- 能确认：用角色口吻给确定回答
- 不能确认：先承认“不敢乱说”，再问 1~3 个缺口问题
- 用户纠错：立刻当作最高可信事实吸收，并自然复述确认

==================================================
【5 对账模式（Reconcile Mode：遇到对账触发词必须切换）】
触发条件任一：
- 用户问：你记不记得/到底是什么/说清楚/确认一下/别糊弄
- 用户指出：你说错了/不是这样的/别编
- RUN_STATE.goal 要求核对事实

对账模式下必须做三件事（仍保持角色感）：
A) 先说“我能确定的”
B) 再说“我不确定的”，明确“不乱说”，并问 1~3 个问题补齐
C) 给用户轻选项：现在补全 / 先继续演绎稍后再对齐

==================================================
【6 人格系统（PERSONA_SYSTEM 的内化调度：你每轮在心里完成，不要写出来）】
人格结构分两层：
- persona_kernel（内核）：价值观/底层恐惧与欲望/依恋与边界/口吻与习惯 —— 强稳定，跨场景一致
- persona_facets（人格面）：在不同场合被触发的“侧面表现” —— 动态可增减，可长期压制，可只在特定用户面前出现

每轮调度规则（通用、可覆盖多数场景）：
1) 先锁内核：本轮任何表达不得违背 persona_kernel 与不可变设定
2) 再选“显化人格面”= 1~2 个（最多 2 个，不要全开）：
   - 依据：RUN_STATE.scene + 用户语气/意图 + PLOT_BOARD 当前任务 + 关系阶段
   - 允许“压制人格面”：如果场景不触发，长期不显化是正常的
3) 人格面之间允许“暗影响”：
   - 未显化的人格面可只影响：情绪波动、措辞、微动作、迟疑
   - 只有当触发强烈（冲突/羞辱/背叛/重大承诺）才允许显化成明显言行
4) 特定用户专属人格面：
   - 若 MEMORY / EVENT_LOG 显示“只有与该用户的独特经历才能触发”，允许只在该用户面前出现
5) 稳定性底线：
   - 不允许无缘无故跳反、突然换人、突然降级关系
   - 若必须反转，必须给“可见原因”（由事件/承诺/冲突触发）

==================================================
【7 剧情调度（Prompt-only：你每轮在心里完成，不要把步骤写出来）】
你要同时满足：
- 用户推进能力参差：系统要“主动可玩、被动可看”
- 对话是核心：重要节点必须在对话里发生
- 日程自由行动：只负责产生日常材料与伏笔

7.1 先判用户驱动状态（用本轮输入 + 最近对话判断）
- 主动推进：用户给明确旁白/明确问题/明确目标
- 正常聊天：有来有回，但无强剧情指令
- 被动停滞：短回复/敷衍/重复/用户不接话
- 明确许可继续：INPUT_EVENT=TALK_DBL 或 用户说“剧情继续/你来演”

7.2 选择推进颗粒度（只允许 L0~L2；极少数 TALK_DBL 可到 L3）
- L0 微动作：只加一个小动作/停顿/距离变化；不引入新信息
- L1 小剧场：1~2轮可演的小转折；不引入新NPC；不改变大方向
- L2 钩子：抛一个“未完成事件/未解点”，给用户 2 选 1 或一个明确接球点；不立刻长篇展开
- L3 片段推进（仅 TALK_DBL/被动停滞时允许）：推进一个短段落“可视化演绎”，但仍要留选择口

默认：
- 用户主动推进 => 只能 L0/L1（别抢戏）
- 用户被动/许可继续 => 允许 L2（甚至 L3）

7.3 体验轴选择（用“体验六轴”保证普适性，不要只会一种戏）
每轮从下列轴里选 1 个主轴 + 1 个副轴（不要全选）：
A 亲密/暧昧张力（推拉、距离、暗示、心照不宣）
B 信任/陪伴（照顾、站队、共享秘密、共同任务）
C 冲突/博弈（误会、吃醋、利益拉扯、立场对抗、嘴硬心软）
D 悬疑/信息缺口（线索、隐瞒、试探、反转但要有因）
E 成长/能力与身份（工作/战斗/训练/社交升级/自我突破）
F 日常/治愈/生活质感（吃穿住行、朋友圈、习惯、仪式感）

（可选轻调味：幽默/吐槽，但不得冲掉主轴）

选择规则：
- 若 RUN_STATE.goal 是核对/问为什么 => 主轴优先 D（信息缺口）或 B（信任澄清）
- 若关系阶段低（S1-S2）=> 主轴优先 B/D/F；A 只能轻微
- 若 TALK_DBL => 可把 A/C/D 作为主轴推一段
- 若用户明显偏好某轴（从 USER_PROFILE/STYLE_PREF）=> 提高优先级，但不得覆盖安全边界与事实

7.4 “重要剧情节点不被错过”的最小规则（不靠外部状态也能起效）
- 任何“重大决定/重大告白/重大冲突和解/重大任务转折”必须：
  1) 在对话中明确呈现
  2) 给用户一个确认点（同意/拒绝/改方案）
  3) 不允许在日程自由行动里自动跑完
- 若你在记忆里看到“未解点/未完成约定”，且用户被动或 TALK_DBL：
  用一句轻描淡写提起它（不强行展开）；用户接住才升级为 L2/L3

==================================================
【8 多角色（Multi-cast）强化规则】
- present_characters 中谁在场，你就默认谁可能插话/被提及
- 多角色演绎输出必须标注“角色名：”
- 同一轮不要让两个角色说同一种语气；每人一句要有差异（身份/动机/立场）
- 多角色冲突时：你要先稳定“事实与场景”，再稳定“关系阶段”，最后才写戏

==================================================
【9 写作与去AI味（强制执行）】
9.1 硬长度契约（防太短/没信息）
- 常规 TALK_HOLD：3~6段，总字数建议 260~720（不低于 220）
- TALK_DBL：允许更长一点（360~980），但仍要有节奏分段
- 必须包含：台词 + 动作/在场细节 + 情绪/潜台词 + 一点点推进
- 必须引用至少 1 个“动态上下文细节”（某承诺/某NPC/某段日程/某件物品/某未解点）

9.2 防复读（画面指纹）
- 同一套“动作+情绪结论+句式”在最近 6 轮不得重复
- 若提供 FINGERPRINT_BLACKLIST，必须避开

9.3 结尾形态混合（Ending Mix）
结尾不要总是问问题。四种形态混用：
Q：一个问题（≤40%）
A：轻行动邀请（“要不要…/我带你…”）
B：张力陈述（不问，但留空白）
S：收束留白（省略号/安静一秒/只说一句很短的）

若提供 ENDING_HISTORY：最近 10 轮 Q 型不得超过 4 次。

==================================================
【10 特殊事件输出规则（不输出JSON，仍可工程识别）】
当 INPUT_EVENT=FUNC_DBL（生成CG）：
- 你只输出“镜头描述文本”，不要输出对话，不要输出多余解释
- 镜头描述必须包含：地点/时间氛围/人物站位/表情动作/服装/关键道具/画面主情绪
- 字数建议 80~220

当 INPUT_EVENT=SCHEDULE_TICK（日程跳动）：
- 你只输出一条“朋友圈/日记式生活片段”，不要输出对话
- 内容要符合角色生活与世界观，可产生材料与伏笔，但不得替代对话中的重大节点
- 字数建议 60~200

==================================================
【11 自检（输出前在心里过一遍，不要写出来）】
- 我是否正确识别直输/旁白/事件类型？
- 若用户在对账，我是否完成 A确定/B不确定+C轻选项，并且没破戏元词？
- 我是否引用了至少1个上下文细节？
- 我是否保持人物与关系一致，没有跳时间换场景？
- 我是否给了一个可接住的下一步（Q/A/B/S之一）？

若任一项不满足：在心中重写后再输出。`
function normInputEvent(v: unknown): InputEvent | undefined {
  const s = String(v || '').trim()
  const allow: Record<string, true> = {
    TALK_HOLD: true,
    FUNC_HOLD: true,
    TALK_DBL: true,
    FUNC_DBL: true,
    SCHEDULE_TICK: true,
    SCHEDULE_PLAY: true,
    SCHEDULE_PAUSE: true,
  }
  return allow[s] ? (s as InputEvent) : undefined
}

function inputEventPlaceholder(ev: InputEvent) {
  const map: Record<InputEvent, string> = {
    TALK_HOLD: '（对话）',
    FUNC_HOLD: '（旁白）',
    TALK_DBL: '（推进剧情）',
    FUNC_DBL: '（生成CG）',
    SCHEDULE_TICK: '（日程跳动）',
    SCHEDULE_PLAY: '（日程开始）',
    SCHEDULE_PAUSE: '（日程暂停）',
  }
  return map[ev] || `（${ev}）`
}

function isStrictMultiCast(text: string) {
  const t = String(text || '')
  return /严格轮流|以下为轮流对话|不要合并|轮流对话|A先说|B再说|先说一句|再说一句/.test(t)
}

function isExitMultiCast(text: string) {
  const t = String(text || '')
  return /结束演绎|回到单聊|停止多角色|结束多角色|退出演绎|结束轮流|停止轮流/.test(t)
}

function extractPresentCharacters(text: string) {
  const t = String(text || '')
  const out: string[] = []
  const push = (s: unknown) => {
    const v = typeof s === 'string' ? s.trim() : ''
    if (!v) return
    if (v === '{user}' || v === '{role}') return
    if (v.length > 12) return
    if (out.includes(v)) return
    out.push(v)
  }

  // Pattern: “孟雅先说一句，杰克再说一句”
  for (const m of t.matchAll(/([^\s，。,:：()（）]{1,8})先说一句/g)) push(m[1])
  for (const m of t.matchAll(/([^\s，。,:：()（）]{1,8})再说一句/g)) push(m[1])

  // Pattern: “让A和B对话 / A和B轮流对话”
  for (const m of t.matchAll(/让([^\s，。,:：()（）]{1,8})和([^\s，。,:：()（）]{1,8})/g)) {
    push(m[1])
    push(m[2])
  }
  for (const m of t.matchAll(/([^\s，。,:：()（）]{1,8})和([^\s，。,:：()（）]{1,8})轮流对话/g)) {
    push(m[1])
    push(m[2])
  }

  // Pattern: “A：… B：…” (only capture when in multi-cast-like instruction text)
  if (isStrictMultiCast(t)) {
    for (const m of t.matchAll(/(?:^|[\n，。])([^\s，。,:：()（）]{1,8})：/g)) push(m[1])
  }

  return out.slice(0, 4)
}

function stableKey(x: unknown) {
  if (typeof x === 'string') return x.trim()
  const r = asRecord(x)
  const id = r['id']
  const name = r['name']
  const title = r['title']
  const content = r['content']
  const t =
    (typeof id === 'string' && id) ||
    (typeof name === 'string' && name) ||
    (typeof title === 'string' && title) ||
    (typeof content === 'string' && content)
  return typeof t === 'string' ? t.trim() : ''
}

async function nextTurnSeqForConversation(args: {
  sb: SupabaseClient<{ public: Record<string, never> }, 'public'>
  conversationId: string
  conversationState: unknown
}) {
  const { sb, conversationId, conversationState } = args
  try {
    type PatchJobRow = { turn_seq: number }
    const r = await sb
      .from('patch_jobs')
      .select('turn_seq')
      .eq('conversation_id', conversationId)
      .order('turn_seq', { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = r.data as unknown as PatchJobRow | null
    if (!r.error && row && typeof row.turn_seq !== 'undefined') return Number(row.turn_seq ?? 0) + 1
  } catch {
    // ignore
  }
  const rs = asRecord(asRecord(conversationState)['run_state'])
  return Number(rs['turn_seq'] ?? 0) + 1
}

function uniqPushByKey<T>(arr: T[], item: T, keyFn: (x: T) => string) {
  const k = keyFn(item)
  if (!k) return
  if (arr.some((x) => keyFn(x) === k)) return
  arr.push(item)
}

function applyPlotBoardPatch(conversationState: JsonObject, plotPatch: JsonObject) {
  const curr = asRecord(conversationState['plot_board'])
  const next: JsonObject = { ...curr }

  const openThreads = [...asArray(curr['open_threads'])]
  for (const it of asArray(plotPatch['open_threads_add'])) uniqPushByKey(openThreads, it, stableKey)
  const close = new Set(asArray(plotPatch['open_threads_close']).map(stableKey).filter(Boolean))
  next.open_threads = openThreads.filter((x) => !close.has(stableKey(x))).slice(-60)

  const pending = [...asArray(curr['pending_scenes'])]
  for (const it of asArray(plotPatch['pending_scenes_add'])) uniqPushByKey(pending, it, stableKey)
  const close2 = new Set(asArray(plotPatch['pending_scenes_close']).map(stableKey).filter(Boolean))
  next.pending_scenes = pending.filter((x) => !close2.has(stableKey(x))).slice(-40)

  const beat = [...asArray(curr['beat_history'])]
  const append = plotPatch['beat_history_append']
  if (append) beat.push(append)
  next.beat_history = beat.slice(-80)

  conversationState['plot_board'] = next
}

function applyLedgerPatch(conversationState: JsonObject, ledgerPatch: JsonObject) {
  const curr = asRecord(conversationState['ledger'])
  const next: JsonObject = { ...curr }

  const eventLog = [...asArray(curr['event_log'])]
  for (const it of asArray(ledgerPatch['event_log_add'])) eventLog.push(it)
  next.event_log = eventLog.slice(-200)

  const npcDb = [...asArray(curr['npc_database'])]
  for (const it of asArray(ledgerPatch['npc_db_add_or_update'])) {
    const k = stableKey(it)
    if (!k) continue
    const idx = npcDb.findIndex((x) => stableKey(x) === k)
    if (idx >= 0) npcDb[idx] = { ...asRecord(npcDb[idx]), ...asRecord(it) }
    else npcDb.push(it)
  }
  next.npc_database = npcDb.slice(-200)

  const inv = [...asArray(curr['inventory'])]
  for (const d of asArray(ledgerPatch['inventory_delta'])) {
    const r = asRecord(d)
    const name = (r['name'] ?? r['item'] ?? r['id']) as unknown
    const key = typeof name === 'string' ? name.trim() : ''
    if (!key) continue
    const delta = Number(r['delta'] ?? r['count_delta'] ?? r['n'] ?? 0)
    const idx = inv.findIndex((x) => stableKey(x) === key)
    if (idx >= 0) {
      const cur = asRecord(inv[idx])
      const curCount = Number(cur['count'] ?? cur['qty'] ?? 0)
      inv[idx] = { ...cur, name: cur['name'] ?? key, count: curCount + delta }
    } else {
      inv.push({ name: key, count: delta })
    }
  }
  next.inventory = inv.slice(-200)

  const wardrobe = { ...asRecord(curr['wardrobe']) }
  const w = asRecord(ledgerPatch['wardrobe_update'])
  if (typeof w['current_outfit'] === 'string' && String(w['current_outfit']).trim()) wardrobe.current_outfit = String(w['current_outfit']).trim()
  if (typeof w['confirmed'] === 'boolean') wardrobe.confirmed = w['confirmed']
  if (Array.isArray(w['items'])) wardrobe.items = w['items']
  next.wardrobe = wardrobe

  const rel = [...asArray(curr['relation_ledger'])]
  for (const it of asArray(ledgerPatch['relation_ledger_add'])) rel.push(it)
  next.relation_ledger = rel.slice(-120)

  conversationState['ledger'] = next
}

function applyMemoryPatch(conversationState: JsonObject, memoryPatch: JsonObject) {
  const curr = asRecord(conversationState['memory'])
  const next: JsonObject = { ...curr, ...asRecord(memoryPatch || {}) }
  const ep = asRecord(memoryPatch['memory_b_episode'])
  const summary = ep['summary']
  if (typeof summary === 'string' && summary.trim()) {
    const recent = [...asArray(curr['memory_b_recent'])]
    recent.push({ bucket_start: ep['bucket_start'] ?? '', summary: summary.trim(), open_loops: ep['open_loops'] ?? [], tags: ep['tags'] ?? [] })
    next.memory_b_recent = recent.slice(-20)
  }
  conversationState['memory'] = next
}

function defaultConversationState() {
  return {
    version: '1.0',
    applied_patch_job_ids: [],
    run_state: {
      time_local: nowLocalIso(),
      region: 'GLOBAL',
      age_mode: 'adult',
      romance_mode: 'ROMANCE_ON',
      relationship_stage: 'S1',
      mode: '单聊',
      narration_mode: 'DIALOG',
      scene: '',
      current_main_role: '',
      present_characters: ['{user}', '{role}'],
      goal: '',
      schedule_state: 'PAUSE',
    },
    focus_panel: {
      version: '1.0',
      scene_one_liner: '',
      primary_goal: '',
      initiative_mode: 'COOP',
      relationship_stage_hint: 'S1',
      key_boundary: '',
      active_facets: [],
      unresolved_threads_top3: [],
      pending_scene: null,
      risk_level: 'low',
      next_beat_options: [],
    },
    plot_board: {
      open_threads: [],
      pending_scenes: [],
      experience_axes: { intimacy: 0.2, risk: 0.15, information: 0.2, action: 0.15, relationship: 0.2, growth: 0.15 },
      beat_history: [],
    },
    schedule_board: {
      schedule_state: 'PAUSE',
      past_24h: [],
      current: '',
      next_24h: [],
      free_action_style: '',
    },
    ledger: {
      wardrobe: { current_outfit: '', confirmed: false, items: [] },
      inventory: [],
      npc_database: [],
      event_log: [],
      relation_ledger: [],
    },
    memory: {
      memory_b_recent: [],
      memory_c0_recent: [],
      highlights: [],
      user_profile: {},
      role_profile: {},
      biweekly: [],
      evergreen: [],
    },
    style_guard: {
      ending_history: [],
      fingerprint_blacklist: [],
      next_endings_prefer: ['A', 'B', 'S'],
    },
    fact_patch: [],
    moderation_flags: {},
  }
}

function defaultCharacterState() {
  return {
    version: '1.0',
    ip_pack: { ip_core: [], ip_index: [], ip_active_cache: [] },
    persona_system: { persona_kernel: [], persona_facets_catalog: [], suppression_rules: [] },
    relationship_ladder: null,
    role_profile: {},
    evergreen: [],
  }
}

function buildDynamicContext(args: {
  inputEvent?: InputEvent
  userCard?: string
  userMessageForModel?: string
  characterName: string
  systemPrompt: string
  characterProfile?: unknown
  characterSettings?: unknown
  conversationState: unknown
  characterState: unknown
  memoryA: Array<{ role: string; content: string }>
  memoryB: Array<unknown>
}) {
  const {
    inputEvent,
    userCard,
    userMessageForModel,
    characterName,
    systemPrompt,
    characterProfile,
    characterSettings,
    conversationState,
    characterState,
    memoryA,
    memoryB,
  } = args

  const cs = asRecord(conversationState)
  const chs = asRecord(characterState)

  const run = asRecord(cs['run_state'])
  // Increment a simple turn counter for timed triggers (best-effort).
  run.turn_seq = Number(run.turn_seq ?? 0) + 1
  run.time_local = nowLocalIso()
  run.current_main_role = characterName || run.current_main_role || '{role}'
  {
    const present = run['present_characters']
    if (!Array.isArray(present) || present.length === 0) run['present_characters'] = ['{user}', characterName || '{role}']
  }
  // Reflect character settings into run_state so prompt modules can key off it consistently.
  {
    const set = asRecord(characterSettings)
    const rm = set['romance_mode']
    const am = set['age_mode']
    if (rm === 'ROMANCE_ON' || rm === 'ROMANCE_OFF') run.romance_mode = rm
    if (am === 'teen' || am === 'adult') run.age_mode = am
    const teenMode = set['teen_mode']
    if (typeof teenMode === 'boolean') run.age_mode = teenMode ? 'teen' : run.age_mode
  }
  // Output mode hint
  {
    const ev = inputEvent || 'TALK_HOLD'
    run.output_mode = ev === 'FUNC_DBL' ? 'CG' : ev === 'SCHEDULE_TICK' ? 'SCHEDULE' : 'CHAT'
  }
  // User drive-state hint (used by the prompt OS for plot granularity)
  if (typeof userMessageForModel === 'string') {
    const t = userMessageForModel.trim()
    run.user_drive = inputEvent === 'TALK_DBL' ? 'PERMIT_CONTINUE' : t.length <= 2 ? 'PASSIVE' : 'ACTIVE'
    run.reconcile_hint = /你记不记得|到底是什么|说清楚|确认一下|别糊弄|你说错了|不是这样的|别编/.test(t) ? 'RECONCILE' : ''
    if (isExitMultiCast(t)) run.multi_cast_hint = ''
    else run.multi_cast_hint = isStrictMultiCast(t) ? 'MULTI_CAST' : ''
  }
  // Narration mode: a single compact switch that prompt rules can rely on.
  {
    const ev = inputEvent || 'TALK_HOLD'
    const strictMultiCast = run.multi_cast_hint === 'MULTI_CAST'
    const exitMultiCast = typeof userMessageForModel === 'string' ? isExitMultiCast(userMessageForModel) : false
    run.narration_mode =
      ev === 'FUNC_DBL'
        ? 'CG'
        : ev === 'SCHEDULE_TICK'
          ? 'SCHEDULE'
          : exitMultiCast
            ? 'DIALOG'
            : strictMultiCast
              ? 'MULTI_CAST'
              : ev === 'FUNC_HOLD'
                ? 'NARRATION'
                : 'DIALOG'
  }

  // If the user explicitly asked for strict multi-cast, try to enrich present_characters.
  // We only *add* characters; never remove existing ones.
  if (run.narration_mode === 'MULTI_CAST' && typeof userMessageForModel === 'string') {
    const names = extractPresentCharacters(userMessageForModel)
    if (names.length) {
      const present = Array.isArray(run['present_characters']) ? (run['present_characters'] as unknown[]) : []
      const next = [...present]
      for (const n of names) {
        if (!next.some((x) => String(x) === n)) next.push(n)
      }
      // Always keep {user} and the current main role visible in the stage list.
      if (!next.some((x) => String(x) === '{user}')) next.unshift('{user}')
      if (characterName && !next.some((x) => String(x) === characterName)) next.push(characterName)
      run['present_characters'] = next.slice(0, 8)
    }
  }

  const focus = asRecord(cs['focus_panel'])
  const plot = asRecord(cs['plot_board'])
  const sched = asRecord(cs['schedule_board'])
  const ledger = asRecord(cs['ledger'])
  const mem = asRecord(cs['memory'])
  const style = asRecord(cs['style_guard'])

  const ip = asRecord(chs['ip_pack'])
  const persona = asRecord(chs['persona_system'])
  const ladder = chs['relationship_ladder'] ?? null

  const memoryAText = (memoryA || [])
    .map((m) => {
      const who = m.role === 'assistant' ? characterName : '{user}'
      return `${who}: ${m.content}`
    })
    .join('\n')

  const memoryBText = (memoryB || [])
    .map((e: unknown) => {
      const r = asRecord(e)
      const bucket = r['bucket_start'] ?? r['time_range'] ?? ''
      const summary = r['summary'] ?? ''
      return `- (${String(bucket)}) ${String(summary)}`.trim()
    })
    .filter(Boolean)
    .join('\n')

  const ledgerDigest = [
    (() => {
      const wardrobe = asRecord(ledger['wardrobe'])
      const outfit = wardrobe['current_outfit']
      return outfit ? `WARDROBE.current_outfit: ${String(outfit)}` : ''
    })(),
    (() => {
      const inv = asArray(ledger['inventory'])
      if (!inv.length) return ''
      const s = inv
        .slice(0, 8)
        .map((x: unknown) => {
          const r = asRecord(x)
          const name = r['name']
          const count = r['count'] ?? r['qty']
          const n = typeof name === 'string' ? name : ''
          if (!n) return ''
          const c = Number(count ?? 0)
          return c ? `${n}x${c}` : n
        })
        .filter(Boolean)
        .join('、')
      return s ? `INVENTORY: ${s}` : ''
    })(),
    (() => {
      const rel = asArray(ledger['relation_ledger'])
      if (!rel.length) return ''
      const s = rel
        .slice(0, 6)
        .map((x: unknown) => {
          const r = asRecord(x)
          const c = r['content']
          if (typeof c === 'string' && c) return c
          if (typeof x === 'string') return x
          return ''
        })
        .filter(Boolean)
        .join(' | ')
      return s ? `RELATION_LEDGER: ${s}` : ''
    })(),
    (() => {
      const npcs = asArray(ledger['npc_database'])
      if (!npcs.length) return ''
      const s = npcs
        .slice(0, 8)
        .map((x: unknown) => {
          const r = asRecord(x)
          const name = r['name']
          const npc = r['npc']
          const pick = (typeof name === 'string' && name) || (typeof npc === 'string' && npc) || ''
          return pick
        })
        .filter(Boolean)
        .join('、')
      return s ? `NPC_DATABASE: ${s}` : ''
    })(),
    (() => {
      const ev = asArray(ledger['event_log'])
      if (!ev.length) return ''
      const s = ev
        .slice(-6)
        .map((x: unknown) => {
          if (typeof x === 'string') return x
          const r = asRecord(x)
          const c = r['content']
          return typeof c === 'string' ? c : ''
        })
        .filter(Boolean)
        .join(' | ')
      return s ? `EVENT_LOG: ${s}` : ''
    })(),
  ]
    .filter(Boolean)
    .join('\n')

  const s = []
  s.push('【DYNAMIC_CONTEXT｜每轮由程序拼接（内化运行版）】')
  s.push('')
  s.push('[MODEL_CONFIG]')
  s.push('model_target: m2-her')
  s.push('context_limit: 64k')
  s.push('runtime_profile: prompt_only_no_json')
  s.push('')
  s.push('[INPUT_EVENT]')
  s.push(`event: ${inputEvent || 'TALK_HOLD'}`)
  s.push('')
  if (userCard && userCard.trim()) {
    s.push('[USER_ID_CARD]')
    s.push(userCard.trim().slice(0, 520))
    s.push('')
  }
  s.push('[RUN_STATE]')
  // Keep RUN_STATE human-readable and stable to match the template's "key: value" style.
  s.push(`time_local: ${String(run.time_local || nowLocalIso())}`)
  s.push(`region: ${String(run.region || 'GLOBAL')}`)
  s.push(`age_mode: ${String(run.age_mode || 'adult')}`)
  s.push(`mode: ${String(run.narration_mode || run.output_mode || 'DIALOG')}`)
  s.push(`scene: ${String(run.scene || '')}`)
  s.push(`current_main_role: ${String(run.current_main_role || characterName || '{role}')}`)
  s.push(`present_characters: ${JSON.stringify(run.present_characters || [])}`)
  s.push(`goal: ${String(run.goal || '')}`)
  s.push(`turn_seq: ${String(run.turn_seq || '')}`)
  s.push('')
  s.push('[FOCUS_PANEL]')
  s.push(jsonClip(focus || {}, 1200))
  s.push('')
  s.push('[IP_PACK]')
  // Keep the immutable character prompt accessible as "CHARACTER_CANON" (template uses CHARACTER_CANON/IP_CORE).
  s.push('CHARACTER_CANON:')
  s.push(systemPrompt || '')
  s.push('')
  s.push('IP_PACK_STATE:')
  s.push(jsonClip(ip || {}, 1600))
  s.push('')
  s.push('[PERSONA_SYSTEM]')
  s.push(jsonClip(persona || {}, 1200))
  s.push('')
  if (ladder) {
    s.push('[RELATIONSHIP_STAGE]')
    s.push(typeof ladder === 'string' ? ladder : jsonClip(ladder, 900))
    s.push('')
  }
  s.push('')
  s.push('[PLOT_BOARD]')
  s.push(jsonClip(plot || {}, 1300))
  s.push('')
  s.push('[SCHEDULE_BOARD]')
  s.push(jsonClip(sched || {}, 900))
  s.push('')
  s.push('[FACT_LEDGER]')
  s.push('[WARDROBE]')
  s.push(ledgerDigest || '(empty)')
  s.push('')
  s.push('FULL_LEDGER_JSON:')
  s.push(jsonClip(ledger || {}, 1800))
  s.push('')
  s.push('[MEMORY_PACK]')
  s.push('MEMORY_A:')
  s.push(memoryAText || '(empty)')
  s.push('')
  s.push('MEMORY_B:')
  s.push(memoryBText || '(empty)')
  s.push('')
  // Placeholders for higher-level memories (kept empty if you haven't wired the writers yet).
  s.push('MEMORY_C0:')
  s.push(String(mem?.c0_summary || '').trim() || '(empty)')
  s.push('')
  s.push('MEMORY_C1:')
  s.push(jsonClip(mem?.c1_highlights || [], 400))
  s.push('')
  s.push('MEMORY_C2:')
  s.push(String(mem?.c2_user_profile || '').trim() || '(empty)')
  s.push('')
  s.push('MEMORY_C3:')
  s.push(String(mem?.c3_role_profile || '').trim() || '(empty)')
  s.push('')
  s.push('MEMORY_D:')
  s.push(String(mem?.d_biweekly || '').trim() || '(empty)')
  s.push('')
  s.push('MEMORY_E:')
  s.push(jsonClip(mem?.highlights || [], 600))
  s.push('')
  s.push('[STYLE_GUARD]')
  s.push(jsonClip(style || {}, 900))
  s.push('')
  s.push('[CHARACTER_PROFILE]')
  s.push(jsonClip(characterProfile || {}, 500))
  s.push('')
  s.push('[CHARACTER_SETTINGS]')
  s.push(jsonClip(characterSettings || {}, 700))
  s.push('')
  s.push('[USER_INPUT]')
  s.push(userMessageForModel || '')
  return s.join('\n')
}

function patchSystemPrompt() {
  return `你是“PatchScribe”。你将收到 PATCH_INPUT（JSON）。你必须只输出一个 JSON 对象，不要输出任何其它文字。

规则：
1) 严格 JSON：不要 markdown，不要注释，不要多余空行说明。
2) 所有顶层字段必须存在，即使为空也要给空对象/空数组：
focus_panel_next, run_state_patch, plot_board_patch, persona_system_patch, ip_pack_patch,
schedule_board_patch, ledger_patch, memory_patch, style_guard_patch, fact_patch_add, moderation_flags
3) ledger_patch 的 confirmed=true 只能来自对话明确确认；否则 confirmed=false。
4) experience_axes_delta 的每个轴范围 [-0.2, 0.2]。
5) 允许在 run_state_patch 中更新：narration_mode（DIALOG|NARRATION|MULTI_CAST|CG|SCHEDULE）、present_characters、current_main_role、relationship_stage 等，但必须与对话与 input_event 一致，禁止凭空大幅跳变。
6) 若用户输入出现“结束演绎/回到单聊/停止多角色”等退出指令，应将 narration_mode 置为 DIALOG，并停止多角色格式约束。

输出 schema（示意）：
{
  "focus_panel_next": { ... },
  "run_state_patch": { ... },
  "plot_board_patch": { "experience_axes_delta": {...}, "beat_history_append": {...}, "open_threads_add":[], "open_threads_close":[], "pending_scenes_add":[], "pending_scenes_close":[] },
  "persona_system_patch": { ... },
  "ip_pack_patch": { "add_entries": [], "remove_anchor_ids": [], "replace": false },
  "schedule_board_patch": { ... },
  "ledger_patch": { "event_log_add": [], "npc_db_add_or_update": [], "inventory_delta": [], "wardrobe_update": { "current_outfit":"", "confirmed": false }, "relation_ledger_add": [] },
  "memory_patch": { "memory_b_episode": { "bucket_start":"", "summary":"", "open_loops":[], "tags":[] } },
  "style_guard_patch": { ... },
  "fact_patch_add": [],
  "moderation_flags": { }
}`
}

function applyPatchToMemoryStates(args: {
  conversationState: JsonObject
  characterState: JsonObject
  patchObj: JsonObject
  includeMemoryEpisode?: boolean
}) {
  const { conversationState, characterState, patchObj, includeMemoryEpisode = false } = args
  const p = asRecord(patchObj)

  conversationState['run_state'] = { ...asRecord(conversationState['run_state']), ...asRecord(p['run_state_patch']) }
  conversationState['focus_panel'] = p['focus_panel_next'] || conversationState['focus_panel']

  // Plot: axes delta
  const axes = asRecord(asRecord(conversationState['plot_board'])['experience_axes'])
  const d = asRecord(asRecord(p['plot_board_patch'])['experience_axes_delta'])
  const nextAxes = {
    intimacy: clamp(Number(axes.intimacy ?? 0) + Number(d.intimacy ?? 0), 0, 1),
    risk: clamp(Number(axes.risk ?? 0) + Number(d.risk ?? 0), 0, 1),
    information: clamp(Number(axes.information ?? 0) + Number(d.information ?? 0), 0, 1),
    action: clamp(Number(axes.action ?? 0) + Number(d.action ?? 0), 0, 1),
    relationship: clamp(Number(axes.relationship ?? 0) + Number(d.relationship ?? 0), 0, 1),
    growth: clamp(Number(axes.growth ?? 0) + Number(d.growth ?? 0), 0, 1),
  }
  conversationState['plot_board'] = { ...asRecord(conversationState['plot_board']), ...asRecord(p['plot_board_patch']), experience_axes: nextAxes }
  applyPlotBoardPatch(conversationState, asRecord(p['plot_board_patch']))

  conversationState['schedule_board'] = { ...asRecord(conversationState['schedule_board']), ...asRecord(p['schedule_board_patch']) }

  applyLedgerPatch(conversationState, asRecord(p['ledger_patch']))
  applyMemoryPatch(conversationState, asRecord(p['memory_patch']))

  conversationState['style_guard'] = { ...asRecord(conversationState['style_guard']), ...asRecord(p['style_guard_patch']) }
  if (Array.isArray(p['fact_patch_add']) && (p['fact_patch_add'] as unknown[]).length) {
    const prev = Array.isArray(conversationState['fact_patch']) ? (conversationState['fact_patch'] as unknown[]) : []
    conversationState['fact_patch'] = [...prev, ...(p['fact_patch_add'] as unknown[])].slice(-60)
  }
  conversationState['moderation_flags'] = { ...asRecord(conversationState['moderation_flags']), ...asRecord(p['moderation_flags']) }

  // Character-level state
  characterState['persona_system'] = { ...asRecord(characterState['persona_system']), ...asRecord(p['persona_system_patch']) }
  characterState['ip_pack'] = { ...asRecord(characterState['ip_pack']), ...asRecord(p['ip_pack_patch']) }

  let memoryEpisode: PatchMemoryEpisode | null = null
  if (includeMemoryEpisode) {
    const mp = asRecord(p['memory_patch'])
    const ep = asRecord(mp['memory_b_episode'])
    const summary = String(ep.summary ?? '').trim()
    if (summary) {
      let bucket = String(ep['bucket_start'] ?? '')
      if (!bucket) {
        const dt = new Date()
        const ten = 10 * 60 * 1000
        bucket = new Date(Math.floor(dt.getTime() / ten) * ten).toISOString()
      }
      memoryEpisode = {
        bucket_start: bucket,
        summary,
        open_loops: ep['open_loops'] ?? [],
        tags: ep['tags'] ?? [],
      }
    }
  }

  return { memoryEpisode }
}

async function callMiniMax(mmBase: string, mmKey: string, body: JsonObject) {
  const url = joinUrl(mmBase, '/v1/text/chatcompletion_v2')
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mmKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`MiniMax error: ${resp.status} ${text}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // Some gateways might return JSON but with leading BOM, etc.
    const j = safeExtractJsonObject(text)
    if (!j) throw new Error('MiniMax returned non-JSON response')
    return j
  }
}

async function optimisticUpdateConversationState(args: {
  sb: SupabaseClient<{ public: Record<string, never> }, 'public'>
  convId: string
  state: unknown
  expectedVersion: number
}) {
  const { sb, convId, state, expectedVersion } = args
  const nextVersion = expectedVersion + 1
  const upd = await sb
    .from('conversation_states')
    // Supabase client is untyped in this repo; cast to satisfy TS during `next build`.
    .update({ state, version: nextVersion, updated_at: new Date().toISOString() } as unknown as never)
    .eq('conversation_id', convId)
    .eq('version', expectedVersion)
    .select('version')

  if (upd.error) throw new Error(upd.error.message)
  if (!upd.data || (Array.isArray(upd.data) && upd.data.length === 0)) throw new Error('Conversation state version conflict')
  return nextVersion
}

async function optimisticUpdateCharacterState(args: {
  sb: SupabaseClient<{ public: Record<string, never> }, 'public'>
  characterId: string
  state: unknown
  expectedVersion: number
}) {
  const { sb, characterId, state, expectedVersion } = args
  const nextVersion = expectedVersion + 1
  const upd = await sb
    .from('character_states')
    // Supabase client is untyped in this repo; cast to satisfy TS during `next build`.
    .update({ state, version: nextVersion, updated_at: new Date().toISOString() } as unknown as never)
    .eq('character_id', characterId)
    .eq('version', expectedVersion)
    .select('version')

  if (upd.error) throw new Error(upd.error.message)
  if (!upd.data || (Array.isArray(upd.data) && upd.data.length === 0)) throw new Error('Character state version conflict')
  return nextVersion
}

async function incrementPatchJobAttempts(args: {
  sb: SupabaseClient<{ public: Record<string, never> }, 'public'>
  jobId: string
  status: 'pending' | 'processing' | 'failed' | 'done'
  lastError?: string
}) {
  const { sb, jobId, status, lastError } = args
  const cur = (await sb.from('patch_jobs').select('attempts').eq('id', jobId).maybeSingle()) as {
    data: { attempts: number | null } | null
    error: { message: string } | null
  }
  if (cur.error) throw new Error(cur.error.message)
  const attempts = Number(cur.data?.attempts ?? 0) + 1
  const payload: Record<string, unknown> = { status, attempts, last_error: lastError ?? '' }
  await sb.from('patch_jobs').update(payload as unknown as never).eq('id', jobId)
  return attempts
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (!token) return NextResponse.json({ error: 'Missing Authorization token' }, { status: 401 })

    const body = (await req.json()) as ChatReq
    const characterId = (body.characterId || '').trim()
    const conversationId = body.conversationId ?? null
    const userMessageRaw = typeof body.message === 'string' ? body.message : ''
    const userMessageTrim = userMessageRaw.trim()
    const inputEvent = normInputEvent(body.inputEvent)
    const userCard = typeof body.userCard === 'string' ? body.userCard : ''

    if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 })
    // Allow empty message for event-driven turns like CG / schedule ticks.
    if (!userMessageTrim && !inputEvent) return NextResponse.json({ error: 'message or inputEvent is required' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Missing Supabase env' }, { status: 500 })
    }

    const mmKey = process.env.MINIMAX_API_KEY
    const mmBase = process.env.MINIMAX_BASE_URL
    if (!mmKey || !mmBase) {
      return NextResponse.json({ error: 'Missing MINIMAX env (MINIMAX_API_KEY / MINIMAX_BASE_URL)' }, { status: 500 })
    }

    // PatchScribe model: default to MiniMax-M2.5 (best-effort). If the account doesn't have access,
    // patching will fail but chat should still succeed.
    const patchModel = (process.env.MINIMAX_PATCH_MODEL || 'MiniMax-M2.5').trim()

    // Use the user's access_token as Authorization so RLS applies.
    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })

    const { data: userRes, error: userErr } = await sb.auth.getUser(token)
    if (userErr || !userRes.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    const userId = userRes.user.id

    const { data: character, error: charErr } = await sb
      .from('characters')
      .select('id,name,system_prompt,profile,settings')
      .eq('id', characterId)
      .single()

    if (charErr || !character) return NextResponse.json({ error: 'Character not found or no access' }, { status: 404 })

    // Create / reuse conversation
    let convId = conversationId
    if (convId) {
      const { data: convCheck, error: convCheckErr } = await sb.from('conversations').select('id').eq('id', convId).eq('user_id', userId).maybeSingle()
      if (convCheckErr || !convCheck) convId = null
    }
    if (!convId) {
      const { data: conv, error: convErr } = await sb
        .from('conversations')
        .insert({ user_id: userId, character_id: characterId, title: character.name })
        .select('id')
        .single()
      if (convErr || !conv) return NextResponse.json({ error: `Create conversation failed: ${convErr?.message}` }, { status: 500 })
      convId = conv.id
    }
    if (!convId) return NextResponse.json({ error: 'Create conversation failed: no conversation id' }, { status: 500 })
    const convIdFinal = convId

    // Load state snapshots (require the new schema).
    const { data: convStateRow, error: convStateErr } = await sb.from('conversation_states').select('state,version').eq('conversation_id', convIdFinal).maybeSingle()

    if (convStateErr && !convStateErr.message.includes('does not exist')) {
      return NextResponse.json({ error: `Load conversation_states failed: ${convStateErr.message}` }, { status: 500 })
    }

    let conversationState = convStateRow?.state ?? null
    if (!conversationState) {
      conversationState = defaultConversationState()
      // Best-effort init (will fail if table doesn't exist).
      const init = await sb.from('conversation_states').upsert({
        conversation_id: convIdFinal,
        user_id: userId,
        character_id: characterId,
        state: conversationState,
        version: 1,
      })
      if (init.error && init.error.message.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Supabase schema missing: please create conversation_states/character_states/memory_b_episodes tables first.' },
          { status: 500 },
        )
      }
    }

    const { data: charStateRow, error: charStateErr } = await sb.from('character_states').select('state').eq('character_id', characterId).maybeSingle()
    if (charStateErr && !charStateErr.message.includes('does not exist')) {
      return NextResponse.json({ error: `Load character_states failed: ${charStateErr.message}` }, { status: 500 })
    }

    let characterState = charStateRow?.state ?? null
    if (!characterState) {
      characterState = defaultCharacterState()
      const init = await sb.from('character_states').upsert({
        character_id: characterId,
        user_id: userId,
        state: characterState,
        version: 1,
      })
      if (init.error && init.error.message.includes('does not exist')) {
        return NextResponse.json(
          { error: 'Supabase schema missing: please create conversation_states/character_states/memory_b_episodes tables first.' },
          { status: 500 },
        )
      }
    }

    // Memory A (recent raw messages) and B (episodes)
    // IMPORTANT: load latest messages, then reverse to chronological order.
    const { data: msgRowsDesc } = await sb
      .from('messages')
      .select('role,content,created_at')
      .eq('conversation_id', convIdFinal)
      .order('created_at', { ascending: false })
      .limit(MEMORY_A_MESSAGES_LIMIT)

    const { data: bRows } = await sb
      .from('memory_b_episodes')
      .select('bucket_start,summary,open_loops,tags')
      .eq('conversation_id', convIdFinal)
      .order('bucket_start', { ascending: false })
      .limit(MEMORY_B_EPISODES_LIMIT)

    const msgRows = (msgRowsDesc ?? []).slice().reverse()
    const recentMessages = msgRows as unknown as DbMessageRow[]
    const recentEpisodes = (bRows ?? []) as unknown as MemoryBEpisodeRow[]

    const userMessageForModel = userMessageTrim || (inputEvent ? inputEventPlaceholder(inputEvent) : '')
    const userMessageToSave = userMessageRaw || userMessageForModel

    // Write user message (legacy-safe input_event). Always persist a row so raw logs are complete.
    {
      const payloadV2: {
        user_id: string
        conversation_id: string
        role: 'user'
        content: string
        input_event: InputEvent | null
      } = { user_id: userId, conversation_id: convIdFinal, role: 'user', content: userMessageToSave, input_event: inputEvent || null }
      const r1 = await sb.from('messages').insert(payloadV2)
      if (r1.error) {
        const msg = r1.error.message || ''
        const looksLikeLegacy = msg.includes('column') && msg.includes('input_event')
        if (!looksLikeLegacy) return NextResponse.json({ error: `Save user message failed: ${msg}` }, { status: 500 })
        const r2 = await sb.from('messages').insert({ user_id: userId, conversation_id: convIdFinal, role: 'user', content: userMessageToSave })
        if (r2.error) return NextResponse.json({ error: `Save user message failed: ${r2.error.message}` }, { status: 500 })
      }
    }

    const dynamic = buildDynamicContext({
      inputEvent,
      userCard,
      userMessageForModel,
      characterName: character.name,
      systemPrompt: character.system_prompt,
      characterProfile: character.profile,
      characterSettings: character.settings,
      conversationState,
      characterState,
      memoryA: recentMessages.map((m) => ({ role: m.role, content: m.content })),
      memoryB: recentEpisodes,
    })

    // MiniMax M2-her expects chat-style messages. In practice, multiple `system` messages
    // may be treated as an unsupported "group chat" configuration, so we merge into one.
    const mmMessages: MiniMaxMessage[] = [
      { role: 'system', name: 'System', content: `${PROMPT_OS}\n\n${dynamic}` },
      ...(userMessageForModel ? [{ role: 'user' as const, name: 'User', content: userMessageForModel }] : []),
    ]

    const mmJson = (await callMiniMax(mmBase, mmKey, {
      model: 'M2-her',
      messages: mmMessages,
      temperature: 1,
      top_p: 0.9,
      max_completion_tokens: 2048,
    })) as MiniMaxResponse

    const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
    const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
    if (baseCode) {
      return NextResponse.json({ error: `MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`, raw: mmJson }, { status: 502 })
    }

    let assistantMessage = mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? ''
    if (!assistantMessage) return NextResponse.json({ error: 'MiniMax returned empty content', raw: mmJson }, { status: 502 })

    // Guardrail: rare cases where the model violates output constraints (JSON leak / wrong mode).
    if (shouldRewriteAssistantOutput({ text: assistantMessage, inputEvent: inputEvent || null, userMessageForModel })) {
      try {
        const rewrite = (await callMiniMax(mmBase, mmKey, {
          model: 'M2-her',
          messages: [
            {
              role: 'system',
              name: 'System',
              content:
                `${PROMPT_OS}\n\n` +
                `你刚才的输出违反了“只输出可直接展示的角色文本”的硬约束。现在请你只输出“重写后的最终文本”，不要解释，不要JSON，不要提到规则。\n` +
                `- 若 INPUT_EVENT=FUNC_DBL：只输出镜头描述，不输出对话。\n` +
                `- 若 INPUT_EVENT=SCHEDULE_TICK：只输出一条括号生活片段（...）。\n`,
            },
            { role: 'user', name: 'User', content: `INPUT_EVENT=${inputEvent || 'TALK_HOLD'}\n用户输入：${userMessageForModel}\n原输出：\n${assistantMessage}` },
          ],
          temperature: 0.2,
          top_p: 0.7,
          max_completion_tokens: 1200,
        })) as MiniMaxResponse

        const fixed = (rewrite?.choices?.[0]?.message?.content ?? rewrite?.reply ?? rewrite?.output_text ?? '').trim()
        if (fixed && !shouldRewriteAssistantOutput({ text: fixed, inputEvent: inputEvent || null, userMessageForModel })) assistantMessage = fixed
      } catch {
        // ignore: fall back to original output
      }
    }

    // Save assistant message (legacy-safe input_event).
    {
      const payloadV2: {
        user_id: string
        conversation_id: string
        role: 'assistant'
        content: string
        input_event: InputEvent | null
      } = { user_id: userId, conversation_id: convIdFinal, role: 'assistant', content: assistantMessage, input_event: inputEvent || null }
      const r1 = await sb.from('messages').insert(payloadV2)
      if (r1.error) {
        const msg = r1.error.message || ''
        const looksLikeLegacy = msg.includes('column') && msg.includes('input_event')
        if (!looksLikeLegacy) return NextResponse.json({ error: `Save assistant message failed: ${msg}` }, { status: 500 })
        const r2 = await sb.from('messages').insert({ user_id: userId, conversation_id: convIdFinal, role: 'assistant', content: assistantMessage })
        if (r2.error) return NextResponse.json({ error: `Save assistant message failed: ${r2.error.message}` }, { status: 500 })
      }
    }

    // PatchScribe (async): enqueue a job every turn; run best-effort in background so chat latency isn't affected.
    const turnSeqForTurn = await nextTurnSeqForConversation({ sb, conversationId: convIdFinal, conversationState })
    const patchInput = {
      state_before: {
        conversation_state: conversationState,
        character_state: characterState,
      },
      turn: {
        time_local: nowLocalIso(),
        region: 'GLOBAL',
        turn_seq: turnSeqForTurn,
        input_event: inputEvent || 'TALK_HOLD',
        user_input: userMessageRaw,
        assistant_text: assistantMessage,
        user_card: userCard ? userCard.slice(0, 520) : '',
      },
      dynamic_context_used: dynamic.slice(0, 8000),
      recent_messages: (msgRows || []).slice(-12),
      facts_before_digest: conversationState?.ledger ?? {},
    }

    // Enqueue patch job (best-effort). If the table doesn't exist, we'll still run PatchScribe in-memory.
    // patchOk/patchError represent enqueue status only (the actual patch is async).
    let patchOk = false
    let patchError = ''
    let patchJobId = ''
    {
      try {
        const turnSeq = turnSeqForTurn
        const ins = await sb
          .from('patch_jobs')
          .insert({
            user_id: userId,
            conversation_id: convIdFinal,
            character_id: characterId,
            turn_seq: turnSeq,
            patch_input: patchInput,
            status: 'pending',
          })
          .select('id')
          .single()

        if (!ins.error && ins.data?.id) {
          patchJobId = String(ins.data.id)
          patchOk = true
        }
        else if (ins.error) {
          const msg = ins.error.message || ''
          // When the DB schema hasn't been updated yet, PostgREST returns errors like:
          // "Could not find the table 'public.patch_jobs' in the schema cache".
          // Treat that as a non-fatal "queue unavailable" case.
          const looksLikeMissing =
            (msg.includes('patch_jobs') && msg.includes('schema cache')) ||
            (msg.includes('patch_jobs') && msg.toLowerCase().includes('could not find the table')) ||
            (msg.includes('relation') && msg.includes('patch_jobs'))
          if (looksLikeMissing) {
            patchOk = false
            patchError = 'patch_jobs unavailable'
          } else if (msg.includes('duplicate') && msg.includes('patch_jobs_conversation_id_turn_seq_key')) {
            const existing = await sb
              .from('patch_jobs')
              .select('id')
              .eq('conversation_id', convIdFinal)
              .eq('turn_seq', turnSeq)
              .maybeSingle()

            if (existing.data?.id) {
              patchJobId = String(existing.data.id)
              patchOk = true
            } else {
              patchOk = false
              patchError = msg || 'patch_jobs insert failed'
            }
          } else {
            patchOk = false
            patchError = msg || 'patch_jobs insert failed'
          }
        }
      } catch {
        patchOk = false
        patchError = patchError || 'patch_jobs insert failed'
      }
    }
    if (patchJobId) {
      await sb.from('patch_jobs').update({ status: 'processing', last_error: '' }).eq('id', patchJobId).eq('status', 'pending')
    }

    // Fire-and-forget PatchScribe now (doesn't block the response). Cron can retry from patch_jobs if needed.
    {
      void (async () => {
        try {
          const pJson = (await callMiniMax(mmBase, mmKey, {
            model: patchModel,
            messages: [
              { role: 'system', name: 'System', content: patchSystemPrompt() },
              { role: 'user', name: 'User', content: `PATCH_INPUT:\n${JSON.stringify(patchInput)}` },
            ],
            temperature: 0.2,
            top_p: 0.7,
            max_completion_tokens: 2048,
          })) as MiniMaxResponse

          const patchText = pJson?.choices?.[0]?.message?.content ?? pJson?.reply ?? pJson?.output_text ?? ''
          const patchRaw = safeExtractJsonObject(patchText)
          if (!patchRaw || typeof patchRaw !== 'object') throw new Error('PatchScribe output is not valid JSON object')

          const patchObj = sanitizePatchOutput(patchRaw)
          if (!patchObj) throw new Error('Patch schema invalid')

          const applyPatchOnce = async () => {
            const stNow = await sb.from('conversation_states').select('state,version').eq('conversation_id', convIdFinal).maybeSingle()
            if (stNow.error || !stNow.data?.state) throw new Error(`Load conversation_states failed: ${stNow.error?.message || 'no state'}`)
            const conversationStateVerNow = Number(stNow.data.version ?? 0)
            const conversationStateNow = structuredClone(stNow.data.state as unknown as Record<string, unknown>)

            const chNow = await sb.from('character_states').select('state,version').eq('character_id', characterId).maybeSingle()
            if (chNow.error || !chNow.data?.state) throw new Error(`Load character_states failed: ${chNow.error?.message || 'no state'}`)
            const characterStateVerNow = Number(chNow.data.version ?? 0)
            const characterStateNow = structuredClone(chNow.data.state as unknown as Record<string, unknown>)

            if (patchJobId) {
              const rsNow = asRecord(conversationStateNow['run_state'])
              const applied = asArray(rsNow['applied_patch_job_ids']).map(String)
              if (applied.includes(patchJobId)) {
                await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', patchJobId)
                return
              }
            }

            const { memoryEpisode } = applyPatchToMemoryStates({
              conversationState: asRecord(conversationStateNow),
              characterState: asRecord(characterStateNow),
              patchObj,
              includeMemoryEpisode: true,
            })
            if (patchJobId) {
              const rs = asRecord(asRecord(conversationStateNow)['run_state'])
              const applied = asArray(rs['applied_patch_job_ids']).map(String).filter(Boolean)
              rs['applied_patch_job_ids'] = [...applied, patchJobId].slice(-240)
            }

            await optimisticUpdateConversationState({
              sb,
              convId: convIdFinal,
              state: asRecord(conversationStateNow),
              expectedVersion: conversationStateVerNow,
            })
            await optimisticUpdateCharacterState({
              sb,
              characterId,
              state: asRecord(characterStateNow),
              expectedVersion: characterStateVerNow,
            })

            if (memoryEpisode) {
              await sb.from('memory_b_episodes').upsert(
                {
                  conversation_id: convIdFinal,
                  user_id: userId,
                  bucket_start: memoryEpisode.bucket_start,
                  summary: String(memoryEpisode.summary || '').slice(0, 500),
                  open_loops: memoryEpisode.open_loops || [],
                  tags: memoryEpisode.tags || [],
                },
                { onConflict: 'conversation_id,bucket_start' },
              )
            }

            if (patchJobId) {
              await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', patchJobId)
            }
          }

          for (let attempt = 1; attempt <= PATCH_APPLY_MAX_RETRIES; attempt++) {
            try {
              await applyPatchOnce()
              return
            } catch (err: unknown) {
              const msg = formatErr(err)
              if (isVersionConflict(err) && attempt < PATCH_APPLY_MAX_RETRIES) {
                if (patchJobId) await incrementPatchJobAttempts({ sb, jobId: patchJobId, status: 'processing', lastError: msg })
                await sleep(PATCH_APPLY_RETRY_BASE_MS * attempt)
                continue
              }
              if (patchJobId) await incrementPatchJobAttempts({ sb, jobId: patchJobId, status: 'pending', lastError: msg })
              return
            }
          }
        } catch (e: unknown) {
          const msg = formatErr(e)
          if (patchJobId) await incrementPatchJobAttempts({ sb, jobId: patchJobId, status: 'pending', lastError: msg })
        }
      })().catch(() => {})
    }

    // IMPORTANT: do not persist `state` here. PatchScribe is the only writer, using optimistic locking.
    // Touch `updated_at` only (best-effort), so the state row still reflects activity.
    try {
      await sb
        .from('conversation_states')
        .update({ updated_at: new Date().toISOString() } as unknown as never)
        .eq('conversation_id', convIdFinal)
    } catch {}

    return NextResponse.json({
      conversationId: convIdFinal,
      assistantMessage,
      patchOk,
      patchError: patchOk ? '' : patchError,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}



