import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizePatchOutput } from '@/lib/patchValidation'
import { buildDynamicContextText } from '@/lib/prompt/dynamicContext'
import { buildPromptOs, derivePromptOsPolicy } from '@/lib/prompt/promptOs'

type JsonObject = Record<string, unknown>

type DbMessageRow = { role: string; content: string; created_at?: string | null; input_event?: string | null }
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
  regenerate?: boolean
  replaceLastAssistant?: boolean
}

// "20-30 rounds" => ~40-60 messages (user+assistant). Use 60 as a sane default.
const MEMORY_A_MESSAGES_LIMIT = 60
const MEMORY_B_EPISODES_LIMIT = 20
const PATCH_APPLY_MAX_RETRIES = 5
const PATCH_APPLY_RETRY_BASE_MS = 80
const MINIMAX_PRIMARY_TIMEOUT_MS = 45_000
const MINIMAX_REWRITE_TIMEOUT_MS = 30_000
const MINIMAX_PATCH_TIMEOUT_MS = 35_000

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

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function listIncludes(arr: unknown[], target: string) {
  return arr.map((x) => String(x || '').trim()).filter(Boolean).includes(target)
}

function getConversationAppliedPatchJobIds(state: unknown) {
  const root = asRecord(state)
  const run = asRecord(root['run_state'])
  const fromRun = asArray(run['applied_patch_job_ids']).map((x) => String(x || '').trim()).filter(Boolean)
  const fromRoot = asArray(root['applied_patch_job_ids']).map((x) => String(x || '').trim()).filter(Boolean)
  const set = new Set<string>([...fromRun, ...fromRoot])
  return Array.from(set)
}

function setConversationAppliedPatchJobIds(state: JsonObject, ids: string[]) {
  const uniq = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))).slice(-240)
  const run = asRecord(state['run_state'])
  run['applied_patch_job_ids'] = uniq
  state['run_state'] = run
  state['applied_patch_job_ids'] = uniq
}

function getCharacterAppliedPatchJobIds(state: unknown) {
  const root = asRecord(state)
  return asArray(root['applied_patch_job_ids']).map((x) => String(x || '').trim()).filter(Boolean)
}

function setCharacterAppliedPatchJobIds(state: JsonObject, ids: string[]) {
  state['applied_patch_job_ids'] = Array.from(new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))).slice(-240)
}

function normalizePlotGranularityServer(v: unknown): 'LINE' | 'BEAT' | 'SCENE' {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'LINE' || s === 'SCENE') return s
  return 'BEAT'
}

function normalizeEndingModeServer(v: unknown): 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED' {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'QUESTION' || s === 'ACTION' || s === 'CLIFF') return s
  return 'MIXED'
}

function normalizeEndingWindowServer(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 6
  return Math.max(3, Math.min(Math.floor(n), 12))
}

function normalizeEndingHintsServer(v: unknown): string[] {
  const src = asArray(v)
  const out: string[] = []
  for (const x of src) {
    const s = String(x || '').trim()
    if (!s) continue
    out.push(s)
    if (out.length >= 6) break
  }
  return out
}

