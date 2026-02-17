import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

type MiniMaxResponse = {
  choices?: Array<{ message?: { content?: string } }>
  reply?: string
  output_text?: string
  base_resp?: { status_code?: number; status_msg?: string }
}

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function callMiniMax(mmBase: string, mmKey: string, body: JsonObject) {
  const url = joinUrl(mmBase, '/v1/text/chatcompletion_v2')
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mmKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`MiniMax error: ${resp.status} ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('MiniMax returned non-JSON response')
  }
}

function requireCronSecret(req: Request) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) throw new Error('Missing CRON_SECRET')
  const url = new URL(req.url)
  const q = (url.searchParams.get('secret') || '').trim()
  const h = (req.headers.get('x-cron-secret') || '').trim()
  const auth = (req.headers.get('authorization') || '').trim()
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : ''
  const got = q || h || token
  if (got !== secret) throw new Error('Invalid CRON secret')
}

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function dayKeyUtc(d: Date) {
  return d.toISOString().slice(0, 10)
}

function dayStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function hourStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0))
}

function minutesAgo(d: Date, mins: number) {
  return new Date(d.getTime() - mins * 60 * 1000)
}

function envFlag(v: string | undefined, fallback = false) {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return fallback
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return fallback
}

function pickMiniMaxText(r: MiniMaxResponse) {
  return r?.choices?.[0]?.message?.content ?? r?.reply ?? r?.output_text ?? ''
}

function clip(s: unknown, max: number) {
  const t = String(s || '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function ensureScheduleSnippet(v: unknown) {
  const raw = clip(v, 700).replace(/\s+/g, ' ').trim()
  const body = raw
    .replace(/^[()\[\]{}<>（）【】「」『』\s]+/, '')
    .replace(/[()\[\]{}<>（）【】「」『』\s]+$/, '')
    .trim()
  const text = (body || '她安静地处理完手头的事，给自己留了一点放空的时间。').slice(0, 180)
  return `（${text}）`
}

function normalizeMomentPost(v: unknown) {
  const raw = clip(v, 900).replace(/\s+/g, ' ').trim()
  const body = raw
    .replace(/^[()\[\]{}<>（）【】「」『』\s]+/, '')
    .replace(/[()\[\]{}<>（）【】「」『』\s]+$/, '')
    .trim()
  return (body || '今天过得还算充实，晚点再和你分享细节。').slice(0, 260)
}

function parseIsoDate(v: unknown) {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function readScheduleControl(state: unknown, now: Date) {
  const root = asRecord(state)
  const run = asRecord(root['run_state'])
  const board = asRecord(root['schedule_board'])

  const manualControl = board['manual_control'] === true
  const scheduleStateRaw = String(board['schedule_state'] || run['schedule_state'] || 'PLAY').trim().toUpperCase()
  const scheduleState = scheduleStateRaw === 'PAUSE' ? 'PAUSE' : 'PLAY'
  const lockMode = String(board['lock_mode'] || '').trim()
  const storyLockUntil = String(board['story_lock_until'] || '').trim()
  const lockUntil = parseIsoDate(storyLockUntil)
  const lockActive = !!lockUntil && lockUntil.getTime() > now.getTime()
  const lockExpired = !!lockUntil && lockUntil.getTime() <= now.getTime()
  const blockedByPause = manualControl && scheduleState === 'PAUSE'

  return {
    manualControl,
    scheduleState,
    lockMode,
    storyLockUntil,
    lockActive,
    lockExpired,
    blocked: blockedByPause || lockActive,
  }
}

async function clearExpiredStoryLockBestEffort(args: {
  sb: ReturnType<typeof createAdminClient>
  conversationId: string
  state: unknown
  version: number
}) {
  const { sb, conversationId, state, version } = args
  const root = asRecord(state)
  const run = { ...asRecord(root['run_state']) }
  const board = { ...asRecord(root['schedule_board']) }
  const ledger = { ...asRecord(root['ledger']) }

  run.schedule_state = 'PLAY'
  board.schedule_state = 'PLAY'
  board.lock_mode = 'manual'
  board.story_lock_until = ''
  board.story_lock_reason = ''

  const eventLog = Array.isArray(ledger['event_log']) ? [...(ledger['event_log'] as unknown[])] : []
  eventLog.push('[SCHEDULE] auto resume after story lock expired')
  ledger['event_log'] = eventLog.slice(-260)

  root['run_state'] = run
  root['schedule_board'] = board
  root['ledger'] = ledger

  const upd = await sb
    .from('conversation_states')
    .update({
      state: root,
      version: Number(version) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .eq('version', version)
  return !upd.error
}

async function nextTurnSeqForConversation(args: {
  sb: ReturnType<typeof createAdminClient>
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
    if (!r.error && row && typeof row.turn_seq !== 'undefined') {
      const last = Number(row.turn_seq ?? 0)
      return last + 1
    }
  } catch {
    // ignore
  }
  const rs = asRecord(asRecord(conversationState)['run_state'])
  return Number(rs['turn_seq'] ?? 0) + 1
}

async function enqueuePatchJobBestEffort(args: {
  sb: ReturnType<typeof createAdminClient>
  userId: string
  conversationId: string
  characterId: string
  inputEvent: 'SCHEDULE_TICK' | 'DIARY_DAILY' | 'MOMENT_POST'
  userInput: string
  assistantText: string
  conversationState: unknown
  characterState: unknown
  recentMessages: Array<{ role: string; content: string }>
}) {
  const { sb, userId, conversationId, characterId, inputEvent, userInput, assistantText, conversationState, characterState, recentMessages } = args
  try {
    const turnSeq = await nextTurnSeqForConversation({ sb, conversationId, conversationState })
    const patchInput = {
      state_before: {
        conversation_state: conversationState,
        character_state: characterState,
      },
      turn: {
        time_local: new Date().toISOString(),
        region: 'GLOBAL',
        turn_seq: turnSeq,
        input_event: inputEvent,
        user_input: userInput,
        assistant_text: assistantText,
        user_card: '',
      },
      dynamic_context_used: '',
      recent_messages: recentMessages.slice(-12),
      facts_before_digest: asRecord(asRecord(conversationState)['ledger']),
    }
    await sb.from('patch_jobs').insert({
      user_id: userId,
      conversation_id: conversationId,
      character_id: characterId,
      turn_seq: turnSeq,
      patch_input: patchInput,
      status: 'pending',
    })
  } catch {
    // Best-effort: schedule should not fail if patch queueing fails.
  }
}

async function genScheduleSnippet(args: {
  mmBase: string
  mmKey: string
  characterName: string
  characterSystemPrompt: string
  conversationState: unknown
  recentMessages: Array<{ role: string; content: string }>
}) {
  const { mmBase, mmKey, characterName, characterSystemPrompt, conversationState, recentMessages } = args
  const cs = asRecord(conversationState)
  const mem = asRecord(cs['memory'])
  const ledger = asRecord(cs['ledger'])
  const plot = asRecord(cs['plot_board'])
  const memoryBRecent = asArray(mem['memory_b_recent'])
  const highlights = asArray(mem['highlights'])
  const wardrobe = asRecord(ledger['wardrobe'])
  const npcDb = asArray(ledger['npc_database'])
  const inventory = asArray(ledger['inventory'])
  const openThreads = asArray(plot['open_threads'])
  const axes = asRecord(plot['experience_axes'])

  const ctx = [
    `角色名：${characterName}`,
    '',
    '【角色设定】',
    characterSystemPrompt || '',
    '',
    '【最近对话（原文）】',
    recentMessages
      .slice(-18)
      .map((m) => `${m.role === 'assistant' ? characterName : '{user}'}: ${m.content}`)
      .join('\n'),
    '',
    '【记忆摘要】',
    JSON.stringify({ memory_b_recent: memoryBRecent, highlights }).slice(0, 1800),
    '',
    '【账本摘要】',
    JSON.stringify({ wardrobe, npc_database: npcDb, inventory }).slice(0, 1200),
    '',
    '【剧情板摘要】',
    JSON.stringify({ open_threads: openThreads, experience_axes: axes }).slice(0, 1200),
  ].join('\n')

  const sys = `你正在扮演一个沉浸式角色。你不是助手。你要输出一条“聊天窗口里的括号生活片段”。

硬约束：
- 只输出一条括号消息，格式类似：（...）
- 内容必须是角色在用户不在时的生活小片段：做了什么/看到了什么/结果/感受
- 必须贴合角色设定、世界观、以及最近对话
- 禁止输出对话台词（不能出现“角色名：”或引号台词），只能是括号旁白
- 80~180 字，中文
- 禁止元叙事（不要提到模型/提示词/数据库）`

  const out = (await callMiniMax(mmBase, mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: sys },
      { role: 'user', name: 'User', content: ctx },
    ],
    temperature: 0.9,
    top_p: 0.9,
    max_completion_tokens: 320,
  })) as MiniMaxResponse

  const text = clip(pickMiniMaxText(out), 500)
  const m = text.match(/（[\s\S]{10,300}）/)
  if (m) return m[0].trim()
  const inner = text.replace(/^[（(]|[)）]$/g, '').trim()
  return `（${inner}）`
}

async function genMomentPost(args: {
  mmBase: string
  mmKey: string
  characterName: string
  characterSystemPrompt: string
  conversationState: unknown
  recentMessages: Array<{ role: string; content: string }>
}) {
  const { mmBase, mmKey, characterName, characterSystemPrompt, conversationState, recentMessages } = args
  const cs = asRecord(conversationState)
  const mem = asRecord(cs['memory'])
  const ledger = asRecord(cs['ledger'])
  const plot = asRecord(cs['plot_board'])

  const memoryBRecent = asArray(mem['memory_b_recent'])
  const highlights = asArray(mem['highlights'])
  const wardrobe = asRecord(ledger['wardrobe'])
  const npcDb = asArray(ledger['npc_database'])
  const inventory = asArray(ledger['inventory'])
  const openThreads = asArray(plot['open_threads'])

  const ctx = [
    `角色名：${characterName}`,
    '',
    '【角色设定】',
    characterSystemPrompt || '',
    '',
    '【最近对话（原文）】',
    recentMessages
      .slice(-18)
      .map((m) => `${m.role === 'assistant' ? characterName : '{user}'}: ${m.content}`)
      .join('\n'),
    '',
    '【记忆摘要】',
    JSON.stringify({ memory_b_recent: memoryBRecent, highlights }).slice(0, 1800),
    '',
    '【账本摘要】',
    JSON.stringify({ wardrobe, npc_database: npcDb, inventory }).slice(0, 1200),
    '',
    '【剧情板摘要】',
    JSON.stringify({ open_threads: openThreads }).slice(0, 800),
  ].join('\n')

  const sys = `你正在扮演一个沉浸式角色。请你写一条“朋友圈动态”（不是对话）。\n` +
    `硬约束：\n` +
    `- 只输出朋友圈正文，不要标题，不要解释，不要JSON，不要提到模型/提示词/数据库\n` +
    `- 不能出现对话格式（不能有“角色名：”或引号台词）\n` +
    `- 内容应该像角色发在社交平台：做了什么、看到了什么、结果/感受\n` +
    `- 允许轻微暧昧或生活情绪，但避免露骨\n` +
    `- 80~200字中文，可带1~3个话题标签（例如 #雨夜 #训练 #想你）\n`

  const out = (await callMiniMax(mmBase, mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: sys },
      { role: 'user', name: 'User', content: ctx },
    ],
    temperature: 0.9,
    top_p: 0.9,
    max_completion_tokens: 420,
  })) as MiniMaxResponse

  const text = clip(pickMiniMaxText(out), 700)
  // Ensure it's a "post", not bracket narration.
  return text.replace(/^[（(]|[)）]$/g, '').trim()
}

