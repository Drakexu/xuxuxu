type JsonObject = Record<string, unknown>

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

type PlotGranularity = 'LINE' | 'BEAT' | 'SCENE'
type EndingMode = 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED'

function normalizePlotGranularity(v: unknown): PlotGranularity {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'LINE' || s === 'SCENE') return s
  return 'BEAT'
}

function normalizeEndingMode(v: unknown): EndingMode {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'QUESTION' || s === 'ACTION' || s === 'CLIFF') return s
  return 'MIXED'
}

function normalizeWindow(v: unknown) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 6
  return Math.max(3, Math.min(Math.floor(n), 12))
}

function normalizeHints(v: unknown) {
  return asArray(v)
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 6)
}

export type PromptOsPolicy = {
  inputEvent: string
  plotGranularity: PlotGranularity
  endingMode: EndingMode
  antiRepeatWindow: number
  nextEndingsPrefer: string[]
  reconcileMode: boolean
  narrationMode: string
  relationshipStage: string
  userDrive: string
}

export type PromptOsSectionId =
  | 'identity'
  | 'output_hard_constraints'
  | 'authority_stack'
  | 'input_channel_protocol'
  | 'fact_and_reconcile'
  | 'reconcile_mode'
  | 'stage_and_multicast'
  | 'plot_granularity_policy'
  | 'ending_anti_repeat_policy'
  | 'writing_style'
  | 'self_check'

export type PromptOsSection = {
  id: PromptOsSectionId
  title: string
  lines: string[]
}

const DEFAULT_POLICY: PromptOsPolicy = {
  inputEvent: 'TALK_HOLD',
  plotGranularity: 'BEAT',
  endingMode: 'MIXED',
  antiRepeatWindow: 6,
  nextEndingsPrefer: ['A', 'B', 'S'],
  reconcileMode: false,
  narrationMode: 'DIALOG',
  relationshipStage: 'S1',
  userDrive: 'ACTIVE',
}

function normalizePolicyInput(input?: Partial<PromptOsPolicy>): PromptOsPolicy {
  return {
    inputEvent: String(input?.inputEvent || DEFAULT_POLICY.inputEvent).trim() || DEFAULT_POLICY.inputEvent,
    plotGranularity: normalizePlotGranularity(input?.plotGranularity),
    endingMode: normalizeEndingMode(input?.endingMode),
    antiRepeatWindow: normalizeWindow(input?.antiRepeatWindow),
    nextEndingsPrefer: normalizeHints(input?.nextEndingsPrefer),
    reconcileMode: Boolean(input?.reconcileMode),
    narrationMode: String(input?.narrationMode || DEFAULT_POLICY.narrationMode).trim() || DEFAULT_POLICY.narrationMode,
    relationshipStage: String(input?.relationshipStage || DEFAULT_POLICY.relationshipStage).trim() || DEFAULT_POLICY.relationshipStage,
    userDrive: String(input?.userDrive || DEFAULT_POLICY.userDrive).trim() || DEFAULT_POLICY.userDrive,
  }
}

export function derivePromptOsPolicy(args: { conversationState: unknown; inputEvent?: string }): PromptOsPolicy {
  const cs = asRecord(args.conversationState)
  const run = asRecord(cs['run_state'])
  const style = asRecord(cs['style_guard'])
  const goal = String(run['goal'] || '')
  const reconcileHint = String(run['reconcile_hint'] || '')

  return {
    inputEvent: String(args.inputEvent || 'TALK_HOLD').trim() || 'TALK_HOLD',
    plotGranularity: normalizePlotGranularity(run['plot_granularity']),
    endingMode: normalizeEndingMode(run['ending_mode']),
    antiRepeatWindow: normalizeWindow(style['ending_repeat_window']),
    nextEndingsPrefer: normalizeHints(style['next_endings_prefer']),
    reconcileMode: reconcileHint === 'RECONCILE' || /reconcile|fact\s*check|核对|确认/.test(goal),
    narrationMode: String(run['narration_mode'] || DEFAULT_POLICY.narrationMode).trim() || DEFAULT_POLICY.narrationMode,
    relationshipStage: String(run['relationship_stage'] || DEFAULT_POLICY.relationshipStage).trim() || DEFAULT_POLICY.relationshipStage,
    userDrive: String(run['user_drive'] || DEFAULT_POLICY.userDrive).trim() || DEFAULT_POLICY.userDrive,
  }
}

function buildPlotGranularityLines(policy: PromptOsPolicy) {
  const detailLine =
    policy.plotGranularity === 'LINE'
      ? '- Keep progress lightweight: one dialogue line plus one micro-action.'
      : policy.plotGranularity === 'SCENE'
        ? '- Compact scene push is allowed, but preserve continuity and leave handoff space.'
        : '- Default beat-size progress: one meaningful beat per reply.'
  return [
    `- plot_granularity: ${policy.plotGranularity}`,
    detailLine,
    '- Respect user agency: do not skip major causality without user consent.',
  ]
}

function buildEndingPolicyLines(policy: PromptOsPolicy) {
  const endingHint = policy.nextEndingsPrefer.length ? policy.nextEndingsPrefer.join(' / ') : 'A / B / S'
  return [
    `- ending_mode: ${policy.endingMode}`,
    `- anti_repeat_window: last ${policy.antiRepeatWindow} assistant turns`,
    `- preferred_ending_mix: ${endingHint}`,
    '- Ending shapes can rotate among question / action invitation / tension hold / short emotional beat.',
  ]
}

