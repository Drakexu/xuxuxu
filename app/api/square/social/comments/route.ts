import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function parseBearerToken(req: Request) {
  const auth = (req.headers.get('authorization') || '').trim()
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : ''
}

function requireAuthToken(req: Request) {
  const token = parseBearerToken(req)
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
  return s.includes('square_comments') && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
}

function parseSourceId(req: Request) {
  const url = new URL(req.url)
  return String(url.searchParams.get('sourceCharacterId') || '').trim()
}

function parseLimit(req: Request) {
  const url = new URL(req.url)
  const n = Number(url.searchParams.get('limit') || 20)
  if (!Number.isFinite(n)) return 20
  return Math.max(1, Math.min(Math.floor(n), 60))
}

function shortUserLabel(userId: string) {
  const v = String(userId || '').trim()
  if (!v) return '用户'
  if (v.length <= 8) return `用户${v}`
  return `用户${v.slice(0, 4)}${v.slice(-2)}`
}

function normalizeCommentRow(
  row: unknown,
  options?: {
    me?: string
    sourceOwnerId?: string
  },
) {
  const me = String(options?.me || '').trim()
  const sourceOwnerId = String(options?.sourceOwnerId || '').trim()
  const r = asRecord(row)
  const userId = String(r.user_id || '')
  const mine = !!me && userId === me
  const creator = !!sourceOwnerId && userId === sourceOwnerId
  const canDelete = mine || (!!me && me === sourceOwnerId)
  return {
    id: String(r.id || ''),
    source_character_id: String(r.source_character_id || ''),
    content: String(r.content || ''),
    created_at: String(r.created_at || ''),
    mine,
    creator,
    can_delete: canDelete,
    author_role: mine ? 'me' : creator ? 'creator' : 'user',
    author_label: mine ? '我' : creator ? '创作者' : shortUserLabel(userId),
  }
}

export async function GET(req: Request) {
  try {
    const sourceCharacterId = parseSourceId(req)
    const limit = parseLimit(req)
    if (!sourceCharacterId) return NextResponse.json({ error: 'Missing sourceCharacterId' }, { status: 400 })

    let me = ''
    const token = parseBearerToken(req)
    if (token) {
      try {
        const sb = supabaseForToken(token)
        const u = await sb.auth.getUser(token)
        if (!u.error && u.data?.user?.id) me = u.data.user.id
      } catch {
        // ignore invalid token for public reads
      }
    }

    let admin: ReturnType<typeof createAdminClient>
    try {
      admin = createAdminClient()
    } catch {
      return NextResponse.json({ ok: true, tableReady: false, comments: [] })
    }

    let sourceOwnerId = ''
    try {
      const source = await admin
        .from('characters')
        .select('user_id')
        .eq('id', sourceCharacterId)
        .maybeSingle()
      if (!source.error) sourceOwnerId = String(source.data?.user_id || '')
    } catch {
      // ignore
    }

    const rows = await admin
      .from('square_comments')
      .select('id,user_id,source_character_id,content,created_at')
      .eq('source_character_id', sourceCharacterId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (rows.error) {
      if (isMissingTableError(rows.error.message || '')) return NextResponse.json({ ok: true, tableReady: false, comments: [] })
      throw new Error(rows.error.message)
    }

    const comments = (rows.data ?? []).map((row) => normalizeCommentRow(row, { me, sourceOwnerId }))
    return NextResponse.json({ ok: true, tableReady: true, comments })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing sourceCharacterId') ? 400 : 500
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

    const body = (await req.json()) as { sourceCharacterId?: string; content?: string }
    const sourceCharacterId = String(body.sourceCharacterId || '').trim()
    const content = String(body.content || '').trim().slice(0, 300)
    if (!sourceCharacterId) return NextResponse.json({ error: 'Missing sourceCharacterId' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 })

    let sourceOwnerId = ''
    try {
      const admin = createAdminClient()
      const source = await admin.from('characters').select('user_id').eq('id', sourceCharacterId).maybeSingle()
      if (!source.error) sourceOwnerId = String(source.data?.user_id || '')
    } catch {
      // ignore
    }

    const ins = await sb
      .from('square_comments')
      .insert({
        user_id: userId,
        source_character_id: sourceCharacterId,
        content,
        updated_at: new Date().toISOString(),
      })
      .select('id,user_id,source_character_id,content,created_at')
      .single()

    if (ins.error) {
      if (isMissingTableError(ins.error.message || '')) return NextResponse.json({ ok: true, tableReady: false, comment: null })
      throw new Error(ins.error.message)
    }

    return NextResponse.json({
      ok: true,
      tableReady: true,
      comment: normalizeCommentRow(ins.data, { me: userId, sourceOwnerId }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('Missing') ? 400 : 500
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
    const commentId = String(body.commentId || '').trim()
    if (!commentId) return NextResponse.json({ error: 'Missing commentId' }, { status: 400 })

    let admin: ReturnType<typeof createAdminClient> | null = null
    try {
      admin = createAdminClient()
    } catch {
      // fallback to self-delete only
    }

    if (!admin) {
      const del = await sb.from('square_comments').delete().eq('id', commentId).eq('user_id', userId).select('id').maybeSingle()
      if (del.error) {
        if (isMissingTableError(del.error.message || '')) return NextResponse.json({ ok: true, tableReady: false })
        throw new Error(del.error.message)
      }
      if (!del.data?.id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
      return NextResponse.json({ ok: true, tableReady: true, deletedBy: 'self' })
    }

    const row = await admin.from('square_comments').select('id,user_id,source_character_id').eq('id', commentId).maybeSingle()
    if (row.error) {
      if (isMissingTableError(row.error.message || '')) return NextResponse.json({ ok: true, tableReady: false })
      throw new Error(row.error.message)
    }
    if (!row.data?.id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    const commentUserId = String(row.data.user_id || '')
    const sourceCharacterId = String(row.data.source_character_id || '')
    if (commentUserId === userId) {
      const delOwn = await sb.from('square_comments').delete().eq('id', commentId).eq('user_id', userId).select('id').maybeSingle()
      if (delOwn.error) throw new Error(delOwn.error.message)
      if (!delOwn.data?.id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
      return NextResponse.json({ ok: true, tableReady: true, deletedBy: 'self' })
    }

    const source = await admin.from('characters').select('user_id').eq('id', sourceCharacterId).maybeSingle()
    if (source.error) throw new Error(source.error.message)
    const sourceOwnerId = String(source.data?.user_id || '')
    if (!sourceOwnerId || sourceOwnerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const delByCreator = await admin.from('square_comments').delete().eq('id', commentId).select('id').maybeSingle()
    if (delByCreator.error) throw new Error(delByCreator.error.message)
    if (!delByCreator.data?.id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    return NextResponse.json({ ok: true, tableReady: true, deletedBy: 'creator' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token')
      ? 401
      : msg.includes('Missing commentId')
        ? 400
        : msg.includes('Forbidden')
          ? 403
          : msg.includes('not found')
            ? 404
            : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
