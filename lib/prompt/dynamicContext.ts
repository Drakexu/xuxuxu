type JsonObject = Record<string, unknown>

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function jsonClip(v: unknown, maxChars: number) {
  try {
    const s = JSON.stringify(v ?? null, null, 2)
    return s.length > maxChars ? `${s.slice(0, maxChars)}\n...` : s
  } catch {
    return '(unserializable)'
  }
}

function textOrJson(v: unknown, maxChars: number) {
  if (typeof v === 'string') return v.trim() || '(empty)'
  if (v == null) return '(empty)'
  if (Array.isArray(v)) return v.length ? jsonClip(v, maxChars) : '(empty)'
  if (typeof v === 'object') {
    const r = asRecord(v)
    return Object.keys(r).length ? jsonClip(v, maxChars) : '(empty)'
  }
  return String(v || '').trim() || '(empty)'
}

export type DynamicContextBuildArgs = {
  inputEvent?: string
  userCard?: string
  userMessageForModel?: string
  nowLocalIso: string
  characterName: string
  systemPrompt: string
  characterProfile?: unknown
  characterSettings?: unknown
  runState?: unknown
  focusPanel?: unknown
  ipPack?: unknown
  personaSystem?: unknown
  relationshipLadder?: unknown
  plotBoard?: unknown
  scheduleBoard?: unknown
  ledger?: unknown
  factPatch?: unknown
  memoryState?: unknown
  styleGuard?: unknown
  memoryA: Array<{ role: string; content: string }>
  memoryB: Array<unknown>
}

function buildMemoryAText(memoryA: Array<{ role: string; content: string }>, characterName: string) {
  return (memoryA || [])
    .map((m) => {
      const who = m.role === 'assistant' ? characterName : '{user}'
      return `${who}: ${m.content}`
    })
    .join('\n')
}

function buildMemoryBText(memoryB: Array<unknown>) {
  return (memoryB || [])
    .map((e: unknown) => {
      const r = asRecord(e)
      const bucket = r['bucket_start'] ?? r['time_range'] ?? ''
      const summary = r['summary'] ?? ''
      return `- (${String(bucket)}) ${String(summary)}`.trim()
    })
    .filter(Boolean)
    .join('\n')
}

