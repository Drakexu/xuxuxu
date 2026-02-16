export type JsonObject = Record<string, unknown>

const MAX_ARRAY_ITEMS = 160
const MAX_TEXT_LEN = 1_000
const MAX_SHORT_TEXT_LEN = 180
const PATCH_TEXT_LEN = 512

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function asNumber(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  return null
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function take<T>(arr: T[], limit: number): T[] {
  return arr.slice(0, Math.max(0, limit))
}

function uniqueStrings(rows: unknown[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of rows) {
    const s = asString(x)
    if (!s) continue
    const t = s.slice(0, MAX_SHORT_TEXT_LEN)
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

function sanitizeExperienceAxesDelta(raw: unknown): JsonObject {
  const src = asRecord(raw)
  const out: JsonObject = {}
  const keys = ['intimacy', 'risk', 'information', 'action', 'relationship', 'growth'] as const

  for (const k of keys) {
    const n = asNumber(src[k])
    if (n === null) continue
    out[k] = clamp(n, -0.2, 0.2)
  }

  return out
}

function sanitizeLedgerEventLogAdd(raw: unknown): unknown[] {
  const src = asArray(raw)
  return take(src, MAX_ARRAY_ITEMS).map((item) => {
    if (typeof item === 'string') return item.slice(0, MAX_TEXT_LEN)
    const r = asRecord(item)
    const content = asString(r['content'])
    const role = asString(r['role'])
    if (!content) return r
    return role ? { ...r, content } : { content }
  })
}

function sanitizeInventoryDelta(raw: unknown): Array<Record<string, unknown>> {
  const src = asArray(raw)
  const out: Array<Record<string, unknown>> = []
  for (const x of take(src, MAX_ARRAY_ITEMS)) {
    if (x == null) continue
    const r = asRecord(x)
    const key = asString(r['name']) || asString(r['item']) || asString(r['id'])
    if (!key) continue
    const delta = asNumber(r['delta']) ?? asNumber(r['count_delta']) ?? asNumber(r['n'])
    const entry: JsonObject = { ...r }
    entry['name'] = key
    if (delta !== null) entry['delta'] = clamp(delta, -99, 99)
    out.push(entry)
  }
  return out
}

function sanitizePatchAddArray(raw: unknown, maxItems = MAX_ARRAY_ITEMS): unknown[] {
  return take(asArray(raw).filter(Boolean), maxItems)
}

function sanitizeWardrobe(raw: unknown): JsonObject {
  const src = asRecord(raw)
  const out: JsonObject = {}
  const outfit = asString(src['current_outfit'])
  const confirmed = asBool(src['confirmed'])

  if (outfit) out.current_outfit = outfit.slice(0, MAX_SHORT_TEXT_LEN)
  if (confirmed !== null) out.confirmed = confirmed

  const itemsRaw = src['items']
  if (Array.isArray(itemsRaw)) {
    out.items = take(itemsRaw, 200)
  }

  return out
}

function sanitizeMemoryEpisode(raw: unknown): JsonObject {
  const src = asRecord(raw)
  const out: JsonObject = {}

  const summary = asString(src['summary'])
  if (!summary) return out

  const bucketStart = asString(src['bucket_start'])
  if (bucketStart) out.bucket_start = bucketStart
  out.summary = summary.slice(0, PATCH_TEXT_LEN)
  out.open_loops = take(uniqueStrings(asArray(src['open_loops']), 20), 20)
  out.tags = take(uniqueStrings(asArray(src['tags']), 20), 20)

  return out
}

const ALLOWED_NARRATION_MODES = new Set(['DIALOG', 'NARRATION', 'MULTI_CAST', 'CG', 'SCHEDULE'])
const ALLOWED_PRESENT_CHAR_LIMIT = 8

export function sanitizePatchOutput(raw: unknown): JsonObject | null {
  const rawObj = asRecord(raw)

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

  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(rawObj, key)) return null
  }

  const runPatch = asRecord(rawObj['run_state_patch'])
  const sanitizedRun: JsonObject = {}
  for (const [k, v] of Object.entries(runPatch)) {
    if (typeof v === 'undefined') continue
    sanitizedRun[k] = v
  }

  const narrationMode = asString(sanitizedRun['narration_mode'])
  if (!narrationMode || !ALLOWED_NARRATION_MODES.has(narrationMode)) delete sanitizedRun['narration_mode']

  const present = asArray(sanitizedRun['present_characters'])
  const presentCharacters = uniqueStrings(present, ALLOWED_PRESENT_CHAR_LIMIT)
  sanitizedRun['present_characters'] = presentCharacters

  const currentMainRole = asString(sanitizedRun['current_main_role'])
  if (currentMainRole) sanitizedRun['current_main_role'] = currentMainRole

  const relationshipStage = asString(sanitizedRun['relationship_stage'])
  if (relationshipStage) sanitizedRun['relationship_stage'] = relationshipStage.slice(0, 20)

  const turnSeq = asNumber(sanitizedRun['turn_seq'])
  if (turnSeq !== null) sanitizedRun['turn_seq'] = Math.floor(turnSeq)

  const runStateHint = asString(sanitizedRun['goal'])
  if (runStateHint) sanitizedRun['goal'] = runStateHint.slice(0, MAX_SHORT_TEXT_LEN)

  const plotPatch = asRecord(rawObj['plot_board_patch'])
  const sanitizedPlot: JsonObject = {}
  for (const [k, v] of Object.entries(plotPatch)) {
    if (typeof v === 'undefined') continue
    sanitizedPlot[k] = v
  }
  sanitizedPlot['experience_axes_delta'] = sanitizeExperienceAxesDelta(plotPatch['experience_axes_delta'])
  sanitizedPlot['open_threads_add'] = sanitizePatchAddArray(plotPatch['open_threads_add'], 24)
  sanitizedPlot['open_threads_close'] = uniqueStrings(asArray(plotPatch['open_threads_close']), 24)
  sanitizedPlot['pending_scenes_add'] = sanitizePatchAddArray(plotPatch['pending_scenes_add'], 24)
  sanitizedPlot['pending_scenes_close'] = uniqueStrings(asArray(plotPatch['pending_scenes_close']), 24)
  sanitizedPlot['beat_history_append'] = asRecord(plotPatch['beat_history_append'])

  const ledgerPatch = asRecord(rawObj['ledger_patch'])
  const sanitizedLedger: JsonObject = {}
  sanitizedLedger['event_log_add'] = sanitizeLedgerEventLogAdd(ledgerPatch['event_log_add'])
  sanitizedLedger['npc_db_add_or_update'] = sanitizePatchAddArray(ledgerPatch['npc_db_add_or_update'], 120)
  sanitizedLedger['inventory_delta'] = sanitizeInventoryDelta(ledgerPatch['inventory_delta'])
  sanitizedLedger['wardrobe_update'] = sanitizeWardrobe(ledgerPatch['wardrobe_update'])
  sanitizedLedger['relation_ledger_add'] = sanitizePatchAddArray(ledgerPatch['relation_ledger_add'], 120)

  const memoryPatch = asRecord(rawObj['memory_patch'])
  const memEpisode = sanitizeMemoryEpisode(memoryPatch['memory_b_episode'])
  const sanitizedMemory: JsonObject = {
    memory_b_episode: Object.keys(memEpisode).length ? memEpisode : {},
  }

  const sanitized = {
    focus_panel_next: asRecord(rawObj['focus_panel_next']),
    run_state_patch: sanitizedRun,
    plot_board_patch: sanitizedPlot,
    persona_system_patch: asRecord(rawObj['persona_system_patch']),
    ip_pack_patch: asRecord(rawObj['ip_pack_patch']),
    schedule_board_patch: asRecord(rawObj['schedule_board_patch']),
    ledger_patch: sanitizedLedger,
    memory_patch: Object.keys(sanitizedMemory).length ? sanitizedMemory : asRecord(memoryPatch),
    style_guard_patch: asRecord(rawObj['style_guard_patch']),
    fact_patch_add: sanitizePatchAddArray(rawObj['fact_patch_add'], 160).map((v) => {
      if (typeof v === 'string') return v.slice(0, MAX_TEXT_LEN)
      const r = asRecord(v)
      const item = asString(r['item'])
      return item || r
    }),
    moderation_flags: asRecord(rawObj['moderation_flags']),
  } as JsonObject

  return sanitized
}
