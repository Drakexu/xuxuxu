import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

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

  // Use the user's access_token as Authorization so RLS applies.
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

type WardrobeReq = {
  conversationId: string
  currentOutfit: string
  confirmed?: boolean
}

async function optimisticUpdateWardrobe(args: { sb: ReturnType<typeof supabaseForToken>; conversationId: string; currentOutfit: string; confirmed?: boolean }) {
  const { sb, conversationId, currentOutfit, confirmed } = args

  // Retry a few times on version conflicts; this is a UX convenience (not PatchScribe).
  for (let i = 0; i < 3; i++) {
    const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', conversationId).maybeSingle()
    if (st.error) throw new Error(st.error.message)
    if (!st.data) throw new Error('Conversation state not found')

    const state = asRecord(st.data.state)
    const ledger = asRecord(state.ledger)
    const wardrobe = { ...asRecord(ledger.wardrobe) }
    wardrobe.current_outfit = currentOutfit
    wardrobe.confirmed = typeof confirmed === 'boolean' ? confirmed : true
    ledger.wardrobe = wardrobe

    // Best-effort event log append (kept short).
    const ev = Array.isArray(ledger.event_log) ? [...ledger.event_log] : []
    ev.push(`[WARDROBE] set current_outfit = ${currentOutfit}`)
    ledger.event_log = ev.slice(-200)

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
    if (upd.data && (!Array.isArray(upd.data) || upd.data.length > 0)) return nextVersion
  }

  throw new Error('Conversation state version conflict')
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    // Verify token (fast fail).
    const u = await sb.auth.getUser(token)
    if (u.error || !u.data?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as WardrobeReq
    const conversationId = String(body?.conversationId || '').trim()
    const currentOutfit = String(body?.currentOutfit || '').trim()
    const confirmed = typeof body?.confirmed === 'boolean' ? body.confirmed : undefined

    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    if (!currentOutfit) return NextResponse.json({ error: 'Missing currentOutfit' }, { status: 400 })
    if (currentOutfit.length > 160) return NextResponse.json({ error: 'currentOutfit too long' }, { status: 400 })

    const v = await optimisticUpdateWardrobe({ sb, conversationId, currentOutfit, confirmed })
    return NextResponse.json({ ok: true, version: v })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

