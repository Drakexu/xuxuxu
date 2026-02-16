import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>
type RelationshipStage = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7'
type RomanceMode = 'ROMANCE_ON' | 'ROMANCE_OFF'

type RelationshipReq = {
  conversationId: string
  relationshipStage?: RelationshipStage
  romanceMode?: RomanceMode
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

function normalizeStage(v: unknown): RelationshipStage | '' {
  const s = String(v || '').trim().toUpperCase()
  return ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].includes(s) ? (s as RelationshipStage) : ''
}

function normalizeRomance(v: unknown): RomanceMode | '' {
  const s = String(v || '').trim().toUpperCase()
  return s === 'ROMANCE_ON' || s === 'ROMANCE_OFF' ? (s as RomanceMode) : ''
}

async function optimisticUpdateRelationship(args: {
  sb: ReturnType<typeof supabaseForToken>
  conversationId: string
  relationshipStage?: RelationshipStage
  romanceMode?: RomanceMode
}) {
  const { sb, conversationId, relationshipStage, romanceMode } = args

  for (let i = 0; i < 4; i++) {
    const st = await sb.from('conversation_states').select('state,version,character_id').eq('conversation_id', conversationId).maybeSingle()
    if (st.error) throw new Error(st.error.message)
    if (!st.data) throw new Error('Conversation state not found')

    const state = asRecord(st.data.state)
    const run = { ...asRecord(state.run_state) }
    const focus = { ...asRecord(state.focus_panel) }
    const ledger = { ...asRecord(state.ledger) }

    if (relationshipStage) {
      run.relationship_stage = relationshipStage
      focus.relationship_stage_hint = relationshipStage
    }
    if (romanceMode) {
      run.romance_mode = romanceMode
    }

    const rel = Array.isArray(ledger.relation_ledger) ? [...ledger.relation_ledger] : []
    if (relationshipStage) rel.push({ type: 'stage_set', content: relationshipStage, confirmed: true })
    if (romanceMode) rel.push({ type: 'romance_mode_set', content: romanceMode, confirmed: true })
    ledger.relation_ledger = rel.slice(-180)

    state.run_state = run
    state.focus_panel = focus
    state.ledger = ledger

    const expectedVersion = Number(st.data.version ?? 0)
    const nextVersion = expectedVersion + 1
    const upd = await sb
      .from('conversation_states')
      .update({ state, version: nextVersion, updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('version', expectedVersion)
      .select('version,character_id')

    if (upd.error) throw new Error(upd.error.message)
    if (upd.data && (!Array.isArray(upd.data) || upd.data.length > 0)) {
      const chId = String(st.data.character_id || '')
      return {
        version: nextVersion,
        characterId: chId,
        relationshipStage: String(run.relationship_stage || ''),
        romanceMode: String(run.romance_mode || ''),
      }
    }
  }

  throw new Error('Conversation state version conflict')
}

async function persistRomanceModeToCharacter(args: {
  sb: ReturnType<typeof supabaseForToken>
  characterId: string
  romanceMode: RomanceMode
}) {
  const { sb, characterId, romanceMode } = args
  if (!characterId) return
  const r = await sb.from('characters').select('settings').eq('id', characterId).maybeSingle()
  if (r.error || !r.data) return
  const settings = { ...asRecord(r.data.settings), romance_mode: romanceMode }
  await sb.from('characters').update({ settings }).eq('id', characterId)
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    if (u.error || !u.data?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as RelationshipReq
    const conversationId = String(body?.conversationId || '').trim()
    const relationshipStage = normalizeStage(body?.relationshipStage)
    const romanceMode = normalizeRomance(body?.romanceMode)
    const persistToCharacter = body?.persistToCharacter === true

    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    if (!relationshipStage && !romanceMode) return NextResponse.json({ error: 'No relationship update payload' }, { status: 400 })

    const out = await optimisticUpdateRelationship({
      sb,
      conversationId,
      relationshipStage: relationshipStage || undefined,
      romanceMode: romanceMode || undefined,
    })

    if (persistToCharacter && romanceMode) {
      await persistRomanceModeToCharacter({
        sb,
        characterId: out.characterId,
        romanceMode,
      })
    }

    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