async function genDailyDiary(args: {
  mmBase: string
  mmKey: string
  characterName: string
  characterSystemPrompt: string
  recentMessages: Array<{ role: string; content: string }>
}) {
  const { mmBase, mmKey, characterName, characterSystemPrompt, recentMessages } = args

  const ctx = [
    `角色名：${characterName}`,
    '',
    '【角色设定】',
    characterSystemPrompt || '',
    '',
    '【今天的对话（原文节选）】',
    recentMessages
      .slice(-26)
      .map((m) => `${m.role === 'assistant' ? characterName : '{user}'}: ${m.content}`)
      .join('\n'),
  ].join('\n')

  const sys = `你正在扮演一个沉浸式角色。请你写一篇“日记”，内容是角色对自己生活、以及与 {user} 有关的事情的柔软感想。

硬约束：
- 只输出日记正文，不要标题/日期
- 第一人称（用“我”）
- 220~520 字，中文
- 不能出现对话格式（不要“角色名：”）
- 避免露骨内容
- 不要提到模型/提示词/数据库`

  const out = (await callMiniMax(mmBase, mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: sys },
      { role: 'user', name: 'User', content: ctx },
    ],
    temperature: 0.95,
    top_p: 0.9,
    max_completion_tokens: 900,
  })) as MiniMaxResponse

  return clip(pickMiniMaxText(out), 1400)
}

