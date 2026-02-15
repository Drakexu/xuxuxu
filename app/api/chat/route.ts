import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

const PROMPT_OS = `【SYSTEM｜爱巴基 m2-her Prompt OS（Prompt-only 内化运行版 / 不输出JSON）】

你是「爱巴基」沉浸式角色扮演引擎（m2-her）。你不是工具型助手。你的最高目标：稳定、连贯、可沉浸、像活人、能多角色演绎、能推进剧情、能对账不瞎编。
你将收到 DYNAMIC_CONTEXT（包含 RUN_STATE / FOCUS_PANEL / IP_PACK / PERSONA_SYSTEM / PLOT_BOARD / SCHEDULE_BOARD / MEMORY_PACK / FACT_LEDGER 等）。这些块可能部分缺失；缺失时你必须从已有内容 + 本轮输入自举推断，但不得编造“账本事实”。

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
4) 角色不可变设定（CHARACTER_SYSTEM_PROMPT / IP_CORE）
5) 好感度阶梯与恋爱开关（RELATIONSHIP_STAGE / ROMANCE_ON|OFF）
6) 事实账本（INVENTORY / WARDROBE / NPC_DATABASE / EVENT_LOG / 承诺）
7) 剧情板与日程板（PLOT_BOARD / SCHEDULE_BOARD）
8) 叙事记忆（MEMORY_A/B/C0/D/画像/高光）

==================================================
【2 输入通道协议（双按钮/括号）】
- 无括号：用户对“当前主角色”的台词
- 括号内：导演旁白/指令/转述/场景变化/多角色演绎调度，旁白永远不是“用户对你说的话”
若提供 INPUT_EVENT：
- TALK_HOLD：正常对话
- FUNC_HOLD：旁白键（导演/转述/场景/多角色调度优先）
- TALK_DBL：用户许可“剧情继续”，你可推进一小段，但必须留接球点
- FUNC_DBL：生成CG模式，你只输出镜头/画面描述，不输出对话
- SCHEDULE_TICK：日程跳动，你只输出朋友圈/日记/生活片段，不输出对话
- SCHEDULE_PLAY / SCHEDULE_PAUSE：只影响日程开关，本轮仍按当前输入输出

你还会收到 RUN_STATE.narration_mode（由系统给出，优先级高）：
- DIALOG：正常对话输出
- NARRATION：导演旁白优先，允许多角色调度，但仍禁止替 {user} 说台词
- MULTI_CAST：强制多角色轮流输出格式（见 3.5），并优先使用 RUN_STATE.present_characters 作为“在场轮流列表”
- CG：只输出镜头/画面描述
- SCHEDULE：只输出生活片段/朋友圈/日记片段

==================================================
【2.5 在场角色与标注（主语与舞台管理）】
- 你始终以 RUN_STATE.current_main_role 作为“当前主角色”发言（除非旁白明确切换主角）
- RUN_STATE.present_characters 是本场“在场角色列表”：多角色演绎时只允许在场角色开口
- 多角色输出必须用“角色名：”标注；标注名应与在场角色一致（或与账本 NPC 名称一致）
- {user} 永远不由你代说台词；{user}只允许动作/沉默/被描述对象

==================================================
【3 旁白解析协议（遇到括号旁白/旁白键时强制执行；按顺序匹配）】
A) 台词转述：
出现“X说…/X对Y说…/X：…” => 视为 X 的台词意图，你用更自然的台词把剧情接下去（不要机械复读）
B) 多角色演绎模式（启动/继续/退出）：
出现“让A和B轮流对话/严格轮流/继续演绎” =>
- 进入多角色演绎：每句必须用“角色名：”标注，严格轮流，不合并，不偷换主语
- {user} 永远不由你代说台词；{user}只作为动作/沉默/被描述对象出现
- 直到旁白明确“结束演绎/回到单聊/停止多角色”才退出
C) 视角旁白：
出现“旁白-某某：…”或“某某（心理/动作）…” => 以该角色视角推进，但仍严格遵守事实账本
D) 默认映射兜底：
旁白里“我” => {user}视角导演旁白；“你” => 当前主角色视角；无主语 => 环境/镜头补充
仍不明确：用一句话温和澄清后继续，不要卡死。

==================================================
【3.5 多角色输出格式（体验硬约束）】
- 多角色演绎时，每个角色至少输出 1 句；默认输出 2~4 句（不要一口气长篇）
- 每句结构必须同时包含三要素：
  - 台词（一句即可）
  - 可见动作/表情（用括号，短）
  - 意图/潜台词（用“—”后接短语，或用“/”短语）
  示例结构（仅示意格式，不要复读示例内容）：角色名：台词（动作/表情）—意图短语
- 严禁把两个人的台词合并在同一行；严禁“旁白总结式”替代轮流对话
- 如果旁白说“不要代说/不要合并/严格执行”：把它当作最高优先级的格式约束

==================================================
【4 对账模式（Reconcile Mode：遇到对账触发词必须切换）】
触发词任一：你记不记得/到底是什么/说清楚/确认一下/别糊弄/你说错了/不是这样的/别编
对账模式必须三步（仍保持角色感）：
A) 先说“我能确定的”（只基于账本事实/明确对话）
B) 再说“我不确定的”，明确“不乱说”，并问 1~3 个缺口问题
C) 给用户轻选项：现在补全 / 先继续演绎稍后再对齐

【4.2 对账输出模板（硬约束，避免跑偏）】
- 必须按顺序输出 3 段，每段 1~3 句，且每段开头必须有固定引导语：
  1) “我能确定的是：……”（只写确定事实，最多 3 条，用顿号分隔）
  2) “我不确定的是：……”（明确不确定点，最多 2 条）
  3) “你更想：A 现在补全 / B 先继续演绎，稍后再对齐？”（只给 A/B 两个选项）
- 绝不允许在对账模式里新增剧情、引入新NPC、推进关系升级

==================================================
【4.5 FOCUS_PANEL 使用（每轮导演板，优先级高于“自由发挥”）】
- 若 RUN_STATE.reconcile_hint=RECONCILE：强制进入对账模式，不要继续演绎
- 你必须尊重 FOCUS_PANEL.key_boundary（不要越界、不要诱导越界）
- initiative_mode 规则：
  - FOLLOW：用户主导，你只做 L0/L1，不抢戏
  - COOP：共同推进，优先用 next_beat_options 选 1 个推进
  - LEAD：你带一点节奏，但每段必须给接球点
- pending_scene 若存在：把它当作“下一段可演的候选场景”，但除非 TALK_DBL，不要长篇一次演完
- unresolved_threads_top3：只在用户被动或 TALK_DBL 时使用
  - 每轮最多提 1 条
  - 只能用一句话轻描淡写“提起”，不要立刻展开、不要自问自答
  - 用户接住才升级为 L2/L3；用户不接就立刻降温回到当前话题

==================================================
【5 人格系统（PERSONA_SYSTEM 内化调度：每轮在心里完成，不要写出来）】
- persona_kernel（内核）跨场景强稳定：价值观、依恋与边界、口吻与习惯
- persona_facets（人格面）每轮最多显化 1~2 个；其余只允许暗影响情绪与微动作
- 禁止无缘由跳变：反转/降温/升级关系必须有可见原因（事件/承诺/冲突触发）

==================================================
【6 剧情调度（颗粒度与体验轴：每轮在心里完成，不要把步骤写出来）】
【6.0 抢戏控制决策表（体验硬约束）】
- 若 RUN_STATE.reconcile_hint=RECONCILE：只对账，不演绎
- 若 INPUT_EVENT=FUNC_DBL：只输出镜头/画面（CG），不输出对话
- 若 INPUT_EVENT=SCHEDULE_TICK：只输出生活片段，不输出对话
- 若用户给了明确任务/问题/旁白指令：你必须先满足它，再考虑推进剧情

【6.05 颗粒度选择（严格按下列规则，避免抢戏）】
- 用户主动推进（RUN_STATE.user_drive=ACTIVE）：
  - FOCUS_PANEL.initiative_mode=FOLLOW：只允许 L0/L1
  - FOCUS_PANEL.initiative_mode=COOP：默认 L1，必要时 L2 但必须给选择口
  - FOCUS_PANEL.initiative_mode=LEAD：最多 L2，且每段都要留接球点
- 用户被动（RUN_STATE.user_drive=PASSIVE）：
  - 默认 L2 抛钩子（两选一或一个明确接球点），不要长篇自嗨
  - 如果用户连续被动 3 次：允许 L2->L3，但仅在 TALK_DBL 或用户明确说“你来”
- 用户许可继续（RUN_STATE.user_drive=PERMIT_CONTINUE 或 INPUT_EVENT=TALK_DBL）：
  - 允许 L2/L3，但每段仍必须留选择口，不要一次演到结局

6.1 推进颗粒度（默认只允许 L0~L2；极少数 TALK_DBL 可到 L3）：
- L0 微动作：只加一个小动作/停顿/距离变化
- L1 小剧场：1~2 轮可演的小转折；不引入新NPC；不改变大方向
- L2 钩子：抛一个未完成事件/未解点，给 2 选 1 或明确接球点
- L3 片段推进（仅 TALK_DBL 时）：推进短段落“可视化演绎”，仍留选择口
6.2 体验六轴（每轮选 1 个主轴 + 1 个副轴，不要全选）：
A 亲密/暧昧张力、B 信任/陪伴、C 冲突/博弈、D 悬疑/信息缺口、E 成长/身份能力、F 日常/治愈生活质感
6.25 关系阶段门控（避免“跳级亲密”）：
- S1-S2：主轴优先 B/D/F；A 只能轻微（眼神/距离/暧昧语气），禁止承诺式关系语言
- S3-S5：A/B/C/D 可做主轴，但重大承诺必须给用户确认点
- S6-S7：允许高亲密表达，但必须尊重自愿与边界，用户不接球要立刻降温收束
6.3 重要节点最小规则：
重大决定/重大承诺/重大和解/重大转折必须在对话中明确呈现，并给用户确认点（同意/拒绝/改方案）。

==================================================
【7 事实与账本（禁止瞎编）】
- 账本（衣柜/物品/NPC/事件/承诺）缺失时承认不确定，不得编造细节
- 用户纠错优先吸收并自然确认

==================================================
【8 输出风格】
- 像活人：动作/情绪/环境细节；分段；避免复读；结尾不要总是提问
- 结尾防复读：参考 STYLE_GUARD.ending_history，避免重复最近 3 次收尾句式/语气/动作
- 收尾策略：优先选 STYLE_GUARD.next_endings_prefer 中的 1 种
  - A：动作收束 + 留一个“可选下一步”
  - B：给两条分支（不要超过 2 条）
  - S：短句留白 + 轻承诺/轻悬念（不提问也能接住）
`
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
  ]
    .filter(Boolean)
    .join('\n')

  const s = []
  s.push('【DYNAMIC_CONTEXT｜每轮由程序拼接】')
  s.push('')
  s.push('[INPUT_EVENT]')
  s.push(`event: ${inputEvent || 'TALK_HOLD'}`)
  s.push('')
  if (userCard && userCard.trim()) {
    s.push('[USER_IDENTITY_CARD]')
    s.push(userCard.trim().slice(0, 520))
    s.push('')
  }
  s.push('[RUN_STATE]')
  s.push(JSON.stringify(run, null, 2))
  s.push('')
  s.push('[FOCUS_PANEL]')
  s.push(JSON.stringify(focus, null, 2))
  s.push('')
  s.push('[PERSONA_SYSTEM]')
  s.push(JSON.stringify(persona, null, 2))
  s.push('')
  if (ladder) {
    s.push('[RELATIONSHIP_STAGE]')
    s.push(typeof ladder === 'string' ? ladder : JSON.stringify(ladder, null, 2))
    s.push('')
  }
  s.push('[IP_PACK]')
  s.push(JSON.stringify(ip, null, 2))
  s.push('')
  s.push('[PLOT_BOARD]')
  s.push(JSON.stringify(plot, null, 2))
  s.push('')
  s.push('[SCHEDULE_BOARD]')
  s.push(JSON.stringify(sched, null, 2))
  s.push('')
  s.push('[FACT_LEDGER_DIGEST]')
  s.push(ledgerDigest || '(empty)')
  s.push('')
  s.push('[MEMORY_PACK]')
  s.push('MEMORY_A:')
  s.push(memoryAText || '(empty)')
  s.push('')
  s.push('MEMORY_B:')
  s.push(memoryBText || '(empty)')
  s.push('')
  s.push('MEMORY_LONG:')
  s.push(JSON.stringify({ highlights: mem?.highlights || [], evergreen: mem?.evergreen || [] }, null, 2))
  s.push('')
  s.push('[STYLE_GUARD]')
  s.push(JSON.stringify(style, null, 2))
  s.push('')
  s.push('[CHARACTER_PROFILE]')
  s.push(JSON.stringify(characterProfile || {}, null, 2))
  s.push('')
  s.push('[CHARACTER_SETTINGS]')
  s.push(JSON.stringify(characterSettings || {}, null, 2))
  s.push('')
  s.push('[CHARACTER_SYSTEM_PROMPT]')
  s.push(systemPrompt || '')
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
    let conversationStateVersion = Number(convStateRow?.version ?? 0)
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
      conversationStateVersion = 1
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
      ...recentMessages.map((m) => ({
        role: (m.role === 'assistant' ? 'assistant' : 'user') as MiniMaxMessage['role'],
        name: m.role === 'assistant' ? String(character.name || 'AI') : 'User',
        content: m.content,
      })),
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

    const assistantMessage = mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? ''
    if (!assistantMessage) return NextResponse.json({ error: 'MiniMax returned empty content', raw: mmJson }, { status: 502 })

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
    const patchInput = {
      state_before: {
        conversation_state: conversationState,
        character_state: characterState,
      },
      turn: {
        time_local: nowLocalIso(),
        region: 'GLOBAL',
        input_event: inputEvent || 'TALK_HOLD',
        user_input: userMessageRaw,
        assistant_text: assistantMessage,
        user_card: userCard ? userCard.slice(0, 520) : '',
      },
      recent_messages: (msgRows || []).slice(-12),
      facts_before_digest: conversationState?.ledger ?? {},
    }

    // Enqueue patch job (best-effort). If the table doesn't exist, we'll still run PatchScribe in-memory.
    // patchOk/patchError represent enqueue status only (the actual patch is async).
    let patchOk = true
    let patchError = ''
    let patchJobId = ''
    {
      try {
        const rs = asRecord(asRecord(conversationState)['run_state'])
        const turnSeq = Number(rs['turn_seq'] ?? 0)
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

        if (!ins.error && ins.data?.id) patchJobId = String(ins.data.id)
        else if (ins.error) {
          const msg = ins.error.message || ''
          // When the DB schema hasn't been updated yet, PostgREST returns errors like:
          // "Could not find the table 'public.patch_jobs' in the schema cache".
          // Treat that as a non-fatal "queue unavailable" case.
          const looksLikeMissing =
            (msg.includes('patch_jobs') && msg.includes('schema cache')) ||
            (msg.includes('patch_jobs') && msg.toLowerCase().includes('could not find the table')) ||
            (msg.includes('relation') && msg.includes('patch_jobs'))
          if (!looksLikeMissing) throw new Error(msg)
        }
      } catch {
        // Queue is optional. Don't surface an error to the user for queue-only failures.
        patchOk = true
        patchError = ''
      }
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
          const patchObj = safeExtractJsonObject(patchText)
          if (!patchObj || typeof patchObj !== 'object') throw new Error('PatchScribe output is not valid JSON object')

          const requiredKeys = [
            'focus_panel_next',
            'run_state_patch',
            'plot_board_patch',
            'persona_system_patch',
            'ip_pack_patch',
            'schedule_board_patch',
            'ledger_patch',
            'memory_patch',
            'style_guard_patch',
            'fact_patch_add',
            'moderation_flags',
          ]
          for (const k of requiredKeys) {
            if (!(k in patchObj)) throw new Error(`Patch missing key: ${k}`)
          }

          // Reload latest snapshots to avoid version races (async patching).
          const stNow = await sb.from('conversation_states').select('state,version').eq('conversation_id', convIdFinal).maybeSingle()
          if (stNow.error || !stNow.data?.state) throw new Error(`Load conversation_states failed: ${stNow.error?.message || 'no state'}`)
          const conversationStateNow = stNow.data.state
          const conversationStateVerNow = Number(stNow.data.version ?? 0)

          const chNow = await sb.from('character_states').select('state,version').eq('character_id', characterId).maybeSingle()
          if (chNow.error || !chNow.data?.state) throw new Error(`Load character_states failed: ${chNow.error?.message || 'no state'}`)
          const characterStateNow = chNow.data.state
          const characterStateVerNow = Number(chNow.data.version ?? 0)

          // Apply patch: run_state / focus
          conversationStateNow.run_state = { ...(conversationStateNow.run_state || {}), ...(patchObj.run_state_patch || {}) }
          conversationStateNow.focus_panel = patchObj.focus_panel_next || conversationStateNow.focus_panel

          // Plot: axes delta
          const axes = conversationStateNow.plot_board?.experience_axes || {}
          const d = patchObj.plot_board_patch?.experience_axes_delta || {}
          const nextAxes = {
            intimacy: clamp(Number(axes.intimacy ?? 0) + Number(d.intimacy ?? 0), 0, 1),
            risk: clamp(Number(axes.risk ?? 0) + Number(d.risk ?? 0), 0, 1),
            information: clamp(Number(axes.information ?? 0) + Number(d.information ?? 0), 0, 1),
            action: clamp(Number(axes.action ?? 0) + Number(d.action ?? 0), 0, 1),
            relationship: clamp(Number(axes.relationship ?? 0) + Number(d.relationship ?? 0), 0, 1),
            growth: clamp(Number(axes.growth ?? 0) + Number(d.growth ?? 0), 0, 1),
          }
          conversationStateNow.plot_board = { ...(conversationStateNow.plot_board || {}), ...(patchObj.plot_board_patch || {}), experience_axes: nextAxes }
          applyPlotBoardPatch(conversationStateNow as JsonObject, asRecord(patchObj.plot_board_patch))

          // Schedule
          conversationStateNow.schedule_board = { ...(conversationStateNow.schedule_board || {}), ...(patchObj.schedule_board_patch || {}) }

          // Ledger / Memory
          applyLedgerPatch(conversationStateNow as JsonObject, asRecord(patchObj.ledger_patch))
          applyMemoryPatch(conversationStateNow as JsonObject, asRecord(patchObj.memory_patch))

          // Optional: upsert memory B episode (best-effort; cron/memory will also handle B/Daily)
          const ep = patchObj.memory_patch?.memory_b_episode
          if (ep && typeof ep === 'object') {
            let bucket = ep.bucket_start
            if (!bucket) {
              const dt = new Date()
              const ms = dt.getTime()
              const ten = 10 * 60 * 1000
              const floored = new Date(Math.floor(ms / ten) * ten)
              bucket = floored.toISOString()
            }
            await sb.from('memory_b_episodes').upsert(
              {
                conversation_id: convIdFinal,
                user_id: userId,
                bucket_start: bucket,
                summary: String(ep.summary || '').slice(0, 500),
                open_loops: ep.open_loops || [],
                tags: ep.tags || [],
              },
              { onConflict: 'conversation_id,bucket_start' },
            )
          }

          // Style guard / facts / moderation
          conversationStateNow.style_guard = { ...(conversationStateNow.style_guard || {}), ...(patchObj.style_guard_patch || {}) }
          if (Array.isArray(patchObj.fact_patch_add) && patchObj.fact_patch_add.length) {
            conversationStateNow.fact_patch = [...(conversationStateNow.fact_patch || []), ...patchObj.fact_patch_add].slice(-60)
          }
          conversationStateNow.moderation_flags = { ...(conversationStateNow.moderation_flags || {}), ...(patchObj.moderation_flags || {}) }

          // Character-level state
          characterStateNow.persona_system = { ...(characterStateNow.persona_system || {}), ...(patchObj.persona_system_patch || {}) }
          characterStateNow.ip_pack = { ...(characterStateNow.ip_pack || {}), ...(patchObj.ip_pack_patch || {}) }

          const up1 = await sb.from('conversation_states').upsert({
            conversation_id: convIdFinal,
            user_id: userId,
            character_id: characterId,
            state: conversationStateNow,
            version: conversationStateVerNow + 1,
          })
          if (up1.error) throw new Error(`Save conversation_states failed: ${up1.error.message}`)

          const up2 = await sb.from('character_states').upsert({
            character_id: characterId,
            user_id: userId,
            state: characterStateNow,
            version: characterStateVerNow + 1,
          })
          if (up2.error) throw new Error(`Save character_states failed: ${up2.error.message}`)

          if (patchJobId) {
            await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', patchJobId)
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          // Leave as pending so cron can retry; record error if possible.
          if (patchJobId) await sb.from('patch_jobs').update({ status: 'pending', last_error: msg }).eq('id', patchJobId)
        }
      })().catch(() => {})
    }

    // Persist baseline conversation state every turn (turn_seq/time_local/etc). Async patch will build on top.
    try {
      await sb.from('conversation_states').upsert({
        conversation_id: convIdFinal,
        user_id: userId,
        character_id: characterId,
        state: conversationState,
        version: conversationStateVersion + 1,
      })
    } catch {
      // ignore: chat must still succeed
    }

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



