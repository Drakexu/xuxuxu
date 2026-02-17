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
  const s = msg.toLowerCase()
  return s.includes('feed_comments') && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
}

function parseIdsParam(req: Request) {
  const url = new URL(req.url)
  const raw = String(url.searchParams.get('messageIds') || '').trim()
  if (!raw) return []
  return Array.from(new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, 200)
}

function parseLimit(req: Request) {
  const url = new URL(req.url)
  const n = Number(url.searchParams.get('limitPerMessage') || 6)
  if (!Number.isFinite(n)) return 6
  return Math.max(1, Math.min(Math.floor(n), 20))
}

function normalizeCommentRow(row: unknown) {
  const r = asRecord(row)
  return {
    id: String(r.id || ''),
    message_id: String(r.message_id || ''),
    character_id: String(r.character_id || ''),
    content: String(r.content || ''),
    created_at: String(r.created_at || ''),
  }
}

export async function GET(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const messageIds = parseIdsParam(req)
    const limitPerMessage = parseLimit(req)
    if (!messageIds.length) return NextResponse.json({ ok: true, tableReady: true, comments: {} })

    const rows = await sb
      .from('feed_comments')
      .select('id,message_id,character_id,content,created_at')
      .eq('user_id', userId)
      .in('message_id', messageIds)
      .order('created_at', { ascending: false })
      .limit(Math.min(1500, messageIds.length * limitPerMessage * 4))

    if (rows.error) {
      if (isMissingTableError(rows.error.message || '')) return NextResponse.json({ ok: true, tableReady: false, comments: {} })
      throw new Error(rows.error.message)
    }

    const grouped: Record<string, Array<ReturnType<typeof normalizeCommentRow>>> = {}
    for (const messageId of messageIds) grouped[messageId] = []

    for (const row of rows.data ?? []) {
      const c = normalizeCommentRow(row)
      if (!c.message_id || !c.id) continue
      if (!grouped[c.message_id]) grouped[c.message_id] = []
      if (grouped[c.message_id].length >= limitPerMessage) continue
      grouped[c.message_id].push(c)
    }

    return NextResponse.json({ ok: true, tableReady: true, comments: grouped })
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

    const body = (await req.json()) as { messageId?: string; content?: string }
    const messageId = String(body?.messageId || '').trim()
    const content = String(body?.content || '').trim().slice(0, 300)
    if (!messageId) return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

    const msgRow = await sb.from('messages').select('id,character_id').eq('id', messageId).eq('user_id', userId).maybeSingle()
    if (msgRow.error) throw new Error(msgRow.error.message)
    if (!msgRow.data?.id) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    const characterId = String(msgRow.data.character_id || '').trim()
    if (!characterId) return NextResponse.json({ error: 'Message has no character_id' }, { status: 400 })

    const ins = await sb
      .from('feed_comments')
      .insert({
        user_id: userId,
        message_id: messageId,
        character_id: characterId,
        content,
        updated_at: new Date().toISOString(),
      })
      .select('id,message_id,character_id,content,created_at')
      .single()

    if (ins.error) {
      if (isMissingTableError(ins.error.message || '')) return NextResponse.json({ ok: true, tableReady: false, comment: null })
      throw new Error(ins.error.message)
    }

    return NextResponse.json({ ok: true, tableReady: true, comment: normalizeCommentRow(ins.data) })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

export async function DELETE(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { commentId?: string }
    const commentId = String(body?.commentId || '').trim()
    if (!commentId) return NextResponse.json({ error: 'Missing commentId' }, { status: 400 })

    const del = await sb.from('feed_comments').delete().eq('id', commentId).eq('user_id', userId).select('id').maybeSingle()
    if (del.error) {
      if (isMissingTableError(del.error.message || '')) return NextResponse.json({ ok: true, tableReady: false })
      throw new Error(del.error.message)
    }
    if (!del.data?.id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    return NextResponse.json({ ok: true, tableReady: true })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
