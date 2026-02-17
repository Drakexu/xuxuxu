export type FeedComment = {
  id: string
  messageId: string
  characterId: string
  content: string
  createdAt: string
}

export type FeedCommentMap = Record<string, FeedComment[]>

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function normalizeComment(v: unknown): FeedComment | null {
  const r = asRecord(v)
  const id = String(r.id || '').trim()
  const messageId = String(r.message_id || r.messageId || '').trim()
  const characterId = String(r.character_id || r.characterId || '').trim()
  const content = String(r.content || '').trim()
  const createdAt = String(r.created_at || r.createdAt || '').trim()
  if (!id || !messageId || !content) return null
  return { id, messageId, characterId, content, createdAt }
}

function sortByCreatedDesc(list: FeedComment[]) {
  return list
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(String(a.createdAt || '')) || 0
      const tb = Date.parse(String(b.createdAt || '')) || 0
      return tb - ta
    })
}

export function mergeFeedCommentMap(base: FeedCommentMap, incoming: FeedCommentMap, perMessageLimit = 8): FeedCommentMap {
  if (!incoming || typeof incoming !== 'object') return base
  const out: FeedCommentMap = { ...base }
  for (const [messageId, rawList] of Object.entries(incoming)) {
    const list = Array.isArray(rawList) ? rawList.map(normalizeComment).filter(Boolean) as FeedComment[] : []
    const uniq: Record<string, FeedComment> = {}
    const merged = [...(out[messageId] || []), ...list]
    for (const it of merged) {
      if (!it?.id) continue
      uniq[it.id] = it
    }
    out[messageId] = sortByCreatedDesc(Object.values(uniq)).slice(0, Math.max(1, Math.min(perMessageLimit, 20)))
  }
  return out
}

export async function fetchFeedComments(args: {
  token: string
  messageIds: string[]
  limitPerMessage?: number
}): Promise<{ tableReady: boolean; comments: FeedCommentMap }> {
  const token = String(args.token || '').trim()
  const ids = Array.from(new Set((args.messageIds || []).map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 200)
  const limit = Math.max(1, Math.min(Math.floor(Number(args.limitPerMessage ?? 6)) || 6, 20))
  if (!token || !ids.length) return { tableReady: true, comments: {} }

  const u = new URL('/api/feed/comments', window.location.origin)
  u.searchParams.set('messageIds', ids.join(','))
  u.searchParams.set('limitPerMessage', String(limit))

  const resp = await fetch(u.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`load comments failed: ${resp.status}`)

  const data = (await resp.json().catch(() => ({}))) as {
    tableReady?: boolean
    comments?: FeedCommentMap
  }
  const tableReady = data.tableReady !== false
  const comments = data.comments && typeof data.comments === 'object' ? data.comments : {}
  return { tableReady, comments }
}

export async function createFeedComment(args: {
  token: string
  messageId: string
  content: string
}): Promise<{ tableReady: boolean; comment: FeedComment | null }> {
  const token = String(args.token || '').trim()
  const messageId = String(args.messageId || '').trim()
  const content = String(args.content || '').trim().slice(0, 300)
  if (!token || !messageId || !content) return { tableReady: true, comment: null }

  const resp = await fetch('/api/feed/comments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messageId,
      content,
    }),
  })
  if (!resp.ok) throw new Error(`save comment failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean; comment?: unknown }
  return {
    tableReady: data.tableReady !== false,
    comment: normalizeComment(data.comment),
  }
}

export async function deleteFeedComment(args: {
  token: string
  commentId: string
}): Promise<{ tableReady: boolean }> {
  const token = String(args.token || '').trim()
  const commentId = String(args.commentId || '').trim()
  if (!token || !commentId) return { tableReady: true }

  const resp = await fetch('/api/feed/comments', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ commentId }),
  })
  if (!resp.ok) throw new Error(`delete comment failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean }
  return { tableReady: data.tableReady !== false }
}
