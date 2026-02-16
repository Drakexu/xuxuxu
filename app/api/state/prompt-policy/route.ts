import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>
type PlotGranularity = 'LINE' | 'BEAT' | 'SCENE'
type EndingMode = 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED'

type PromptPolicyReq = {
  conversationId: string
  plotGranularity?: PlotGranularity
  endingMode?: EndingMode
  endingRepeatWindow?: number
  nextEndingsPrefer?: string[]
  persistToCharacter?: boolean
}

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function requireAuthToken(req: Request) {
  const auth = (req.headers.get('authorization') || '').trim()
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : ''
  if (!token) throw new Error('Missing Authorization token')
  return token
}

function supabaseForToken(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anon) throw new Error('Missing Supabase env')
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function normalizePlotGranularity(v: unknown): PlotGranularity | '' {
  const s = String(v || '').trim().toUpperCase()
  return s === 'LINE' || s === 'BEAT' || s === 'SCENE' ? (s as PlotGranularity) : ''
}

function normalizeEndingMode(v: unknown): EndingMode | '' {
  const s = String(v || '').trim().toUpperCase()
  return s === 'QUESTION' || s === 'ACTION' || s === 'CLIFF' || s === 'MIXED' ? (s as EndingMode) : ''
}

function normalizeEndingRepeatWindow(v: unknown): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(3, Math.min(Math.floor(n), 12))
}

function normalizeEndingHints(v: unknown): string[] {
  const src = Array.isArray(v) ? v : []
  const out: string[] = []
  for (const x of src) {
    const s = String(x || '').trim()
    if (!s) continue
    out.push(s)
    if (out.length >= 6) break
  }
  return out
}

function defaultEndingHints(mode: EndingMode): string[] {
  if (mode === 'QUESTION') return ['Q', 'A', 'B']
  if (mode === 'ACTION') return ['A', 'B', 'S']
  if (mode === 'CLIFF') return ['S', 'A', 'B']
  return ['A', 'B', 'S']
}

async function optimisticUpdatePromptPolicy(args: {
  sb: ReturnType<typeof supabaseForToken>
  conversationId: string
  plotGranularity?: PlotGranularity
  endingMode?: EndingMode
  endingRepeatWindow?: number
  nextEndingsPrefer?: string[]
}) {
  const { sb, conversationId } = args

  for (let i = 0; i < 4; i++) {
    const st = await sb.from('conversation_states').select('state,version,character_id').eq('conversation_id', conversationId).maybeSingle()
    if (st.error) throw new Error(st.error.message)
    if (!st.data) throw new Error('Conversation state not found')

    const state = asRecord(st.data.state)
    const run = { ...asRecord(state.run_state) }
    const style = { ...asRecord(state.style_guard) }
    const ledger = { ...asRecord(state.ledger) }

    if (args.plotGranularity) run.plot_granularity = args.plotGranularity
    if (args.endingMode) run.ending_mode = args.endingMode
    if (typeof args.endingRepeatWindow === 'number') style.ending_repeat_window = args.endingRepeatWindow

    const existingHints = normalizeEndingHints(style.next_endings_prefer)
    if (Array.isArray(args.nextEndingsPrefer) && args.nextEndingsPrefer.length) {
      style.next_endings_prefer = args.nextEndingsPrefer
    } else if (args.endingMode) {
      style.next_endings_prefer = defaultEndingHints(args.endingMode)
    } else if (!existingHints.length) {
      style.next_endings_prefer = ['A', 'B', 'S']
    }

    const eventLog = Array.isArray(ledger.event_log) ? [...ledger.event_log] : []
    eventLog.push(
      `[PROMPT_POLICY] granularity=${String(run.plot_granularity || 'BEAT')} ending=${String(run.ending_mode || 'MIXED')} window=${String(style.ending_repeat_window || 6)}`,
    )
    ledger.event_log = eventLog.slice(-260)

    state.run_state = run
    state.style_guard = style
    state.ledger = ledger

    const expectedVersion = Number(st.data.version ?? 0)
    const nextVersion = expectedVersion + 1

    const upd = await sb
      .from('conversation_states')
      .update({ state, version: nextVersion, updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('version', expectedVersion)
      .select('version')

    if (upd.error) throw new Error(upd.error.message)
    if (upd.data && (!Array.isArray(upd.data) || upd.data.length > 0)) {
      const nextHints = normalizeEndingHints(style.next_endings_prefer)
      return {
        version: nextVersion,
        characterId: String(st.data.character_id || ''),
        plotGranularity: String(run.plot_granularity || 'BEAT'),
        endingMode: String(run.ending_mode || 'MIXED'),
        endingRepeatWindow: Number(style.ending_repeat_window ?? 6),
        nextEndingsPrefer: nextHints.length ? nextHints : ['A', 'B', 'S'],
      }
    }
  }

  throw new Error('Conversation state version conflict')
}

async function persistPromptPolicyToCharacter(args: {
  sb: ReturnType<typeof supabaseForToken>
  characterId: string
  plotGranularity: string
  endingMode: string
  endingRepeatWindow: number
  nextEndingsPrefer: string[]
}) {
  const { sb, characterId, plotGranularity, endingMode, endingRepeatWindow, nextEndingsPrefer } = args
  if (!characterId) return

  const r = await sb.from('characters').select('settings').eq('id', characterId).maybeSingle()
  if (r.error || !r.data) return

  const settings = asRecord(r.data.settings)
  const promptPolicy = {
    ...asRecord(settings.prompt_policy),
    plot_granularity: plotGranularity,
    ending_mode: endingMode,
    ending_repeat_window: endingRepeatWindow,
    next_endings_prefer: nextEndingsPrefer,
  }

  const nextSettings = {
    ...settings,
    plot_granularity: plotGranularity,
    ending_mode: endingMode,
    ending_repeat_window: endingRepeatWindow,
    next_endings_prefer: nextEndingsPrefer,
    prompt_policy: promptPolicy,
  }

  await sb.from('characters').update({ settings: nextSettings }).eq('id', characterId)
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    if (u.error || !u.data?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as PromptPolicyReq
    const conversationId = String(body?.conversationId || '').trim()
    const plotGranularity = normalizePlotGranularity(body?.plotGranularity)
    const endingMode = normalizeEndingMode(body?.endingMode)
    const endingRepeatWindow = normalizeEndingRepeatWindow(body?.endingRepeatWindow)
    const nextEndingsPrefer = normalizeEndingHints(body?.nextEndingsPrefer)
    const persistToCharacter = body?.persistToCharacter === true

    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    if (!plotGranularity && !endingMode && endingRepeatWindow === null && !nextEndingsPrefer.length) {
      return NextResponse.json({ error: 'No prompt policy payload' }, { status: 400 })
    }

    const out = await optimisticUpdatePromptPolicy({
      sb,
      conversationId,
      plotGranularity: plotGranularity || undefined,
      endingMode: endingMode || undefined,
      endingRepeatWindow: endingRepeatWindow === null ? undefined : endingRepeatWindow,
      nextEndingsPrefer: nextEndingsPrefer.length ? nextEndingsPrefer : undefined,
    })

    if (persistToCharacter) {
      await persistPromptPolicyToCharacter({
        sb,
        characterId: out.characterId,
        plotGranularity: out.plotGranularity,
        endingMode: out.endingMode,
        endingRepeatWindow: out.endingRepeatWindow,
        nextEndingsPrefer: out.nextEndingsPrefer,
      })
    }

    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}