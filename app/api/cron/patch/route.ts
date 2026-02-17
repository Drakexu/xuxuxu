import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sanitizePatchOutput } from '@/lib/patchValidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>
type PatchMemoryEpisode = {
  bucket_start: string
  summary: string
  open_loops: unknown
  tags: unknown
}

type PatchJobRow = {
  id: string
  user_id: string
  conversation_id: string
  character_id: string
  turn_seq: number
  patch_input: unknown
  status: 'pending' | 'processing' | 'done' | 'failed' | string
  attempts: number
  created_at?: string | null
}

type MiniMaxResponse = {
  choices?: Array<{ message?: { content?: string } }>
  reply?: string
  output_text?: string
  base_resp?: { status_code?: number; status_msg?: string }
}

const PATCH_APPLY_MAX_ATTEMPTS = 5
const PATCH_APPLY_RETRY_BASE_MS = 80

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

function safeExtractJsonObject(text: string) {
  const s = String(text || '').trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function formatErr(err: unknown) {
  return err instanceof Error ? err.message : String(err || '')
}

function isVersionConflict(err: unknown) {
  const msg = formatErr(err).toLowerCase()
  return msg.includes('version conflict') || msg.includes('no rows') || msg.includes('did not find any rows matching')
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
async function optimisticUpdateConversationState(args: {
  sb: ReturnType<typeof createAdminClient>
  convId: string
  state: unknown
  expectedVersion: number
}) {
  const { sb, convId, state, expectedVersion } = args
  const nextVersion = expectedVersion + 1
  const upd = await sb
    .from('conversation_states')
    .update({ state, version: nextVersion, updated_at: new Date().toISOString() })
    .eq('conversation_id', convId)
    .eq('version', expectedVersion)
    .select('version')

  if (upd.error) throw new Error(upd.error.message)
  if (!upd.data || (Array.isArray(upd.data) && upd.data.length === 0)) throw new Error('Conversation state version conflict')
  return nextVersion
}

async function optimisticUpdateCharacterState(args: {
  sb: ReturnType<typeof createAdminClient>
  characterId: string
  state: unknown
  expectedVersion: number
}) {
  const { sb, characterId, state, expectedVersion } = args
  const nextVersion = expectedVersion + 1
  const upd = await sb
    .from('character_states')
    .update({ state, version: nextVersion, updated_at: new Date().toISOString() })
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
  sb: ReturnType<typeof createAdminClient>
  jobId: string
  fromStatuses: string[]
}) {
  const { sb, jobId, fromStatuses } = args
  const upd = await sb
    .from('patch_jobs')
    .update({ status: 'processing', last_error: '' })
    .eq('id', jobId)
    .in('status', fromStatuses)
    .select('id')
  if (upd.error) throw new Error(upd.error.message)
  return hasUpdatedRows(upd.data)
}

async function incrementPatchJobAttempts(args: {
  sb: ReturnType<typeof createAdminClient>
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
  await sb.from('patch_jobs').update({ status, attempts, last_error: lastError ?? '' }).eq('id', jobId)
  return attempts
}

export async function POST(req: Request) {
  try {
    requireCronSecret(req)

    const mmKey = process.env.MINIMAX_API_KEY
    const mmBase = process.env.MINIMAX_BASE_URL
    if (!mmKey || !mmBase) return NextResponse.json({ error: 'Missing MINIMAX env (MINIMAX_API_KEY / MINIMAX_BASE_URL)' }, { status: 500 })

    const patchModel = (process.env.MINIMAX_PATCH_MODEL || 'MiniMax-M2.5').trim()

    const sb = createAdminClient()
    const max = clamp(Number(process.env.PATCH_CRON_BATCH ?? 10), 1, 50)

    const pendingFailed = await sb
      .from('patch_jobs')
      .select('id,user_id,conversation_id,character_id,turn_seq,patch_input,status,attempts,created_at')
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(max)

    if (pendingFailed.error) return NextResponse.json({ error: pendingFailed.error.message }, { status: 500 })

    const staleMinutes = clamp(Number(process.env.PATCH_PROCESSING_STALE_MIN ?? 10), 1, 240)
    const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString()
    const pendingRows = (pendingFailed.data ?? []) as PatchJobRow[]

    let staleRows: PatchJobRow[] = []
    if (pendingRows.length < max) {
      const stale = await sb
        .from('patch_jobs')
        .select('id,user_id,conversation_id,character_id,turn_seq,patch_input,status,attempts,created_at')
        .eq('status', 'processing')
        .lte('created_at', staleBefore)
        .order('created_at', { ascending: true })
        .limit(max - pendingRows.length)
      if (stale.error) return NextResponse.json({ error: stale.error.message }, { status: 500 })
      staleRows = (stale.data ?? []) as PatchJobRow[]
    }

    let processed = 0
    let ok = 0
    let failed = 0

    const rows = [...pendingRows, ...staleRows]

    for (const row of rows) {
      const jobId = String(row.id || '')
      if (!jobId) continue
      const fromStatuses = row.status === 'processing' ? ['processing'] : ['pending', 'failed']
      let claimed = false
      try {
        claimed = await claimPatchJobForProcessing({ sb, jobId, fromStatuses })
      } catch {
        failed++
        continue
      }
      if (!claimed) continue
      processed++
      try {
        const pi = asRecord(row.patch_input)
        if (!Object.keys(pi).length) throw new Error('Missing patch_input')

        const conversationId = String(row.conversation_id || '')
        const characterId = String(row.character_id || '')
        const pJson = (await callMiniMax(mmBase, mmKey, {
          model: patchModel,
          messages: [
            { role: 'system', name: 'System', content: patchSystemPrompt() },
            { role: 'user', name: 'User', content: `PATCH_INPUT:\n${JSON.stringify(pi)}` },
          ],
          temperature: 0.2,
          top_p: 0.7,
          max_completion_tokens: 2048,
        })) as MiniMaxResponse

        const patchText = pJson?.choices?.[0]?.message?.content ?? pJson?.reply ?? pJson?.output_text ?? ''
        const patchObjRaw = safeExtractJsonObject(patchText)
        if (!patchObjRaw || typeof patchObjRaw !== 'object') throw new Error('PatchScribe output is not valid JSON object')
        const applyPatchOnce = async () => {
            const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', conversationId).maybeSingle()
            if (st.error || !st.data?.state) throw new Error(`Load conversation_states failed: ${st.error?.message || 'no state'}`)
            const conversationStateVerNow = Number(st.data.version ?? 0)
            const conversationState = structuredClone(st.data.state as JsonObject)

            const ch = await sb.from('character_states').select('state,version').eq('character_id', characterId).maybeSingle()
            if (ch.error || !ch.data?.state) throw new Error(`Load character_states failed: ${ch.error?.message || 'no state'}`)
            const characterStateVerNow = Number(ch.data.version ?? 0)
            const characterState = structuredClone(ch.data.state as JsonObject)

            const convApplied = listIncludes(getConversationAppliedPatchJobIds(conversationState), jobId)
            const charApplied = listIncludes(getCharacterAppliedPatchJobIds(characterState), jobId)
            if (convApplied && charApplied) {
              await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', jobId)
              ok++
              return
            }

            const turn = asRecord(pi['turn'])
            const patchEvidenceText = `${String(turn['user_input'] || '')}\n${String(turn['assistant_text'] || '')}`
            const patch = sanitizePatchOutput(patchObjRaw, {
              evidenceText: patchEvidenceText,
              conversationState,
              recentMessages: asArray(pi['recent_messages']),
            })
            if (!patch) throw new Error('Patch schema invalid')

            const convNext = structuredClone(conversationState)
            const charNext = structuredClone(characterState)

            const { memoryEpisode } = applyPatchToMemoryStates({
              conversationState: convNext,
              characterState: charNext,
              patchObj: patch,
              includeMemoryEpisode: true,
            })

            let appliedConvNow = convApplied
            let appliedCharNow = charApplied
            let wroteAnyState = false

            if (!convApplied) {
              const ids = getConversationAppliedPatchJobIds(convNext)
              setConversationAppliedPatchJobIds(convNext, [...ids, jobId])
              await optimisticUpdateConversationState({
                sb,
                convId: conversationId,
                state: convNext,
                expectedVersion: conversationStateVerNow,
              })
              wroteAnyState = true
              appliedConvNow = true
            }

            if (!charApplied) {
              const ids = getCharacterAppliedPatchJobIds(charNext)
              setCharacterAppliedPatchJobIds(charNext, [...ids, jobId])
              await optimisticUpdateCharacterState({
                sb,
                characterId,
                state: charNext,
                expectedVersion: characterStateVerNow,
              })
              wroteAnyState = true
              appliedCharNow = true
            }

            if (memoryEpisode && wroteAnyState) {
              await sb.from('memory_b_episodes').upsert(
                {
                  conversation_id: conversationId,
                  user_id: row.user_id,
                  bucket_start: memoryEpisode.bucket_start,
                  summary: String(memoryEpisode.summary || '').slice(0, 500),
                  open_loops: memoryEpisode.open_loops || [],
                  tags: memoryEpisode.tags || [],
                },
                { onConflict: 'conversation_id,bucket_start' },
              )
            }

            if (appliedConvNow && appliedCharNow) {
              await sb.from('patch_jobs').update({ status: 'done', last_error: '', patched_at: new Date().toISOString() }).eq('id', jobId)
              ok++
            }
        }

        for (let attempt = 1; attempt <= PATCH_APPLY_MAX_ATTEMPTS; attempt++) {
          try {
            await applyPatchOnce()
            break
          } catch (err: unknown) {
            const msg = formatErr(err)
            if (isVersionConflict(err) && attempt < PATCH_APPLY_MAX_ATTEMPTS) {
              await incrementPatchJobAttempts({ sb, jobId, status: 'processing', lastError: msg })
              await sleep(PATCH_APPLY_RETRY_BASE_MS * attempt)
              continue
            }
            await incrementPatchJobAttempts({
              sb,
              jobId,
              status: attempt >= PATCH_APPLY_MAX_ATTEMPTS ? 'failed' : 'pending',
              lastError: msg,
            })
            failed++
            break
          }
        }
      } catch (e: unknown) {
        const msg = formatErr(e)
        await incrementPatchJobAttempts({ sb, jobId, status: 'pending', lastError: msg })
        failed++
      }
    }
    return NextResponse.json({ ok: true, processed, ok_count: ok, failed_count: failed })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Vercel Cron invokes scheduled routes with GET requests. Keep POST for manual triggers,
// but support GET so vercel.json crons work without extra tooling.
export async function GET(req: Request) {
  return POST(req)
}

