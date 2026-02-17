export type FeedReaction = { liked?: boolean; saved?: boolean }
export type FeedReactionMap = Record<string, FeedReaction>

function normalizeReaction(v: unknown): FeedReaction {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const liked = r.liked === true
  const saved = r.saved === true
  return liked || saved ? { liked, saved } : {}
}

export function mergeFeedReactionMap(base: FeedReactionMap, incoming: FeedReactionMap): FeedReactionMap {
  if (!incoming || typeof incoming !== 'object') return base
  const out: FeedReactionMap = { ...base }
  for (const [messageId, raw] of Object.entries(incoming)) {
    const n = normalizeReaction(raw)
    if (!n.liked && !n.saved) {
      delete out[messageId]
      continue
    }
    out[messageId] = n
  }
  return out
}

export async function fetchFeedReactions(args: {
  token: string
  messageIds: string[]
}): Promise<{ tableReady: boolean; reactions: FeedReactionMap }> {
  const token = String(args.token || '').trim()
  const ids = Array.from(new Set((args.messageIds || []).map((x) => String(x || '').trim()).filter(Boolean))).slice(0, 200)
  if (!token || !ids.length) return { tableReady: true, reactions: {} }

  const u = new URL('/api/feed/reactions', window.location.origin)
  u.searchParams.set('messageIds', ids.join(','))

  const resp = await fetch(u.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`load reactions failed: ${resp.status}`)

  const data = (await resp.json().catch(() => ({}))) as {
    tableReady?: boolean
    reactions?: FeedReactionMap
  }

  const tableReady = data.tableReady !== false
  const reactions = data.reactions && typeof data.reactions === 'object' ? data.reactions : {}
  return { tableReady, reactions }
}

export async function saveFeedReaction(args: {
  token: string
  messageId: string
  liked: boolean
  saved: boolean
}): Promise<{ tableReady: boolean }> {
  const token = String(args.token || '').trim()
  const messageId = String(args.messageId || '').trim()
  if (!token || !messageId) return { tableReady: true }

  const resp = await fetch('/api/feed/reactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messageId,
      liked: args.liked === true,
      saved: args.saved === true,
    }),
  })
  if (!resp.ok) throw new Error(`save reaction failed: ${resp.status}`)
  const data = (await resp.json().catch(() => ({}))) as { tableReady?: boolean }
  return { tableReady: data.tableReady !== false }
}
