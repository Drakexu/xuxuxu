export type SquareReaction = { liked?: boolean; saved?: boolean }
export type SquareReactionMap = Record<string, SquareReaction>

export type SquareComment = {
  id: string
  sourceCharacterId: string
  content: string
  createdAt: string
  mine?: boolean
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function normalizeReaction(v: unknown): SquareReaction {
  const r = asRecord(v)
  const liked = r.liked === true
  const saved = r.saved === true
  return liked || saved ? { liked, saved } : {}
}

function normalizeComment(v: unknown): SquareComment | null {
  const r = asRecord(v)
  const id = String(r.id || '').trim()
  const sourceCharacterId = String(r.source_character_id || r.sourceCharacterId || '').trim()
  const content = String(r.content || '').trim()
  const createdAt = String(r.created_at || r.createdAt || '').trim()
  const mine = r.mine === true
  if (!id || !sourceCharacterId || !content) return null
  return { id, sourceCharacterId, content, createdAt, mine }
}

export function mergeSquareReactionMap(base: SquareReactionMap, incoming: SquareReactionMap): SquareReactionMap {
  if (!incoming || typeof incoming !== 'object') return base
  const out: SquareReactionMap = { ...base }
  for (const [sourceCharacterId, raw] of Object.entries(incoming)) {
    const n = normalizeReaction(raw)
    if (!n.liked && !n.saved) {
      delete out[sourceCharacterId]
      continue
    }
    out[sourceCharacterId] = n
  }
  return out
}

export async function fetchSquareReactions(args: {
  token: string
  sourceCharacterIds: string[]
}): Promise<{ tableReady: boolean; reactions: SquareReactionMap }> {
  const token = String(args.token || '').trim()
  const ids = Array.from(new Set((args.sourceCharacterIds || []).map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 120)
  if (!token || !ids.length) return { tableReady: true, reactions: {} }

  const u = new URL('/api/square/social/reactions', window.location.origin)
  u.searchParams.set('sourceCharacterIds', ids.join(','))
  const resp = await fetch(u.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`load square reactions failed: ${resp.status}`)

  const data = (await resp.json().catch(() => ({}))) as {
    tableReady?: boolean
    reactions?: Record<string, unknown>
  }

  const out: SquareReactionMap = {}
  for (const [sourceCharacterId, raw] of Object.entries(data.reactions || {})) {
    const n = normalizeReaction(raw)
    if (!n.liked && !n.saved) continue
    out[sourceCharacterId] = n
  }
  return {
    tableReady: data.tableReady !== false,
    reactions: out,
  }
}

export async function saveSquareReaction(args: {
  token: string
  sourceCharacterId: string
  liked: boolean
  saved: boolean
}): Promise<{ tableReady: boolean }> {
  const token = String(args.token || '').trim()
  const sourceCharacterId = String(args.sourceCharacterId || '').trim()
  if (!token || !sourceCharacterId) return { tableReady: true }

  const resp = await fetch('/api/square/social/reactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      sourceCharacterId,
      liked: args.liked === true,
      saved: args.saved === true,
    }),
  })
  if (!resp.ok) throw new Error(`save square reaction failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean }
  return { tableReady: data.tableReady !== false }
}

export async function fetchSquareComments(args: {
  sourceCharacterId: string
  limit?: number
  token?: string
}): Promise<{ tableReady: boolean; comments: SquareComment[] }> {
  const sourceCharacterId = String(args.sourceCharacterId || '').trim()
  const limit = Math.max(1, Math.min(Math.floor(Number(args.limit ?? 20)) || 20, 60))
  const token = String(args.token || '').trim()
  if (!sourceCharacterId) return { tableReady: true, comments: [] }

  const u = new URL('/api/square/social/comments', window.location.origin)
  u.searchParams.set('sourceCharacterId', sourceCharacterId)
  u.searchParams.set('limit', String(limit))
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetch(u.toString(), { method: 'GET', headers })
  if (!resp.ok) throw new Error(`load square comments failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as {
    tableReady?: boolean
    comments?: unknown[]
  }
  const comments = Array.isArray(data.comments) ? data.comments.map(normalizeComment).filter(Boolean) as SquareComment[] : []
  return { tableReady: data.tableReady !== false, comments }
}

export async function createSquareComment(args: {
  token: string
  sourceCharacterId: string
  content: string
}): Promise<{ tableReady: boolean; comment: SquareComment | null }> {
  const token = String(args.token || '').trim()
  const sourceCharacterId = String(args.sourceCharacterId || '').trim()
  const content = String(args.content || '').trim().slice(0, 300)
  if (!token || !sourceCharacterId || !content) return { tableReady: true, comment: null }

  const resp = await fetch('/api/square/social/comments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sourceCharacterId, content }),
  })
  if (!resp.ok) throw new Error(`save square comment failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean; comment?: unknown }
  return {
    tableReady: data.tableReady !== false,
    comment: normalizeComment(data.comment),
  }
}

export async function deleteSquareComment(args: {
  token: string
  commentId: string
}): Promise<{ tableReady: boolean }> {
  const token = String(args.token || '').trim()
  const commentId = String(args.commentId || '').trim()
  if (!token || !commentId) return { tableReady: true }

  const resp = await fetch('/api/square/social/comments', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ commentId }),
  })
  if (!resp.ok) throw new Error(`delete square comment failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean }
  return { tableReady: data.tableReady !== false }
}