function applyPromptPolicyFromSettings(args: { conversationState: JsonObject; characterSettings: unknown }) {
  const { conversationState, characterSettings } = args
  const set = asRecord(characterSettings)
  const policy = asRecord(set['prompt_policy'])

  const run = asRecord(conversationState['run_state'])
  const style = asRecord(conversationState['style_guard'])

  const rm = set['romance_mode']
  const am = set['age_mode']
  const teenMode = set['teen_mode']
  if (rm === 'ROMANCE_ON' || rm === 'ROMANCE_OFF') run['romance_mode'] = rm
  if (am === 'teen' || am === 'adult') run['age_mode'] = am
  if (typeof teenMode === 'boolean') run['age_mode'] = teenMode ? 'teen' : run['age_mode']
  if (run['age_mode'] === 'teen') run['romance_mode'] = 'ROMANCE_OFF'

  run['plot_granularity'] = normalizePlotGranularityServer(policy['plot_granularity'] ?? set['plot_granularity'] ?? run['plot_granularity'])
  run['ending_mode'] = normalizeEndingModeServer(policy['ending_mode'] ?? set['ending_mode'] ?? run['ending_mode'])
  style['ending_repeat_window'] = normalizeEndingWindowServer(
    policy['ending_repeat_window'] ?? set['ending_repeat_window'] ?? style['ending_repeat_window'],
  )
  const hints = normalizeEndingHintsServer(policy['next_endings_prefer'] ?? set['next_endings_prefer'] ?? style['next_endings_prefer'])
  style['next_endings_prefer'] = hints.length ? hints : ['A', 'B', 'S']

  conversationState['run_state'] = run
  conversationState['style_guard'] = style
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

function hasUserSpeechMarker(text: string) {
  const t = String(text || '')
  if (!t) return false
  return /(^|\n)\s*(\{?user\}?|USER|User|user|用户|你)\s*[:：]/.test(t)
}

function isDialogueLine(text: string) {
  const line = String(text || '').trim()
  if (!line) return false
  if (/^[\(\[]/.test(line)) return false
  if (!/^.{1,24}[:：]/.test(line)) return false
  const speaker = (line.match(/^([^:\n：]{1,16})\s*[:：]/)?.[1] || '').trim()
  return !!speaker
}

function getDialogueSpeaker(line: string) {
  return (String(line || '').trim().match(/^([^:\n：]{1,16})\s*[:：]/)?.[1] || '').trim()
}

function normalizeSpeakerName(name: string) {
  return String(name || '')
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .trim()
    .toLowerCase()
}

function isBracketSnippet(text: string) {
  const t = String(text || '').trim()
  if (!t) return false
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean)
  if (lines.length !== 1) return false
  const line = lines[0] || ''
  if (!/^[\(\[].+[\)\]]$/.test(line)) return false
  return line.slice(1, -1).trim().length >= 2
}

type GuardIssue =
  | 'EMPTY'
  | 'PROMPT_LEAK'
  | 'JSON_LEAK'
  | 'USER_SPEECH'
  | 'FUNC_DBL_DIALOGUE'
  | 'SCHEDULE_FORMAT'
  | 'SPEAKER_OUTSIDE_SET'
  | 'DUPLICATE_ANSWER'
  | 'ENDING_REPEAT'
  | 'STRICT_MULTICAST_FORMAT'

function normalizeTextForSimilarity(text: string) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,!?;:'"`~\-_=+*(){}\[\]<>/\\|@#$%^&，。！？；：“”‘’、·…]/g, '')
}

function toBigramSet(text: string) {
  const s = normalizeTextForSimilarity(text)
  const out = new Set<string>()
  if (!s) return out
  if (s.length < 2) {
    out.add(s)
    return out
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

function bigramJaccard(a: string, b: string) {
  const sa = toBigramSet(a)
  const sb = toBigramSet(b)
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const x of sa) {
    if (sb.has(x)) inter += 1
  }
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

function looksLikeDuplicateAssistantAnswer(text: string, recentAssistantTexts: string[]) {
  const curr = String(text || '').trim()
  if (!curr) return false
  if (curr.length < 18) return false
  const currNorm = normalizeTextForSimilarity(curr)
  if (!currNorm) return false

  const recent = (recentAssistantTexts || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(-4)

  for (const prev of recent) {
    if (prev.length < 18) continue
    const prevNorm = normalizeTextForSimilarity(prev)
    if (!prevNorm) continue
    if (currNorm === prevNorm) return true
    if (currNorm.length > 32 && prevNorm.length > 32 && (currNorm.includes(prevNorm) || prevNorm.includes(currNorm))) return true
    if (bigramJaccard(curr, prev) >= 0.88) return true
  }

  return false
}

function extractEndingTail(text: string) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const lines = raw
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const tailLine = lines[lines.length - 1] || raw
  const segs = tailLine
    .split(/(?<=[。！？.!?])/)
    .map((x) => x.trim())
    .filter(Boolean)
  const tailSentence = segs[segs.length - 1] || tailLine
  return tailSentence.slice(-120)
}

function looksLikeRepeatedEnding(text: string, recentAssistantTexts: string[]) {
  const currTail = extractEndingTail(text)
  if (!currTail || currTail.length < 8) return false
  const currNorm = normalizeTextForSimilarity(currTail)
  if (!currNorm || currNorm.length < 6) return false

  const recent = (recentAssistantTexts || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(-6)

  for (const prev of recent) {
    const prevTail = extractEndingTail(prev)
    if (!prevTail || prevTail.length < 8) continue
    const prevNorm = normalizeTextForSimilarity(prevTail)
    if (!prevNorm || prevNorm.length < 6) continue
    if (currNorm === prevNorm) return true
    if (bigramJaccard(currTail, prevTail) >= 0.92) return true
  }
  return false
}

function getAssistantOutputGuardIssues(args: {
  text: string
  inputEvent: InputEvent | null
  userMessageForModel?: string
  allowedSpeakers?: string[]
  enforceSpeakerSet?: boolean
  recentAssistantTexts?: string[]
}) {
  const { text, inputEvent, userMessageForModel, allowedSpeakers = [], enforceSpeakerSet = false, recentAssistantTexts = [] } = args
  const s = String(text || '').trim()
  const issues: GuardIssue[] = []
  const push = (issue: GuardIssue) => {
    if (!issues.includes(issue)) issues.push(issue)
  }
  if (!s) {
    push('EMPTY')
    return issues
  }

  if (s.includes('<STATE_PATCH>') || s.includes('PATCH_INPUT') || s.includes('PatchScribe') || s.includes('DYNAMIC_CONTEXT')) push('PROMPT_LEAK')
  if (s.includes('focus_panel_next') && s.includes('run_state_patch')) push('PROMPT_LEAK')
  if (/^\s*[\{\[]/.test(s)) {
    const j = safeExtractJsonObject(s)
    if (j && typeof j === 'object') push('JSON_LEAK')
  }

  if (hasUserSpeechMarker(s)) push('USER_SPEECH')

  if (inputEvent === 'FUNC_DBL') {
    const lines = s.split('\n').map((x) => x.trim())
    if (lines.some((line) => isDialogueLine(line))) push('FUNC_DBL_DIALOGUE')
  }
  if (inputEvent === 'SCHEDULE_TICK') {
    if (!isBracketSnippet(s)) push('SCHEDULE_FORMAT')
    const lines = s.split('\n').map((x) => x.trim())
    if (lines.some((line) => isDialogueLine(line))) push('SCHEDULE_FORMAT')
  }

  if (enforceSpeakerSet) {
    const allowed = new Set(
      allowedSpeakers
        .map((x) => normalizeSpeakerName(String(x || '')))
        .filter(Boolean)
        .filter((x) => x !== 'user'),
    )
    const roleLines = s.split('\n').map((x) => x.trim()).filter((line) => isDialogueLine(line))
    if (roleLines.length) {
      const unknownSpeaker = roleLines.some((line) => {
        const speaker = normalizeSpeakerName(getDialogueSpeaker(line))
        if (!speaker) return false
        if (speaker === 'user' || speaker === '{user}') return true
        return allowed.size > 0 && !allowed.has(speaker)
      })
      if (unknownSpeaker) push('SPEAKER_OUTSIDE_SET')
    }
  }

  if (typeof userMessageForModel === 'string' && isStrictMultiCast(userMessageForModel)) {
    const lines = s.split('\n').map((x) => x.trim()).filter(Boolean)
    const roleLines = lines.filter((line) => isDialogueLine(line))
    if (roleLines.length < 2) push('STRICT_MULTICAST_FORMAT')
    if (roleLines.some((line) => hasUserSpeechMarker(line))) push('STRICT_MULTICAST_FORMAT')
  }

  if (inputEvent !== 'SCHEDULE_TICK' && looksLikeDuplicateAssistantAnswer(s, recentAssistantTexts)) {
    push('DUPLICATE_ANSWER')
  }
  if (inputEvent !== 'SCHEDULE_TICK' && looksLikeRepeatedEnding(s, recentAssistantTexts)) {
    push('ENDING_REPEAT')
  }

  return issues
}

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
    TALK_HOLD: '(dialog)',
    FUNC_HOLD: '(narration)',
    TALK_DBL: '(continue_story)',
    FUNC_DBL: '(generate_cg)',
    SCHEDULE_TICK: '(schedule_tick)',
    SCHEDULE_PLAY: '(schedule_play)',
    SCHEDULE_PAUSE: '(schedule_pause)',
  }
  return map[ev] || `(${ev})`
}

function isStrictMultiCast(text: string) {
  const t = String(text || '')
  return /strict\s*multi|multi[-_\s]*cast|round[-_\s]*robin|alternate/i.test(t) || /轮流|多角色|严格演绎|继续演绎/.test(t)
}

function isExitMultiCast(text: string) {
  const t = String(text || '')
  return /exit\s*multi|stop\s*multi|back\s*to\s*single|end\s*round[-_\s]*robin/i.test(t) || /结束演绎|回到单聊|停止多角色|退出演绎|结束轮流/.test(t)
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

  for (const m of t.matchAll(/(^|\n)\s*([A-Za-z0-9_\u4e00-\u9fa5]{1,12})\s*[:：]\s*[^\n]*/g)) {
    push(m[2])
  }

  for (const m of t.matchAll(/([A-Za-z0-9_\u4e00-\u9fa5]{1,12})\s*(?:and|&|和)\s*([A-Za-z0-9_\u4e00-\u9fa5]{1,12})/gi)) {
    push(m[1])
    push(m[2])
  }

  if (isStrictMultiCast(t)) {
    for (const m of t.matchAll(/\b([A-Za-z0-9_\u4e00-\u9fa5]{1,12})\b(?=\s*[,、/]\s*[A-Za-z0-9_\u4e00-\u9fa5]{1,12})/g)) {
      push(m[1])
    }
  }

  return out.slice(0, 6)
}

function buildGuardRewriteConstraints(args: {
  issues: GuardIssue[]
  inputEvent: InputEvent | null
  allowedSpeakers?: string[]
  enforceSpeakerSet?: boolean
}) {
  const { issues, inputEvent, allowedSpeakers = [], enforceSpeakerSet = false } = args
  const lines: string[] = [
    '- Output plain user-facing character text only. No JSON, no meta explanations, no policy text.',
    '- Never write lines for the user (forbidden patterns include `User:`, `用户:`, `你:` speaker lines).',
  ]
  if (inputEvent === 'FUNC_DBL') {
    lines.push('- FUNC_DBL: camera-style visual narration only, no dialogue lines.')
  }
  if (inputEvent === 'SCHEDULE_TICK') {
    lines.push('- SCHEDULE_TICK: output exactly one bracketed life snippet, no dialogue lines.')
  }
  if (enforceSpeakerSet) {
    const allowed = allowedSpeakers
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .filter((x) => normalizeSpeakerName(x) !== 'user')
    if (allowed.length) lines.push(`- Speaker whitelist: ${allowed.join(', ')}.`)
    lines.push('- If using `Name:` dialogue lines, speakers must be from the whitelist only.')
  }
  if (issues.includes('STRICT_MULTICAST_FORMAT')) {
    lines.push('- In strict multi-cast, output at least two dialogue lines with visible turn rotation.')
  }
  if (issues.includes('DUPLICATE_ANSWER')) {
    lines.push('- Do not repeat prior assistant phrasing. Move plot/state forward with concrete new detail.')
  }
  if (issues.includes('ENDING_REPEAT')) {
    lines.push('- Avoid repeating previous ending sentence pattern; choose a different ending action/question tone.')
  }
  return lines.join('\n')
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
      mode: '鍗曡亰',
      narration_mode: 'DIALOG',
      scene: '',
      current_main_role: '',
      present_characters: ['{user}', '{role}'],
      goal: '',
      schedule_state: 'PLAY',
      plot_granularity: 'BEAT',
      ending_mode: 'MIXED',
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
      schedule_state: 'PLAY',
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
      ending_repeat_window: 6,
      next_endings_prefer: ['A', 'B', 'S'],
    },
    fact_patch: [],
    moderation_flags: {},
  }
}

function defaultCharacterState() {
  return {
    version: '1.0',
    applied_patch_job_ids: [],
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
    if (run.age_mode === 'teen') run.romance_mode = 'ROMANCE_OFF'
    run.plot_granularity = normalizePlotGranularityServer(set['plot_granularity'] ?? run.plot_granularity)
    run.ending_mode = normalizeEndingModeServer(set['ending_mode'] ?? run.ending_mode)
  }
  applyPromptPolicyFromSettings({ conversationState: cs, characterSettings })
  // Output mode hint
  {
    const ev = inputEvent || 'TALK_HOLD'
    run.output_mode = ev === 'FUNC_DBL' ? 'CG' : ev === 'SCHEDULE_TICK' ? 'SCHEDULE' : 'CHAT'
  }
  // User drive-state hint (used by the prompt OS for plot granularity)
  const exitMultiCast = typeof userMessageForModel === 'string' ? isExitMultiCast(userMessageForModel) : false
  if (typeof userMessageForModel === 'string') {
    const t = userMessageForModel.trim()
    run.user_drive = inputEvent === 'TALK_DBL' ? 'PERMIT_CONTINUE' : t.length <= 2 ? 'PASSIVE' : 'ACTIVE'
    run.reconcile_hint = /你记不记得|到底是什么|说清楚|确认一下|别糊弄|你说错了|不是这样的|别编|reconcile|fact\s*check|核对/i.test(t)
      ? 'RECONCILE'
      : ''
    if (isExitMultiCast(t)) run.multi_cast_hint = ''
    else run.multi_cast_hint = isStrictMultiCast(t) ? 'MULTI_CAST' : ''
  }
  // Narration mode: a single compact switch that prompt rules can rely on.
  {
    const ev = inputEvent || 'TALK_HOLD'
    const strictMultiCast = run.multi_cast_hint === 'MULTI_CAST'
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

  // Exit cleanup: avoid residual multi-cast stage state when user switches back to single-role chat.
  if (exitMultiCast) {
    run.narration_mode = 'DIALOG'
    run.multi_cast_hint = ''
    run.current_main_role = characterName || String(run.current_main_role || '{role}')
    run.present_characters = ['{user}', run.current_main_role]
    delete run.multi_cast_order
    delete run.multi_cast_turn_index
    delete run.multi_cast_next_speaker
  } else if (run.narration_mode === 'MULTI_CAST') {
    const names = typeof userMessageForModel === 'string' ? extractPresentCharacters(userMessageForModel) : []
    const presentRaw = Array.isArray(run['present_characters']) ? (run['present_characters'] as unknown[]) : []
    const present = Array.from(new Set(presentRaw.map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 8)
    const mainRole = characterName || String(run.current_main_role || '{role}')

    if (!present.includes('{user}')) present.unshift('{user}')
    if (mainRole && !present.includes(mainRole)) present.push(mainRole)

    const stageRoles = present.filter((x) => x !== '{user}')
    const existingOrder = asArray(run.multi_cast_order).map((x) => String(x || '').trim()).filter((x) => !!x && stageRoles.includes(x))
    let order = existingOrder.length ? existingOrder : stageRoles

    if (names.length) {
      const picked = names.filter((x) => stageRoles.includes(x))
      order = [...picked, ...order.filter((x) => !picked.includes(x))]
    }
    for (const role of stageRoles) {
      if (!order.includes(role)) order.push(role)
    }
    order = order.slice(0, 8)

    if (order.length >= 2) {
      const idxRaw = Number(run.multi_cast_turn_index ?? 0)
      const idxBase = Number.isFinite(idxRaw) ? Math.floor(idxRaw) : 0
      const idx = ((idxBase % order.length) + order.length) % order.length
      run.multi_cast_order = order
      run.multi_cast_next_speaker = order[idx]
      run.multi_cast_turn_index = (idx + 1) % order.length
      run.present_characters = ['{user}', ...order]
      if (!run.current_main_role || !order.includes(String(run.current_main_role))) run.current_main_role = order[0]
    } else {
      run.narration_mode = 'DIALOG'
      run.present_characters = ['{user}', mainRole]
      run.current_main_role = mainRole
      delete run.multi_cast_order
      delete run.multi_cast_turn_index
      delete run.multi_cast_next_speaker
    }
  } else {
    delete run.multi_cast_next_speaker
  }

  return buildDynamicContextText({
    inputEvent,
    userCard,
    userMessageForModel,
    nowLocalIso: nowLocalIso(),
    characterName,
    systemPrompt,
    characterProfile,
    characterSettings,
    runState: run,
    focusPanel: asRecord(cs['focus_panel']),
    ipPack: asRecord(chs['ip_pack']),
    personaSystem: asRecord(chs['persona_system']),
    relationshipLadder: chs['relationship_ladder'] ?? null,
    plotBoard: asRecord(cs['plot_board']),
    scheduleBoard: asRecord(cs['schedule_board']),
    ledger: asRecord(cs['ledger']),
    factPatch: asArray(cs['fact_patch']),
    memoryState: asRecord(cs['memory']),
    styleGuard: asRecord(cs['style_guard']),
    memoryA,
    memoryB,
  })
}
function patchSystemPrompt() {
  return `You are PatchScribe. You will receive PATCH_INPUT JSON and must output exactly one JSON object.

Rules:
1) Strict JSON only: no markdown, no comments, no prose.
2) Keep all top-level keys present even if empty:
focus_panel_next, run_state_patch, plot_board_patch, persona_system_patch, ip_pack_patch,
schedule_board_patch, ledger_patch, memory_patch, style_guard_patch, fact_patch_add, moderation_flags
3) In ledger_patch, confirmed=true is allowed only when directly evidenced by turn text.
4) Clamp each experience_axes_delta value to [-0.2, 0.2].
5) run_state_patch may update narration_mode (DIALOG|NARRATION|MULTI_CAST|CG|SCHEDULE),
present_characters, current_main_role, relationship_stage, but it must stay consistent with input_event.
6) If user asks to exit multi-cast (for example: end roleplay / back to single chat),
set narration_mode to DIALOG and remove strict multi-cast constraints.

Output schema (example keys):
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
  "moderation_flags": {}
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

function isTransientMiniMaxStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

function isTransientMiniMaxBaseResp(statusCode: number, statusMsg: string) {
  if (statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504) return true
  const m = String(statusMsg || '').toLowerCase()
  return /rate|limit|too many|timeout|timed out|temporar|busy|overload|retry/.test(m)
}

async function callMiniMaxWithRetry(
  mmBase: string,
  mmKey: string,
  body: JsonObject,
  opts?: { timeoutMs?: number; retries?: number },
) {
  const timeoutMs = Math.max(2_000, Number(opts?.timeoutMs || MINIMAX_PRIMARY_TIMEOUT_MS))
  const retries = Math.max(0, Math.min(Number(opts?.retries ?? 1), 2))
  const url = joinUrl(mmBase, '/v1/text/chatcompletion_v2')
  let lastErr: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mmKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctl.signal,
      })
      const text = await resp.text()
      if (!resp.ok) {
        const msg = `MiniMax error: ${resp.status} ${text}`
        if (attempt < retries && isTransientMiniMaxStatus(resp.status)) {
          await sleep(220 * (attempt + 1))
          continue
        }
        throw new Error(msg)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        const j = safeExtractJsonObject(text)
        if (!j) throw new Error('MiniMax returned non-JSON response')
        parsed = j
      }
      const root = asRecord(parsed)
      const baseResp = asRecord(root['base_resp'])
      const baseCode = Number(baseResp['status_code'] ?? 0)
      const baseMsg = String(baseResp['status_msg'] ?? '')
      if (baseCode && attempt < retries && isTransientMiniMaxBaseResp(baseCode, baseMsg)) {
        await sleep(220 * (attempt + 1))
        continue
      }
      return parsed
    } catch (e: unknown) {
      const msg = formatErr(e)
      const aborted = msg.toLowerCase().includes('abort')
      const transientNet = /network|timed?\s*out|socket|econn|undici|fetch failed/i.test(msg)
      if (attempt < retries && (aborted || transientNet)) {
        await sleep(220 * (attempt + 1))
        continue
      }
      lastErr = e instanceof Error ? e : new Error(msg)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastErr || new Error('MiniMax request failed')
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

function hasUpdatedRows(data: unknown) {
  if (Array.isArray(data)) return data.length > 0
  return !!(data && typeof data === 'object')
}

async function claimPatchJobForProcessing(args: {
  sb: SupabaseClient<{ public: Record<string, never> }, 'public'>
  jobId: string
  fromStatuses: string[]
}) {
  const { sb, jobId, fromStatuses } = args
  const upd = await sb
    .from('patch_jobs')
    .update({ status: 'processing', last_error: '' } as unknown as never)
    .eq('id', jobId)
    .in('status', fromStatuses)
    .select('id')
  if (upd.error) throw new Error(upd.error.message)
  return hasUpdatedRows(upd.data)
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
    let inputEvent = normInputEvent(body.inputEvent)
    const userCardInput = typeof body.userCard === 'string' ? body.userCard : ''
    const regenerate = body.regenerate === true
    const replaceLastAssistant = regenerate && body.replaceLastAssistant === true

    if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 })
    if (regenerate && !conversationId) return NextResponse.json({ error: 'conversationId is required for regenerate' }, { status: 400 })
    // Allow empty message for event-driven turns like CG / schedule ticks.
    if (!userMessageTrim && !inputEvent && !regenerate) return NextResponse.json({ error: 'message or inputEvent is required' }, { status: 400 })

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
    const persistedUserCard = (() => {
      const s = asRecord(character.settings)
      const v = s['user_card']
      return typeof v === 'string' ? v.trim() : ''
    })()
    const effectiveUserCard = (userCardInput.trim() || persistedUserCard).slice(0, 300)

    // Create / reuse conversation
    let convId = conversationId
    if (convId) {
      const { data: convCheck, error: convCheckErr } = await sb.from('conversations').select('id').eq('id', convId).eq('user_id', userId).maybeSingle()
      if (convCheckErr || !convCheck) {
        if (regenerate) return NextResponse.json({ error: 'Conversation not found for regenerate' }, { status: 404 })
        convId = null
      }
    }
    if (!convId) {
      if (regenerate) return NextResponse.json({ error: 'conversationId is required for regenerate' }, { status: 400 })
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
      applyPromptPolicyFromSettings({ conversationState: asRecord(conversationState), characterSettings: character.settings })
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
      .select('role,content,created_at,input_event')
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

    let userMessageForModelRaw = userMessageRaw
    let userMessageForModelTrim = userMessageTrim
    if (regenerate && !userMessageForModelTrim && !inputEvent) {
      for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
        const row = recentMessages[i]
        if (String(row.role || '').toLowerCase() !== 'user') continue
        const txt = String(row.content || '')
        if (!txt.trim()) continue
        userMessageForModelRaw = txt
        userMessageForModelTrim = txt.trim()
        inputEvent = inputEvent || normInputEvent(row.input_event)
        break
      }
    }

    if (!userMessageForModelTrim && !inputEvent) {
      return NextResponse.json({ error: regenerate ? 'No user turn available for regenerate' : 'message or inputEvent is required' }, { status: 400 })
    }

    const userMessageForModel = userMessageForModelTrim || (inputEvent ? inputEventPlaceholder(inputEvent) : '')
    const userMessageToSave = userMessageForModelRaw || userMessageForModel

    // Write user message (legacy-safe input_event). Skip on regenerate to avoid duplicate user turns.
    if (!regenerate) {
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
      userCard: effectiveUserCard,
      userMessageForModel,
      characterName: character.name,
      systemPrompt: character.system_prompt,
      characterProfile: character.profile,
      characterSettings: character.settings,
      conversationState,
      characterState,
      memoryA: (() => {
        const src = recentMessages.slice()
        if (regenerate) {
          while (src.length && String(src[src.length - 1]?.role || '').toLowerCase() === 'assistant') src.pop()
        }
        return src.map((m) => ({ role: m.role, content: m.content }))
      })(),
      memoryB: recentEpisodes,
    })
    const promptPolicy = derivePromptOsPolicy({ conversationState, inputEvent })
    const promptOs = buildPromptOs(promptPolicy)
    const runStateForGuard = asRecord(asRecord(conversationState)['run_state'])
    const guardAllowedSpeakers = asArray(runStateForGuard['present_characters']).map((x) => String(x || '').trim()).filter(Boolean)
    const guardEnforceSpeakerSet =
      String(runStateForGuard['narration_mode'] || '') === 'MULTI_CAST' ||
      (typeof userMessageForModel === 'string' && isStrictMultiCast(userMessageForModel))

    // MiniMax M2-her expects chat-style messages. In practice, multiple `system` messages
    // may be treated as an unsupported "group chat" configuration, so we merge into one.
    const mmMessages: MiniMaxMessage[] = [
      { role: 'system', name: 'System', content: `${promptOs}\n\n${dynamic}` },
      ...(userMessageForModel ? [{ role: 'user' as const, name: 'User', content: userMessageForModel }] : []),
    ]

    const mmJson = (await callMiniMaxWithRetry(
      mmBase,
      mmKey,
      {
      model: 'M2-her',
      messages: mmMessages,
      temperature: 1,
      top_p: 0.9,
      max_completion_tokens: 2048,
      },
      { timeoutMs: MINIMAX_PRIMARY_TIMEOUT_MS, retries: 1 },
    )) as MiniMaxResponse

    const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
    const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
    if (baseCode) {
      return NextResponse.json({ error: `MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`, raw: mmJson }, { status: 502 })
    }

    let assistantMessage = mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? ''
    if (!assistantMessage) return NextResponse.json({ error: 'MiniMax returned empty content', raw: mmJson }, { status: 502 })
    const recentAssistantTexts = recentMessages
      .filter((m) => String(m.role || '').toLowerCase() === 'assistant')
      .map((m) => String(m.content || '').trim())
      .filter(Boolean)
      .slice(-4)

    // Guardrail: rare cases where the model violates output constraints (JSON leak / wrong mode).
    let guardIssues = getAssistantOutputGuardIssues({
      text: assistantMessage,
      inputEvent: inputEvent || null,
      userMessageForModel,
      allowedSpeakers: guardAllowedSpeakers,
      enforceSpeakerSet: guardEnforceSpeakerSet,
      recentAssistantTexts,
    })
    const guardTriggered = guardIssues.length > 0
    let guardRewriteUsed = false
    let guardFallbackUsed = false

    if (guardIssues.length > 0) {
      try {
        const rewriteConstraints = buildGuardRewriteConstraints({
          issues: guardIssues,
          inputEvent: inputEvent || null,
          allowedSpeakers: guardAllowedSpeakers,
          enforceSpeakerSet: guardEnforceSpeakerSet,
        })
        const rewrite = (await callMiniMaxWithRetry(
          mmBase,
          mmKey,
          {
          model: 'M2-her',
          messages: [
            {
              role: 'system',
              name: 'System',
              content:
                `${promptOs}\n\n` +
                `Your previous output broke the hard output constraints. Rewrite now and output only the final user-facing character text.\n` +
                `${rewriteConstraints}\n`,
            },
            {
              role: 'user',
              name: 'User',
              content:
                `INPUT_EVENT=${inputEvent || 'TALK_HOLD'}\nUSER_INPUT=${userMessageForModel}\nORIGINAL_OUTPUT:\n${assistantMessage}\n` +
                `RECENT_ASSISTANT_TAIL:\n${recentAssistantTexts.join('\n---\n')}`,
            },
          ],
          temperature: 0.2,
          top_p: 0.7,
          max_completion_tokens: 1200,
          },
          { timeoutMs: MINIMAX_REWRITE_TIMEOUT_MS, retries: 1 },
        )) as MiniMaxResponse

        const fixed = (rewrite?.choices?.[0]?.message?.content ?? rewrite?.reply ?? rewrite?.output_text ?? '').trim()
        if (fixed) {
          const fixedIssues = getAssistantOutputGuardIssues({
            text: fixed,
            inputEvent: inputEvent || null,
            userMessageForModel,
            allowedSpeakers: guardAllowedSpeakers,
            enforceSpeakerSet: guardEnforceSpeakerSet,
            recentAssistantTexts,
          })
          if (fixedIssues.length === 0) {
            guardRewriteUsed = true
            guardIssues = []
            assistantMessage = fixed
          } else {
            guardIssues = fixedIssues
          }
        }
      } catch {
        // ignore: fall back to original output
      }
    }

    // If still near-duplicate, force a continuation-style rewrite that adds concrete new progression.
    if (guardIssues.includes('DUPLICATE_ANSWER') || guardIssues.includes('ENDING_REPEAT')) {
      try {
        const dedupeRewrite = (await callMiniMaxWithRetry(
          mmBase,
          mmKey,
          {
          model: 'M2-her',
          messages: [
            {
              role: 'system',
              name: 'System',
              content:
                `${promptOs}\n\n` +
                `Rewrite the assistant output to avoid repetition and ending-pattern reuse. Keep voice/style, but add at least one concrete new progression detail.\n` +
                `Hard constraints: no JSON/meta text; never write user speaker lines.`,
            },
            {
              role: 'user',
              name: 'User',
              content:
                `USER_INPUT=${userMessageForModel}\nORIGINAL_OUTPUT:\n${assistantMessage}\n` +
                `RECENT_ASSISTANT_TAIL:\n${recentAssistantTexts.join('\n---\n')}`,
            },
          ],
          temperature: 0.3,
          top_p: 0.75,
          max_completion_tokens: 1200,
          },
          { timeoutMs: MINIMAX_REWRITE_TIMEOUT_MS, retries: 1 },
        )) as MiniMaxResponse

        const fixed2 = (dedupeRewrite?.choices?.[0]?.message?.content ?? dedupeRewrite?.reply ?? dedupeRewrite?.output_text ?? '').trim()
        if (fixed2) {
          const fixedIssues2 = getAssistantOutputGuardIssues({
            text: fixed2,
            inputEvent: inputEvent || null,
            userMessageForModel,
            allowedSpeakers: guardAllowedSpeakers,
            enforceSpeakerSet: guardEnforceSpeakerSet,
            recentAssistantTexts,
          })
          if (fixedIssues2.length === 0) {
            assistantMessage = fixed2
            guardIssues = []
            guardRewriteUsed = true
          } else {
            guardIssues = fixedIssues2
          }
        }
      } catch {
        // ignore
      }
    }

    // Safety-first fallback: never allow "assistant speaking for user" or off-stage speakers to pass through.
    if (guardIssues.includes('USER_SPEECH') || guardIssues.includes('SPEAKER_OUTSIDE_SET')) {
      guardFallbackUsed = true
      assistantMessage = '我听到了。你来决定下一步，我会按你的指令继续。'
      guardIssues = []
    }

    // Save assistant message (legacy-safe input_event).
    {
      if (replaceLastAssistant) {
        try {
          const lastAssistant = await sb
            .from('messages')
            .select('id')
            .eq('conversation_id', convIdFinal)
            .eq('user_id', userId)
            .eq('role', 'assistant')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (!lastAssistant.error && lastAssistant.data?.id) {
            await sb.from('messages').delete().eq('id', lastAssistant.data.id).eq('user_id', userId).eq('conversation_id', convIdFinal)
          }
        } catch {
          // best-effort: regenerate should still succeed even if replacement cleanup fails
        }
      }

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
    const patchRecentMessages = (() => {
      const src = (msgRows || []).slice()
      if (regenerate) {
        while (src.length && String(src[src.length - 1]?.role || '').toLowerCase() === 'assistant') src.pop()
      }
      return src.slice(-12)
    })()

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
        user_input: userMessageForModelRaw,
        assistant_text: assistantMessage,
        user_card: effectiveUserCard ? effectiveUserCard.slice(0, 520) : '',
      },
      dynamic_context_used: dynamic.slice(0, 8000),
      recent_messages: patchRecentMessages,
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
    let patchJobClaimed = false
    if (patchJobId) {
      try {
        patchJobClaimed = await claimPatchJobForProcessing({
          sb,
          jobId: patchJobId,
          fromStatuses: ['pending', 'failed'],
        })
      } catch {
        patchJobClaimed = false
      }
    }

    // Fire-and-forget PatchScribe now (doesn't block the response). Cron can retry from patch_jobs if needed.
    if (!patchJobId || patchJobClaimed) {
      void (async () => {
        try {
          const pJson = (await callMiniMaxWithRetry(
            mmBase,
            mmKey,
            {
            model: patchModel,
            messages: [
              { role: 'system', name: 'System', content: patchSystemPrompt() },
              { role: 'user', name: 'User', content: `PATCH_INPUT:\n${JSON.stringify(patchInput)}` },
            ],
            temperature: 0.2,
            top_p: 0.7,
            max_completion_tokens: 2048,
            },
            { timeoutMs: MINIMAX_PATCH_TIMEOUT_MS, retries: 1 },
          )) as MiniMaxResponse

          const patchText = pJson?.choices?.[0]?.message?.content ?? pJson?.reply ?? pJson?.output_text ?? ''
          const patchRaw = safeExtractJsonObject(patchText)
          if (!patchRaw || typeof patchRaw !== 'object') throw new Error('PatchScribe output is not valid JSON object')
          const patchEvidenceText = `${userMessageForModel}\n${assistantMessage}`

          const applyPatchOnce = async () => {
            const stNow = await sb.from('conversation_states').select('state,version').eq('conversation_id', convIdFinal).maybeSingle()
            if (stNow.error || !stNow.data?.state) throw new Error(`Load conversation_states failed: ${stNow.error?.message || 'no state'}`)
            const conversationStateVerNow = Number(stNow.data.version ?? 0)
            const conversationStateNow = structuredClone(stNow.data.state as unknown as Record<string, unknown>)

            const chNow = await sb.from('character_states').select('state,version').eq('character_id', characterId).maybeSingle()
            if (chNow.error || !chNow.data?.state) throw new Error(`Load character_states failed: ${chNow.error?.message || 'no state'}`)
            const characterStateVerNow = Number(chNow.data.version ?? 0)
            const characterStateNow = structuredClone(chNow.data.state as unknown as Record<string, unknown>)

            const convApplied = patchJobId ? listIncludes(getConversationAppliedPatchJobIds(conversationStateNow), patchJobId) : false
            const charApplied = patchJobId ? listIncludes(getCharacterAppliedPatchJobIds(characterStateNow), patchJobId) : false
            if (patchJobId && convApplied && charApplied) {
              await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', patchJobId)
              return
            }

            const patchObj = sanitizePatchOutput(patchRaw, {
              evidenceText: patchEvidenceText,
              conversationState: conversationStateNow,
              recentMessages: asArray(patchInput['recent_messages']),
            })
            if (!patchObj) throw new Error('Patch schema invalid')

            const convNext = structuredClone(conversationStateNow)
            const charNext = structuredClone(characterStateNow)

            const { memoryEpisode } = applyPatchToMemoryStates({
              conversationState: asRecord(convNext),
              characterState: asRecord(charNext),
              patchObj,
              includeMemoryEpisode: true,
            })

            let appliedConvNow = convApplied
            let appliedCharNow = charApplied
            let wroteAnyState = false

            if (!patchJobId || !convApplied) {
              if (patchJobId) {
                const ids = getConversationAppliedPatchJobIds(convNext)
                setConversationAppliedPatchJobIds(asRecord(convNext), [...ids, patchJobId])
              }
              await optimisticUpdateConversationState({
                sb,
                convId: convIdFinal,
                state: asRecord(convNext),
                expectedVersion: conversationStateVerNow,
              })
              wroteAnyState = true
              if (patchJobId) appliedConvNow = true
            }

            if (!patchJobId || !charApplied) {
              if (patchJobId) {
                const ids = getCharacterAppliedPatchJobIds(charNext)
                setCharacterAppliedPatchJobIds(asRecord(charNext), [...ids, patchJobId])
              }
              await optimisticUpdateCharacterState({
                sb,
                characterId,
                state: asRecord(charNext),
                expectedVersion: characterStateVerNow,
              })
              wroteAnyState = true
              if (patchJobId) appliedCharNow = true
            }

            if (memoryEpisode && wroteAnyState) {
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

            if (patchJobId && appliedConvNow && appliedCharNow) {
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
      guardTriggered,
      guardRewriteUsed,
      guardFallbackUsed,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}