function buildFactPatchText(factPatchInput: unknown) {
  const src = asArray(factPatchInput)
  if (!src.length) return '(empty)'
  return src
    .slice(-8)
    .map((x) => {
      if (typeof x === 'string') return `- ${x}`
      const r = asRecord(x)
      const s = String(r['content'] ?? r['fact'] ?? r['title'] ?? '').trim()
      const confirmed = r['confirmed'] === true ? 'confirmed' : 'unconfirmed'
      return s ? `- [${confirmed}] ${s}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function buildLedgerDigest(ledgerInput: unknown) {
  const ledger = asRecord(ledgerInput)
  return [
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
        .join(' | ')
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
        .join(' | ')
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
}

export function buildDynamicContextText(args: DynamicContextBuildArgs) {
  const run = asRecord(args.runState)
  const memory = asRecord(args.memoryState)
  const ladder = args.relationshipLadder ?? null
  const memoryAText = buildMemoryAText(args.memoryA, args.characterName)
  const memoryBText = buildMemoryBText(args.memoryB)
  const ledgerDigest = buildLedgerDigest(args.ledger)
  const factPatchText = buildFactPatchText(args.factPatch)

  const s: string[] = []
  s.push('[DYNAMIC_CONTEXT / assembled by runtime]')
  s.push('')
  s.push('[MODEL_CONFIG]')
  s.push('model_target: m2-her')
  s.push('context_limit: 64k')
  s.push('runtime_profile: prompt_only_no_json')
  s.push('')

  s.push('[INPUT_EVENT]')
  s.push(`event: ${args.inputEvent || 'TALK_HOLD'}`)
  s.push('')

  if (args.userCard && args.userCard.trim()) {
    s.push('[USER_ID_CARD]')
    s.push(args.userCard.trim().slice(0, 520))
    s.push('')
  }

  s.push('[RUN_STATE]')
  s.push(`time_local: ${String(run.time_local || args.nowLocalIso)}`)
  s.push(`region: ${String(run.region || 'GLOBAL')}`)
  s.push(`age_mode: ${String(run.age_mode || 'adult')}`)
  s.push(`mode: ${String(run.narration_mode || run.output_mode || 'DIALOG')}`)
  s.push(`scene: ${String(run.scene || '')}`)
  s.push(`current_main_role: ${String(run.current_main_role || args.characterName || '{role}')}`)
  s.push(`present_characters: ${JSON.stringify(run.present_characters || [])}`)
  s.push(`multi_cast_order: ${JSON.stringify(run.multi_cast_order || [])}`)
  s.push(`multi_cast_next_speaker: ${String(run.multi_cast_next_speaker || '')}`)
  s.push(`relationship_stage: ${String(run.relationship_stage || '')}`)
  s.push(`romance_mode: ${String(run.romance_mode || '')}`)
  s.push(`user_drive: ${String(run.user_drive || '')}`)
  s.push(`reconcile_hint: ${String(run.reconcile_hint || '')}`)
  s.push(`goal: ${String(run.goal || '')}`)
  s.push(`turn_seq: ${String(run.turn_seq || '')}`)
  s.push('')

  s.push('[FOCUS_PANEL]')
  s.push(jsonClip(args.focusPanel || {}, 1200))
  s.push('')

  s.push('[IP_PACK]')
  s.push('CHARACTER_CANON:')
  s.push(args.systemPrompt || '')
  s.push('')
  s.push('IP_PACK_STATE:')
  s.push(jsonClip(args.ipPack || {}, 1600))
  s.push('')

  s.push('[PERSONA_SYSTEM]')
  s.push(jsonClip(args.personaSystem || {}, 1200))
  s.push('')

  if (ladder) {
    s.push('[RELATIONSHIP_STAGE]')
    s.push(typeof ladder === 'string' ? ladder : jsonClip(ladder, 900))
    s.push('')
  }

  s.push('[PLOT_BOARD]')
  s.push(jsonClip(args.plotBoard || {}, 1300))
  s.push('')
  s.push('[SCHEDULE_BOARD]')
  s.push(jsonClip(args.scheduleBoard || {}, 900))
  s.push('')

  s.push('[FACT_LEDGER]')
  s.push('LEDGER_DIGEST:')
  s.push(ledgerDigest || '(empty)')
  s.push('')
  s.push('FACT_PATCH_RECENT:')
  s.push(factPatchText)
  s.push('')
  s.push('FULL_LEDGER_JSON:')
  s.push(jsonClip(args.ledger || {}, 1800))
  s.push('')

  s.push('[MEMORY_PACK]')
  s.push('MEMORY_A:')
  s.push(memoryAText || '(empty)')
  s.push('')
  s.push('MEMORY_B:')
  s.push(memoryBText || '(empty)')
  s.push('')
  s.push('MEMORY_C0:')
  s.push(String(memory?.c0_summary || '').trim() || '(empty)')
  s.push('')
  s.push('MEMORY_C1:')
  s.push(jsonClip(memory?.c1_highlights || [], 400))
  s.push('')
  s.push('MEMORY_C2:')
  s.push(textOrJson(memory?.c2_user_profile || memory?.user_profile || '', 500))
  s.push('')
  s.push('MEMORY_C3:')
  s.push(textOrJson(memory?.c3_role_profile || memory?.role_profile || '', 500))
  s.push('')
  s.push('MEMORY_D:')
  s.push(textOrJson(memory?.d_biweekly || memory?.biweekly || '', 600))
  s.push('')
  s.push('MEMORY_E:')
  s.push(jsonClip(memory?.highlights || [], 600))
  s.push('')

  s.push('[STYLE_GUARD]')
  s.push(jsonClip(args.styleGuard || {}, 900))
  s.push('')

  s.push('[CHARACTER_PROFILE]')
  s.push(jsonClip(args.characterProfile || {}, 500))
  s.push('')

  s.push('[CHARACTER_SETTINGS]')
  s.push(jsonClip(args.characterSettings || {}, 700))
  s.push('')

  s.push('[USER_INPUT]')
  s.push(args.userMessageForModel || '')

  return s.join('\n')
}