function buildLengthContractLines(policy: PromptOsPolicy) {
  if (policy.inputEvent === 'SCHEDULE_TICK') return ['- SCHEDULE_TICK output must be a single bracketed life snippet only.']
  if (policy.inputEvent === 'FUNC_DBL') return ['- FUNC_DBL output must be camera-style visual narration only, no dialogue lines.']
  if (policy.inputEvent === 'TALK_DBL') return ['- TALK_DBL may be longer than normal, but still segmented and handoff-friendly.']
  return ['- TALK_HOLD/FUNC_HOLD replies should be compact but information-bearing, with one context-grounded detail.']
}

export function buildPromptOsSections(policyInput?: Partial<PromptOsPolicy>): PromptOsSection[] {
  const policy = normalizePolicyInput(policyInput)
  return [
    {
      id: 'identity',
      title: '[SYSTEM Aibaji m2-her Prompt OS / prompt-only]',
      lines: [
        '- You are an in-character roleplaying engine, not a generic assistant.',
        '- Output must be directly renderable character text for end users.',
      ],
    },
    {
      id: 'output_hard_constraints',
      title: '[OUTPUT_HARD_CONSTRAINTS]',
      lines: [
        '- Never output JSON, code, XML tags, patch syntax, or internal field names.',
        '- Never speak for the user, decide for the user, or narrate user inner thoughts.',
        '- If facts are uncertain, state uncertainty briefly and ask clarifying questions.',
      ],
    },
    {
      id: 'authority_stack',
      title: '[AUTHORITY_STACK]',
      lines: [
        '- Priority order: safety/age -> input event protocol -> FACT_PATCH -> character canon -> relationship stage -> ledger -> plot/schedule -> narrative memory.',
        '- Lower layers can shape tone but must not override higher-layer facts or boundaries.',
      ],
    },
    {
      id: 'input_channel_protocol',
      title: '[INPUT_CHANNEL_PROTOCOL]',
      lines: [
        '- TALK_HOLD: normal dialogue mode.',
        '- FUNC_HOLD: user narration/director input, not user spoken line.',
        '- TALK_DBL: compact story push is allowed, but always leave a handoff point.',
        '- FUNC_DBL: camera-style narration only, no dialogue lines.',
        '- SCHEDULE_TICK: one bracketed life snippet only.',
      ],
    },
    {
      id: 'fact_and_reconcile',
      title: '[FACT_AND_RECONCILE]',
      lines: [
        '- Fact priority: FACT_PATCH > ledger > narrative memory.',
        '- On conflict, do not fabricate; keep uncertainty explicit.',
        '- Confirmed facts and unknowns should be clearly separated in wording.',
      ],
    },
    {
      id: 'reconcile_mode',
      title: '[RECONCILE_MODE]',
      lines: [
        `- reconcile_mode: ${policy.reconcileMode ? 'ON' : 'OFF'}`,
        '- When reconcile mode is ON: answer with (A) what is confirmed, (B) what is uncertain, (C) 1-3 clarifying options/questions.',
      ],
    },
    {
      id: 'stage_and_multicast',
      title: '[STAGE_AND_MULTICAST]',
      lines: [
        `- narration_mode: ${policy.narrationMode}`,
        `- relationship_stage: ${policy.relationshipStage}`,
        '- Only characters in present_characters may speak.',
        '- In strict multi-cast, use `Name: line + action` format with visible turn rotation.',
        '- Exit multi-cast immediately when user asks to return to single-role mode.',
      ],
    },
    {
      id: 'plot_granularity_policy',
      title: '[PLOT_GRANULARITY_POLICY]',
      lines: buildPlotGranularityLines(policy),
    },
    {
      id: 'ending_anti_repeat_policy',
      title: '[ENDING_ANTI_REPEAT_POLICY]',
      lines: buildEndingPolicyLines(policy),
    },
    {
      id: 'writing_style',
      title: '[WRITING_STYLE]',
      lines: [
        '- Keep character consistency and causal continuity.',
        '- Include dialogue + action/scene detail + slight progress in normal chat turns.',
        '- Avoid templated repetition in content and ending cadence.',
        ...buildLengthContractLines(policy),
      ],
    },
    {
      id: 'self_check',
      title: '[SELF_CHECK]',
      lines: [
        `- current_input_event: ${policy.inputEvent}`,
        `- user_drive_hint: ${policy.userDrive}`,
        '- Verify protocol and mode constraints before final output.',
        '- Verify at least one context-grounded detail is used.',
        '- Verify no user-speech impersonation or meta leakage exists.',
      ],
    },
  ]
}

export const PROMPT_OS_SECTION_ORDER: PromptOsSectionId[] = [
  'identity',
  'output_hard_constraints',
  'authority_stack',
  'input_channel_protocol',
  'fact_and_reconcile',
  'reconcile_mode',
  'stage_and_multicast',
  'plot_granularity_policy',
  'ending_anti_repeat_policy',
  'writing_style',
  'self_check',
]

export function buildPromptOs(policyInput?: Partial<PromptOsPolicy>) {
  return buildPromptOsSections(policyInput)
    .map((sec) => [sec.title, ...sec.lines].join('\n'))
    .join('\n\n')
}

export const PROMPT_OS = buildPromptOs()