export async function POST(req: Request) {
  try {
    requireCronSecret(req)

    const mmKey = process.env.MINIMAX_API_KEY
    const mmBase = process.env.MINIMAX_BASE_URL
    if (!mmKey || !mmBase) return NextResponse.json({ error: 'Missing MINIMAX env (MINIMAX_API_KEY / MINIMAX_BASE_URL)' }, { status: 500 })

    const sb = createAdminClient()
    const now = new Date()
    const idleMins = clamp(Number(process.env.SCHEDULE_IDLE_MINUTES ?? 60), 10, 24 * 60)
    const maxConversations = clamp(Number(process.env.SCHEDULE_CRON_MAX_CONVERSATIONS ?? 20), 1, 80)
    const momentStrictHourly = envFlag(process.env.MOMENT_POST_STRICT_HOURLY, true)
    const momentMinMinutes = clamp(Number(process.env.MOMENT_POST_MINUTES ?? 60), 10, 24 * 60)
    const momentProb = clamp(Number(process.env.MOMENT_POST_PROB ?? 1), 0, 1)
    const momentHardCadence = envFlag(process.env.MOMENT_POST_HARD_CADENCE, true)

    const convs = await sb.from('conversations').select('id,user_id,character_id,created_at,title').order('created_at', { ascending: false }).limit(300)
    if (convs.error) return NextResponse.json({ error: convs.error.message }, { status: 500 })

    let scheduleOk = 0
    let diaryOk = 0
    let momentOk = 0
    let considered = 0

    type ConvRow = { id: string; user_id: string; character_id: string; created_at?: string | null }
    type MsgRow = { role: string; content: string; created_at?: string | null }

    for (const c of (convs.data ?? []) as ConvRow[]) {
      if (considered >= maxConversations) break
      const convId = String(c.id || '')
      const userId = String(c.user_id || '')
      const characterId = String(c.character_id || '')
      if (!convId || !userId || !characterId) continue

      considered++

      const ch = await sb.from('characters').select('name,system_prompt').eq('id', characterId).maybeSingle()
      if (ch.error || !ch.data?.system_prompt) continue
      const characterName = String(ch.data.name || '角色')
      const sysPrompt = String(ch.data.system_prompt || '')

      const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', convId).maybeSingle()
      let stState: unknown = st.data?.state ?? {}
      let stVersion = Number(st.data?.version ?? 0)
      let scheduleControl = readScheduleControl(stState, now)
      if (!st.error && st.data && scheduleControl.lockMode === 'story_lock' && scheduleControl.lockExpired) {
        const cleared = await clearExpiredStoryLockBestEffort({
          sb,
          conversationId: convId,
          state: stState,
          version: stVersion,
        })
        if (cleared) {
          const stReload = await sb.from('conversation_states').select('state,version').eq('conversation_id', convId).maybeSingle()
          stState = stReload.data?.state ?? stState
          stVersion = Number(stReload.data?.version ?? stVersion)
          scheduleControl = readScheduleControl(stState, now)
        }
      }

      const lastUser = await sb
        .from('messages')
        .select('created_at')
        .eq('conversation_id', convId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastMsg = await sb
        .from('messages')
        .select('created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastUserAt = lastUser.data?.created_at ? new Date(String(lastUser.data.created_at)) : null
      const lastMsgAt = lastMsg.data?.created_at ? new Date(String(lastMsg.data.created_at)) : null
      const convCreatedAt = c.created_at ? new Date(String(c.created_at)) : null
      const idleAnchorAt = lastUserAt || lastMsgAt || convCreatedAt
      if (!idleAnchorAt || !Number.isFinite(idleAnchorAt.getTime())) continue
      const isIdle = idleAnchorAt <= minutesAgo(now, idleMins)

      const lastTick = await sb
        .from('messages')
        .select('created_at')
        .eq('conversation_id', convId)
        .eq('role', 'assistant')
        .eq('input_event', 'SCHEDULE_TICK')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastTickAt = lastTick.data?.created_at ? new Date(String(lastTick.data.created_at)) : null
      const scheduleWindowOpen = isIdle && (!lastTickAt || lastTickAt <= minutesAgo(now, idleMins))
      const canRunScheduledContent = scheduleWindowOpen && !scheduleControl.blocked

      let recentMessagesCache: Array<{ role: string; content: string }> | null = null
      let characterStateCache: unknown | undefined
      const loadRecentMessages = async () => {
        if (recentMessagesCache) return recentMessagesCache
        const msg = await sb
          .from('messages')
          .select('role,content,created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(40)
        recentMessagesCache = ((msg.data ?? []) as MsgRow[])
          .slice()
          .reverse()
          .map((m) => ({ role: String(m.role || ''), content: String(m.content || '') }))
        return recentMessagesCache
      }
      const loadCharacterState = async () => {
        if (typeof characterStateCache !== 'undefined') return characterStateCache
        const chst = await sb.from('character_states').select('state').eq('character_id', characterId).maybeSingle()
        characterStateCache = chst.data?.state ?? {}
        return characterStateCache
      }

      if (canRunScheduledContent) {
        const recent = await loadRecentMessages()
        const chstState = await loadCharacterState()

        const snippetRaw = await genScheduleSnippet({
          mmBase,
          mmKey,
          characterName,
          characterSystemPrompt: sysPrompt,
          conversationState: stState,
          recentMessages: recent,
        })
        const snippet = ensureScheduleSnippet(snippetRaw)

        const ins = await sb.from('messages').insert({
          user_id: userId,
          conversation_id: convId,
          role: 'assistant',
          content: snippet,
          input_event: 'SCHEDULE_TICK',
        })
        if (!ins.error) {
          scheduleOk++
          await enqueuePatchJobBestEffort({
            sb,
            userId,
            conversationId: convId,
            characterId,
            inputEvent: 'SCHEDULE_TICK',
            userInput: '',
            assistantText: snippet,
            conversationState: stState,
            characterState: chstState,
            recentMessages: recent,
          })
        }
      }

      // Moments: default to hard hourly cadence by UTC hour even if user is active.
      // Set MOMENT_POST_HARD_CADENCE=false to fall back to idle-gated behavior.
      try {
        let shouldPost = false
        if (!scheduleControl.blocked) {
          const now2 = new Date()
          if (momentHardCadence) {
            const hourStart = hourStartUtc(now2)
            const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000)
            const momentThisHour = await sb
              .from('messages')
              .select('id')
              .eq('conversation_id', convId)
              .eq('role', 'assistant')
              .eq('input_event', 'MOMENT_POST')
              .gte('created_at', hourStart.toISOString())
              .lt('created_at', hourEnd.toISOString())
              .limit(1)
              .maybeSingle()
            shouldPost = !momentThisHour.data?.id
          } else if (canRunScheduledContent) {
            if (momentStrictHourly) {
              const hourStart = hourStartUtc(now2)
              const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000)
              const momentThisHour = await sb
                .from('messages')
                .select('id')
                .eq('conversation_id', convId)
                .eq('role', 'assistant')
                .eq('input_event', 'MOMENT_POST')
                .gte('created_at', hourStart.toISOString())
                .lt('created_at', hourEnd.toISOString())
                .limit(1)
                .maybeSingle()
              shouldPost = !momentThisHour.data?.id
            } else {
              const momentCutoff = minutesAgo(now2, momentMinMinutes)
              const momentRecent = await sb
                .from('messages')
                .select('id')
                .eq('conversation_id', convId)
                .eq('role', 'assistant')
                .eq('input_event', 'MOMENT_POST')
                .gte('created_at', momentCutoff.toISOString())
                .limit(1)
                .maybeSingle()
              shouldPost = !momentRecent.data?.id && Math.random() < momentProb
            }
          }
        }

        if (shouldPost) {
          const recent = await loadRecentMessages()
          const chstState = await loadCharacterState()
          const postTextRaw = await genMomentPost({
            mmBase,
            mmKey,
            characterName,
            characterSystemPrompt: sysPrompt,
            conversationState: stState,
            recentMessages: recent,
          })
          const postText = normalizeMomentPost(postTextRaw)
          const insM = await sb.from('messages').insert({
            user_id: userId,
            conversation_id: convId,
            role: 'assistant',
            content: postText,
            input_event: 'MOMENT_POST',
          })
          if (!insM.error) {
            momentOk++
            await enqueuePatchJobBestEffort({
              sb,
              userId,
              conversationId: convId,
              characterId,
              inputEvent: 'MOMENT_POST',
              userInput: '',
              assistantText: postText,
              conversationState: stState,
              characterState: chstState,
              recentMessages: recent,
            })
          }
        }
      } catch {
        // ignore
      }

      const day = dayKeyUtc(now)
      const start = dayStartUtc(now)
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
      const diaryExists = await sb
        .from('messages')
        .select('id')
        .eq('conversation_id', convId)
        .eq('role', 'assistant')
        .eq('input_event', 'DIARY_DAILY')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .limit(1)
        .maybeSingle()

      if (!scheduleControl.blocked && !diaryExists.data?.id) {
        const dayMsgs = await sb
          .from('messages')
          .select('role,content,created_at')
          .eq('conversation_id', convId)
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
          .order('created_at', { ascending: true })
          .limit(120)

        const diary = await genDailyDiary({
          mmBase,
          mmKey,
          characterName,
          characterSystemPrompt: sysPrompt,
          recentMessages: ((dayMsgs.data ?? []) as MsgRow[]).map((m) => ({ role: String(m.role || ''), content: String(m.content || '') })),
        })

        const content = `【日记 ${day}】\n${clip(diary, 1800)}`
        const ins2 = await sb.from('messages').insert({
          user_id: userId,
          conversation_id: convId,
          role: 'assistant',
          content,
          input_event: 'DIARY_DAILY',
        })
        if (!ins2.error) {
          diaryOk++
          const st2 = await sb.from('conversation_states').select('state').eq('conversation_id', convId).maybeSingle()
          const chst2 = await sb.from('character_states').select('state').eq('character_id', characterId).maybeSingle()
          await enqueuePatchJobBestEffort({
            sb,
            userId,
            conversationId: convId,
            characterId,
            inputEvent: 'DIARY_DAILY',
            userInput: '',
            assistantText: content,
            conversationState: st2.data?.state ?? {},
            characterState: chst2.data?.state ?? {},
            recentMessages: ((dayMsgs.data ?? []) as MsgRow[]).map((m) => ({ role: String(m.role || ''), content: String(m.content || '') })),
          })
        }
      }
    }

    return NextResponse.json({ ok: true, considered, schedule_ok: scheduleOk, diary_ok: diaryOk, moment_ok: momentOk })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Vercel Cron invokes scheduled routes with GET requests. Keep POST for manual triggers,
// but support GET so vercel.json crons work without extra tooling.
export async function GET(req: Request) {
  return POST(req)
}
