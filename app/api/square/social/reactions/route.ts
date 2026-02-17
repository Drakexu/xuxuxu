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
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function isMissingTableError(msg: string) {
  const s = String(msg || '').toLowerCase()
  return s.includes('square_reactions') && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
}

function parseIdsParam(req: Request) {
  const url = new URL(req.url)
  const raw = String(url.searchParams.get('sourceCharacterIds') || '').trim()
  if (!raw) return []
  return Array.from(new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, 120)
}

export async function GET(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)
    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sourceIds = parseIdsParam(req)
    if (!sourceIds.length) return NextResponse.json({ ok: true, tableReady: true, reactions: {} })

    const rows = await sb
      .from('square_reactions')
      .select('source_character_id,liked,saved')
      .eq('user_id', userId)
      .in('source_character_id', sourceIds)
      .limit(300)

    if (rows.error) {
      if (isMissingTableError(rows.error.message || '')) {
        return NextResponse.json({ ok: true, tableReady: false, reactions: {} })
      }
      throw new Error(rows.error.message)
    }

    const out: Record<string, { liked: boolean; saved: boolean }> = {}
    for (const row of rows.data ?? []) {
      const r = asRecord(row)
      const sourceCharacterId = String(r.source_character_id || '').trim()
      if (!sourceCharacterId) continue
      out[sourceCharacterId] = {
        liked: r.liked === true,
        saved: r.saved === true,
      }
    }

    return NextResponse.json({ ok: true, tableReady: true, reactions: out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)
    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as {
      sourceCharacterId?: string
      liked?: boolean
      saved?: boolean
    }
    const sourceCharacterId = String(body.sourceCharacterId || '').trim()
    const liked = body.liked === true
    const saved = body.saved === true
    if (!sourceCharacterId) return NextResponse.json({ error: 'Missing sourceCharacterId' }, { status: 400 })

    if (!liked && !saved) {
      const del = await sb
        .from('square_reactions')
        .delete()
        .eq('user_id', userId)
        .eq('source_character_id', sourceCharacterId)
      if (del.error) {
        if (isMissingTableError(del.error.message || '')) return NextResponse.json({ ok: true, tableReady: false })
        throw new Error(del.error.message)
      }
      return NextResponse.json({ ok: true, tableReady: true })
    }

    const up = await sb.from('square_reactions').upsert(
      {
        user_id: userId,
        source_character_id: sourceCharacterId,
        liked,
        saved,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,source_character_id' },
    )
    if (up.error) {
      if (isMissingTableError(up.error.message || '')) return NextResponse.json({ ok: true, tableReady: false })
      throw new Error(up.error.message)
    }

    return NextResponse.json({ ok: true, tableReady: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
