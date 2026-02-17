'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { fetchFeedReactions, mergeFeedReactionMap, saveFeedReaction, type FeedReactionMap } from '@/lib/feedReactions'
import {
  createFeedComment,
  deleteFeedComment,
  fetchFeedComments,
  mergeFeedCommentMap,
  type FeedCommentMap,
} from '@/lib/feedComments'
import { ensureLatestConversationForCharacter } from '@/lib/conversationClient'
import AppShell from '@/app/_components/AppShell'

type CharacterRow = { id: string; name: string; created_at?: string; settings?: Record<string, unknown> }
type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type FeedItem = {
  id: string
  created_at: string
  input_event: string | null
  content: string
  conversation_id: string
  conversations?: { character_id?: string | null } | null
}
type ConversationRow = { id: string; character_id?: string | null; created_at?: string | null }
type ConversationStateRow = { conversation_id: string; state?: unknown }
type MessageEventRow = { character_id?: string | null; created_at?: string | null }
type CharacterDigest = {
  conversationId: string
  latestAt: string
  outfit: boolean
  inventory: boolean
  npc: boolean
  highlights: boolean
  complete: number
}

type FeedTab = 'ALL' | 'MOMENT' | 'DIARY' | 'SCHEDULE'
type FeedSort = 'NEWEST' | 'LIKED_FIRST' | 'SAVED_FIRST' | 'COMMENT_FIRST' | 'HOT_FIRST'
type RoleSort = 'QUEUE' | 'RECENT' | 'LEDGER'
type LifeEvent = 'MOMENT_POST' | 'DIARY_DAILY' | 'SCHEDULE_TICK'
const FEED_PAGE_SIZE = 80
const FEED_REACTION_STORAGE_KEY = 'xuxuxu:feed:reactions:v1'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

const LIFE_EVENT_CONFIG: Array<{ event: LifeEvent; tab: FeedTab; title: string; cadence: string; emptyHint: string }> = [
  { event: 'MOMENT_POST', tab: 'MOMENT', title: '朋友圈', cadence: '每小时', emptyHint: '还没有朋友圈动态' },
  { event: 'DIARY_DAILY', tab: 'DIARY', title: '日记', cadence: '每天', emptyHint: '还没有日记' },
  { event: 'SCHEDULE_TICK', tab: 'SCHEDULE', title: '日程片段', cadence: '每小时', emptyHint: '还没有日程片段' },
]

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function relativeTimeLabel(iso: string) {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return '暂无动态'
  const delta = Date.now() - ts
  if (delta < 0) return '刚刚'
  const mins = Math.floor(delta / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function isUnlockedFromSquare(c: CharacterRow) {
  const s = asRecord(c.settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0) || s.unlocked_from_square === true
}

function isActivatedCharacter(c: CharacterRow) {
  if (!isUnlockedFromSquare(c)) return false
  const s = asRecord(c.settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

function activationOrder(c: CharacterRow) {
  const s = asRecord(c.settings)
  const n = Number(s.activated_order ?? NaN)
  if (Number.isFinite(n)) return n
  const t = c.created_at ? Date.parse(c.created_at) : NaN
  return Number.isFinite(t) ? t : 0
}

function pickAssetPath(rows: CharacterAssetRow[]) {
  // Prefer cover > full_body > head.
  const byKind: Record<string, CharacterAssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  const prefer = ['cover', 'full_body', 'head']
  for (const k of prefer) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

function compactPreview(s: string, max = 86) {
  const text = String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, max)}...`
}

export default function HomeFeedPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [manage, setManage] = useState(false)
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'UNLOCKED'>('ACTIVE')
  const [roleSort, setRoleSort] = useState<RoleSort>('QUEUE')

  const [activated, setActivated] = useState<CharacterRow[]>([])
  const [unlocked, setUnlocked] = useState<CharacterRow[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [characterDigestById, setCharacterDigestById] = useState<Record<string, CharacterDigest>>({})
  const [activeCharId, setActiveCharId] = useState<string>('') // '' => all
  const [feedTab, setFeedTab] = useState<FeedTab>('ALL')
  const [feedSort, setFeedSort] = useState<FeedSort>('NEWEST')
  const [likedOnly, setLikedOnly] = useState(false)
  const [savedOnly, setSavedOnly] = useState(false)
  const [feedQuery, setFeedQuery] = useState('')
  const [items, setItems] = useState<FeedItem[]>([])
  const [feedReactions, setFeedReactions] = useState<FeedReactionMap>({})
  const [feedComments, setFeedComments] = useState<FeedCommentMap>({})
  const [commentDraftByMessageId, setCommentDraftByMessageId] = useState<Record<string, string>>({})
  const [commentExpandedByMessageId, setCommentExpandedByMessageId] = useState<Record<string, boolean>>({})
  const [commentSavingMessageId, setCommentSavingMessageId] = useState('')
  const [commentDeletingId, setCommentDeletingId] = useState('')
  const [feedAllowedCharacterIds, setFeedAllowedCharacterIds] = useState<string[]>([])
  const [feedCursor, setFeedCursor] = useState('')
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [loadingMoreFeed, setLoadingMoreFeed] = useState(false)
  const [feedReactionTableReady, setFeedReactionTableReady] = useState(true)
  const [feedCommentTableReady, setFeedCommentTableReady] = useState(true)

  const canLoad = useMemo(() => !loading, [loading])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FEED_REACTION_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as FeedReactionMap
      if (parsed && typeof parsed === 'object') setFeedReactions(parsed)
    } catch {
      // ignore corrupted local cache
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(FEED_REACTION_STORAGE_KEY, JSON.stringify(feedReactions))
    } catch {
      // ignore quota/private mode errors
    }
  }, [feedReactions])

  useEffect(() => {
    const messageIds = items.map((it) => String(it.id || '').trim()).filter(Boolean).slice(0, 200)
    if (!messageIds.length) return

    let canceled = false
    const run = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (!token) return
        const out = await fetchFeedReactions({ token, messageIds })
        if (canceled) return
        setFeedReactionTableReady(out.tableReady)
        if (out.reactions && Object.keys(out.reactions).length) {
          setFeedReactions((prev) => mergeFeedReactionMap(prev, out.reactions))
        }
      } catch {
        // ignore: local cache remains the fallback
      }
    }
    void run()

    return () => {
      canceled = true
    }
  }, [items])

  useEffect(() => {
    const messageIds = items.map((it) => String(it.id || '').trim()).filter(Boolean).slice(0, 200)
    if (!messageIds.length) return

    let canceled = false
    const run = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (!token) return
        const out = await fetchFeedComments({ token, messageIds, limitPerMessage: 6 })
        if (canceled) return
        setFeedCommentTableReady(out.tableReady)
        if (out.comments && Object.keys(out.comments).length) {
          setFeedComments((prev) => mergeFeedCommentMap(prev, out.comments, 8))
        }
      } catch {
        // ignore
      }
    }
    void run()

    return () => {
      canceled = true
    }
  }, [items])

  const updateCharacterSettings = async (characterId: string, patch: Record<string, unknown>) => {
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const row = activated.find((c) => c.id === characterId)
    const nextSettings = { ...asRecord(row?.settings), ...patch }
    const r = await supabase
      .from('characters')
      .update({ settings: nextSettings })
      .eq('id', characterId)
      .eq('user_id', userId)
    if (r.error) throw new Error(r.error.message)
    setActivated((prev) => prev.map((c) => (c.id === characterId ? { ...c, settings: nextSettings } : c)))
  }

  const load = async () => {
    setLoading(true)
    setError('')
    setImgById({})
    setCharacterDigestById({})
    setFeedAllowedCharacterIds([])
    setFeedCursor('')
    setFeedHasMore(false)
    setLoadingMoreFeed(false)
    setFeedComments({})
    setCommentDraftByMessageId({})
    setCommentExpandedByMessageId({})
    setCommentSavingMessageId('')
    setCommentDeletingId('')

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const rChars = await supabase
      .from('characters')
      .select('id,name,created_at,settings')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(400)
    let activatedIds = new Set<string>()
    let unlockedIdsForFeed = new Set<string>()
    if (rChars.error) {
      setError(rChars.error.message || '加载角色失败')
      setActivated([])
      setUnlocked([])
    } else {
      const rows = (rChars.data ?? []) as CharacterRow[]
      const nextUnlocked = rows.filter(isUnlockedFromSquare).sort((a, b) => activationOrder(a) - activationOrder(b))
      const nextActivated = rows.filter(isActivatedCharacter).sort((a, b) => activationOrder(a) - activationOrder(b))
      setUnlocked(nextUnlocked)
      setActivated(nextActivated)
      activatedIds = new Set(nextActivated.map((c) => c.id))
      const unlockedIds = new Set(nextUnlocked.map((c) => c.id))
      unlockedIdsForFeed = unlockedIds
      setActiveCharId((prev) => (prev && !unlockedIds.has(prev) ? '' : prev))

      // Best-effort media for activated characters (cover/full_body/head).
      try {
        const ids = nextUnlocked.map((c) => c.id).filter(Boolean)
        if (ids.length) {
          const assets = await supabase
            .from('character_assets')
            .select('character_id,kind,storage_path,created_at')
            .in('character_id', ids)
            .in('kind', ['cover', 'full_body', 'head'])
            .order('created_at', { ascending: false })
            .limit(400)

          if (!assets.error) {
            const grouped: Record<string, CharacterAssetRow[]> = {}
            for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
              if (!row.character_id) continue
              if (!grouped[row.character_id]) grouped[row.character_id] = []
              grouped[row.character_id].push(row)
            }

            const entries = Object.entries(grouped)
              .map(([characterId, rows2]) => [characterId, pickAssetPath(rows2)] as const)
              .filter(([, path]) => !!path)

            if (entries.length) {
              const signed = await Promise.all(
                entries.map(async ([characterId, path]) => {
                  const r = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
                  return [characterId, r.data?.signedUrl || ''] as const
                }),
              )

              const map: Record<string, string> = {}
              for (const [characterId, url] of signed) {
                if (url) map[characterId] = url
              }
              setImgById(map)
            }
          }
        }
      } catch {
        // ignore: media is optional
      }

      // Best-effort role digest: latest feed time + ledger completeness per unlocked role.
      try {
        const ids = nextUnlocked.map((c) => c.id).filter(Boolean).slice(0, 240)
        if (ids.length) {
          const convs = await supabase
            .from('conversations')
            .select('id,character_id,created_at')
            .eq('user_id', userId)
            .in('character_id', ids)
            .order('created_at', { ascending: false })
            .limit(1000)

          const latestConvByCharacter: Record<string, ConversationRow> = {}
          if (!convs.error) {
            for (const row of (convs.data ?? []) as ConversationRow[]) {
              const cid = String(row.character_id || '').trim()
              if (!cid || latestConvByCharacter[cid]) continue
              latestConvByCharacter[cid] = row
            }
          }

          // Backfill one default conversation for old unlocked roles without conversations.
          // This enables autonomous schedule ticks even if role was unlocked before this logic existed.
          const nameById: Record<string, string> = {}
          for (const c of nextUnlocked) {
            if (c.id) nameById[c.id] = String(c.name || '对话')
          }
          const missingConvCharacterIds = ids.filter((cid) => !latestConvByCharacter[cid]).slice(0, 24)
          for (const cid of missingConvCharacterIds) {
            try {
              const out = await ensureLatestConversationForCharacter({
                userId,
                characterId: cid,
                title: nameById[cid] || '对话',
              })
              latestConvByCharacter[cid] = {
                id: out.conversationId,
                character_id: cid,
                created_at: new Date().toISOString(),
              }
            } catch {
              // ignore bootstrap errors
            }
          }

          const convIds = Object.values(latestConvByCharacter)
            .map((x) => String(x.id || '').trim())
            .filter(Boolean)

          const stateByConversationId: Record<string, unknown> = {}
          if (convIds.length) {
            const states = await supabase
              .from('conversation_states')
              .select('conversation_id,state')
              .in('conversation_id', convIds)
              .limit(1000)
            if (!states.error) {
              for (const row of (states.data ?? []) as ConversationStateRow[]) {
                const cid = String(row.conversation_id || '').trim()
                if (!cid) continue
                stateByConversationId[cid] = row.state ?? {}
              }
            }
          }

          const latestFeedAtByCharacter: Record<string, string> = {}
          const latestFeed = await supabase
            .from('messages')
            .select('character_id,created_at')
            .eq('user_id', userId)
            .in('character_id', ids)
            .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
            .order('created_at', { ascending: false })
            .limit(2000)
          if (!latestFeed.error) {
            for (const row of (latestFeed.data ?? []) as MessageEventRow[]) {
              const cid = String(row.character_id || '').trim()
              if (!cid || latestFeedAtByCharacter[cid]) continue
              latestFeedAtByCharacter[cid] = String(row.created_at || '')
            }
          }

          const digestMap: Record<string, CharacterDigest> = {}
          for (const id of ids) {
            const conv = latestConvByCharacter[id]
            const convId = String(conv?.id || '').trim()
            const root = asRecord(stateByConversationId[convId])
            const ledger = asRecord(root.ledger)
            const memory = asRecord(root.memory)
            const wardrobe = asRecord(ledger.wardrobe)
            const outfit = !!String(wardrobe.current_outfit || '').trim()
            const inventory = asArray(ledger.inventory).length > 0
            const npc = asArray(ledger.npc_database).length > 0
            const highlights = asArray(memory.highlights).length > 0
            const complete = [outfit, inventory, npc, highlights].filter(Boolean).length
            digestMap[id] = {
              conversationId: convId,
              latestAt: String(latestFeedAtByCharacter[id] || conv?.created_at || ''),
              outfit,
              inventory,
              npc,
              highlights,
              complete,
            }
          }
          setCharacterDigestById(digestMap)
        }
      } catch {
        // ignore: digest is optional and should not block the page
      }
    }

    const feedEvents = ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK']
    const rFeed = await supabase
      .from('messages')
      .select('id,created_at,input_event,content,conversation_id,conversations(character_id)')
      .eq('user_id', userId)
      .in('input_event', feedEvents)
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE_SIZE)

    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
      setItems([])
    } else {
      const raw = (rFeed.data ?? []) as FeedItem[]
      const fallbackIds = unlockedIdsForFeed.size ? unlockedIdsForFeed : activatedIds
      setFeedAllowedCharacterIds(Array.from(fallbackIds))
      setItems(raw.filter((it) => fallbackIds.has(String(it.conversations?.character_id || ''))))
      setFeedCursor(raw.length ? String(raw[raw.length - 1]?.created_at || '') : '')
      setFeedHasMore(raw.length >= FEED_PAGE_SIZE)
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const loadMoreFeed = async () => {
    if (loading || loadingMoreFeed || !feedHasMore || !feedCursor) return
    setLoadingMoreFeed(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const allowed = new Set(feedAllowedCharacterIds)
      const rFeed = await supabase
        .from('messages')
        .select('id,created_at,input_event,content,conversation_id,conversations(character_id)')
        .eq('user_id', userId)
        .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
        .lt('created_at', feedCursor)
        .order('created_at', { ascending: false })
        .limit(FEED_PAGE_SIZE)

      if (rFeed.error) {
        setError(rFeed.error.message || '加载更多动态失败')
        return
      }

      const raw = (rFeed.data ?? []) as FeedItem[]
      const nextFiltered = raw.filter((it) => allowed.has(String(it.conversations?.character_id || '')))

      if (nextFiltered.length) {
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          const merged = [...prev]
          for (const it of nextFiltered) {
            if (seen.has(it.id)) continue
            merged.push(it)
          }
          return merged
        })
      }

      setFeedCursor(raw.length ? String(raw[raw.length - 1]?.created_at || '') : '')
      if (raw.length < FEED_PAGE_SIZE) setFeedHasMore(false)
    } finally {
      setLoadingMoreFeed(false)
    }
  }

  const filtered = useMemo(() => {
    const visibleIds = new Set((viewMode === 'ACTIVE' ? activated : unlocked).map((c) => c.id))
    let next = items
    next = next.filter((it) => visibleIds.has(String(it.conversations?.character_id || '')))
    if (activeCharId) next = next.filter((it) => String(it.conversations?.character_id || '') === activeCharId)
    if (feedTab === 'MOMENT') next = next.filter((it) => it.input_event === 'MOMENT_POST')
    if (feedTab === 'DIARY') next = next.filter((it) => it.input_event === 'DIARY_DAILY')
    if (feedTab === 'SCHEDULE') next = next.filter((it) => it.input_event === 'SCHEDULE_TICK')
    const q = feedQuery.trim().toLowerCase()
    if (q) next = next.filter((it) => (it.content || '').toLowerCase().includes(q))
    if (likedOnly) next = next.filter((it) => !!feedReactions[it.id]?.liked)
    if (savedOnly) next = next.filter((it) => !!feedReactions[it.id]?.saved)
    const ts = (it: FeedItem) => {
      const n = Date.parse(String(it.created_at || ''))
      return Number.isFinite(n) ? n : 0
    }
    const commentsCount = (id: string) => Number(feedComments[id]?.length || 0)
    const hotScore = (id: string) => {
      const liked = feedReactions[id]?.liked ? 1 : 0
      const saved = feedReactions[id]?.saved ? 2 : 0
      const comments = commentsCount(id) * 2
      return liked + saved + comments
    }
    if (feedSort === 'LIKED_FIRST') {
      next = next.slice().sort((a, b) => {
        const la = feedReactions[a.id]?.liked ? 1 : 0
        const lb = feedReactions[b.id]?.liked ? 1 : 0
        if (lb !== la) return lb - la
        return ts(b) - ts(a)
      })
    } else if (feedSort === 'SAVED_FIRST') {
      next = next.slice().sort((a, b) => {
        const sa = feedReactions[a.id]?.saved ? 1 : 0
        const sb = feedReactions[b.id]?.saved ? 1 : 0
        if (sb !== sa) return sb - sa
        return ts(b) - ts(a)
      })
    } else if (feedSort === 'COMMENT_FIRST') {
      next = next.slice().sort((a, b) => {
        const ca = commentsCount(a.id)
        const cb = commentsCount(b.id)
        if (cb !== ca) return cb - ca
        return ts(b) - ts(a)
      })
    } else if (feedSort === 'HOT_FIRST') {
      next = next.slice().sort((a, b) => {
        const ha = hotScore(a.id)
        const hb = hotScore(b.id)
        if (hb !== ha) return hb - ha
        return ts(b) - ts(a)
      })
    } else {
      next = next.slice().sort((a, b) => ts(b) - ts(a))
    }
    return next
  }, [items, activeCharId, feedTab, activated, unlocked, viewMode, feedQuery, feedSort, likedOnly, savedOnly, feedReactions, feedComments])

  const nameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of unlocked) m[c.id] = c.name
    return m
  }, [unlocked])

  const visibleCharacters = useMemo(() => (viewMode === 'ACTIVE' ? activated : unlocked), [viewMode, activated, unlocked])
  const sortedVisibleCharacters = useMemo(() => {
    const arr = visibleCharacters.slice()
    if (roleSort === 'RECENT') {
      arr.sort((a, b) => {
        const ta = Date.parse(String(characterDigestById[a.id]?.latestAt || '')) || 0
        const tb = Date.parse(String(characterDigestById[b.id]?.latestAt || '')) || 0
        if (tb !== ta) return tb - ta
        return activationOrder(a) - activationOrder(b)
      })
      return arr
    }
    if (roleSort === 'LEDGER') {
      arr.sort((a, b) => {
        const ca = Number(characterDigestById[a.id]?.complete || 0)
        const cb = Number(characterDigestById[b.id]?.complete || 0)
        if (cb !== ca) return cb - ca
        const ta = Date.parse(String(characterDigestById[a.id]?.latestAt || '')) || 0
        const tb = Date.parse(String(characterDigestById[b.id]?.latestAt || '')) || 0
        if (tb !== ta) return tb - ta
        return activationOrder(a) - activationOrder(b)
      })
      return arr
    }
    return arr
  }, [visibleCharacters, roleSort, characterDigestById])
  const selectedCharacter = useMemo(() => {
    if (!activeCharId) return null
    return sortedVisibleCharacters.find((c) => c.id === activeCharId) || null
  }, [sortedVisibleCharacters, activeCharId])
  const activatedIdSet = useMemo(() => new Set(activated.map((c) => c.id)), [activated])
  const feedStats = useMemo(() => {
    let moments = 0
    let diaries = 0
    let schedules = 0
    for (const it of items) {
      if (it.input_event === 'MOMENT_POST') moments += 1
      else if (it.input_event === 'DIARY_DAILY') diaries += 1
      else if (it.input_event === 'SCHEDULE_TICK') schedules += 1
    }
    return {
      moments,
      diaries,
      schedules,
      liked: items.filter((it) => !!feedReactions[it.id]?.liked).length,
      saved: items.filter((it) => !!feedReactions[it.id]?.saved).length,
      comments: Object.values(feedComments).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
      total: items.length,
    }
  }, [items, feedReactions, feedComments])
  const digestStats = useMemo(() => {
    let full = 0
    let withConversation = 0
    let withRecentFeed = 0
    for (const c of unlocked) {
      const d = characterDigestById[c.id]
      if (!d) continue
      if (d.complete >= 4) full += 1
      if (d.conversationId) withConversation += 1
      if (d.latestAt) withRecentFeed += 1
    }
    return { full, withConversation, withRecentFeed }
  }, [unlocked, characterDigestById])
  const selectedCharacterStats = useMemo(() => {
    if (!selectedCharacter) return null
    const targetId = selectedCharacter.id
    const digest = characterDigestById[targetId]
    const ownItems = items.filter((it) => String(it.conversations?.character_id || '') === targetId)
    let moment = 0
    let diary = 0
    let schedule = 0
    for (const it of ownItems) {
      if (it.input_event === 'MOMENT_POST') moment += 1
      else if (it.input_event === 'DIARY_DAILY') diary += 1
      else if (it.input_event === 'SCHEDULE_TICK') schedule += 1
    }
    const latest = ownItems[0] || null
    return {
      total: ownItems.length,
      moment,
      diary,
      schedule,
      comments: ownItems.reduce((sum, it) => sum + Number(feedComments[it.id]?.length || 0), 0),
      latestAt: latest?.created_at || digest?.latestAt || '',
      latestContent: String(latest?.content || '').trim(),
      ledgerComplete: Number(digest?.complete || 0),
    }
  }, [items, selectedCharacter, characterDigestById, feedComments])
  const focusItems = useMemo(() => {
    if (!activeCharId) return items
    return items.filter((it) => String(it.conversations?.character_id || '') === activeCharId)
  }, [items, activeCharId])
  const lifeHubCards = useMemo(() => {
    const now = Date.now()
    return LIFE_EVENT_CONFIG.map((cfg) => {
      const scoped = focusItems.filter((it) => it.input_event === cfg.event)
      const latest = scoped[0] || null
      const recent24h = scoped.filter((it) => {
        const ts = Date.parse(String(it.created_at || ''))
        return Number.isFinite(ts) && now - ts <= ONE_DAY_MS
      }).length
      return {
        ...cfg,
        total: scoped.length,
        recent24h,
        latestAt: String(latest?.created_at || ''),
        latestPreview: compactPreview(String(latest?.content || ''), 92),
      }
    })
  }, [focusItems])

  const moveActivated = async (idx: number, direction: 'UP' | 'DOWN') => {
    if (idx < 0 || idx >= activated.length) return
    if (direction === 'UP' && idx === 0) return
    if (direction === 'DOWN' && idx >= activated.length - 1) return
    const target = direction === 'UP' ? idx - 1 : idx + 1
    const a = activated[idx]
    const b = activated[target]
    try {
      const ao = activationOrder(a)
      const bo = activationOrder(b)
      await updateCharacterSettings(a.id, { activated_order: bo || Date.now() })
      await updateCharacterSettings(b.id, { activated_order: ao || Date.now() + 1 })
      setActivated((prev) => prev.slice().sort((x, y) => activationOrder(x) - activationOrder(y)))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const hideCharacter = async (characterId: string) => {
    try {
      await updateCharacterSettings(characterId, { home_hidden: true })
      setActivated((prev) => prev.filter((x) => x.id !== characterId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deactivateCharacter = async (characterId: string) => {
    try {
      await updateCharacterSettings(characterId, { activated: false })
      setActivated((prev) => prev.filter((x) => x.id !== characterId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const eventTitle = (ev: string | null) => {
    if (ev === 'MOMENT_POST') return '朋友圈'
    if (ev === 'DIARY_DAILY') return '日记'
    if (ev === 'SCHEDULE_TICK') return '日程片段'
    return ev || '动态'
  }

  const eventBadgeStyle = (ev: string | null) => {
    if (ev === 'MOMENT_POST') return { borderColor: 'rgba(249,217,142,.44)', color: 'rgba(249,217,142,.98)', background: 'rgba(77,29,40,.72)' }
    if (ev === 'DIARY_DAILY') return { borderColor: 'rgba(208,176,103,.42)', color: 'rgba(249,217,142,.9)', background: 'rgba(54,54,54,.7)' }
    if (ev === 'SCHEDULE_TICK') return { borderColor: 'rgba(185,25,35,.45)', color: 'rgba(255,208,208,.94)', background: 'rgba(77,29,40,.58)' }
    return {}
  }

  const toggleReaction = (messageId: string, key: 'liked' | 'saved') => {
    let nextLiked = false
    let nextSaved = false
    setFeedReactions((prev) => {
      const curr = prev[messageId] || {}
      nextLiked = key === 'liked' ? !curr.liked : !!curr.liked
      nextSaved = key === 'saved' ? !curr.saved : !!curr.saved
      const next = { liked: nextLiked, saved: nextSaved }
      if (!next.liked && !next.saved) {
        const out = { ...prev }
        delete out[messageId]
        return out
      }
      return {
        ...prev,
        [messageId]: next,
      }
    })
    void (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (!token) return
        const out = await saveFeedReaction({ token, messageId, liked: nextLiked, saved: nextSaved })
        setFeedReactionTableReady(out.tableReady)
      } catch {
        // ignore: local cache remains the fallback
      }
    })()
  }

  const toggleCommentExpanded = (messageId: string) => {
    setCommentExpandedByMessageId((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const submitComment = async (messageId: string) => {
    const content = String(commentDraftByMessageId[messageId] || '').trim()
    if (!content || commentSavingMessageId) return
    setCommentSavingMessageId(messageId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) return
      const out = await createFeedComment({ token, messageId, content })
      setFeedCommentTableReady(out.tableReady)
      const comment = out.comment
      if (comment) {
        setFeedComments((prev) => mergeFeedCommentMap(prev, { [messageId]: [comment] }, 8))
        setCommentDraftByMessageId((prev) => ({ ...prev, [messageId]: '' }))
        setCommentExpandedByMessageId((prev) => ({ ...prev, [messageId]: true }))
      }
    } catch {
      // ignore
    } finally {
      setCommentSavingMessageId('')
    }
  }

  const removeComment = async (messageId: string, commentId: string) => {
    if (!commentId || commentDeletingId) return
    setCommentDeletingId(commentId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) return
      const out = await deleteFeedComment({ token, commentId })
      setFeedCommentTableReady(out.tableReady)
      setFeedComments((prev) => {
        const list = (prev[messageId] || []).filter((x) => x.id !== commentId)
        return { ...prev, [messageId]: list }
      })
    } catch {
      // ignore
    } finally {
      setCommentDeletingId('')
    }
  }

  return (
    <div className="uiPage">
      <AppShell
        title="首页"
        badge="feed"
        subtitle="已激活角色：朋友圈（每小时）/ 日记（每天）/ 日程片段（每小时）"
        actions={
          <>
            <button className="uiBtn uiBtnSecondary" onClick={() => setManage((v) => !v)}>
              {manage ? '完成' : '管理队列'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canLoad}>
              刷新
            </button>
          </>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">角色生活流</span>
            <h2 className="uiHeroTitle">首页聚合你已解锁角色的动态</h2>
            <p className="uiHeroSub">角色会按设定持续生成朋友圈、日记和日程片段。默认节律为每小时片段/朋友圈、每天一篇日记；你可以切换角色并过滤动态。</p>
            {!feedReactionTableReady ? <p className="uiHint">互动状态当前使用本地缓存（尚未启用 feed_reactions 数据表）。</p> : null}
            {!feedCommentTableReady ? <p className="uiHint">评论能力未启用（请执行 feed_comments 建表脚本）。</p> : null}
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{unlocked.length}</b>
              <span>已解锁角色</span>
            </div>
            <div className="uiKpi">
              <b>{activated.length}</b>
              <span>已激活角色</span>
            </div>
            <div className="uiKpi">
              <b>{digestStats.full}</b>
              <span>账本完整角色</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.total}</b>
              <span>动态总数</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.moments}</b>
              <span>朋友圈</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.diaries}</b>
              <span>日记</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.schedules}</b>
              <span>日程片段</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.liked}</b>
              <span>喜欢</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.saved}</b>
              <span>收藏</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.comments}</b>
              <span>评论</span>
            </div>
            <div className="uiKpi">
              <b>{digestStats.withRecentFeed}</b>
              <span>有动态记录角色</span>
            </div>
            <div className="uiKpi">
              <b>{digestStats.withConversation}</b>
              <span>已建会话角色</span>
            </div>
          </div>
        </section>

        <section className="uiHomeLifeHub">
          <div className="uiHomeLifeHubHead">
            <div>
              <h3 className="uiSectionTitle">生活中枢</h3>
              <p className="uiHint" style={{ marginTop: 6 }}>
                {selectedCharacter ? `当前焦点：${selectedCharacter.name}` : '当前焦点：全部角色'}。点击卡片可切换动态流类型。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className={`uiPill ${feedTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('ALL')}>
                查看全部
              </button>
              <button className="uiPill" onClick={() => setFeedQuery('')}>
                清空搜索
              </button>
            </div>
          </div>
          <div className="uiHomeLifeGrid">
            {lifeHubCards.map((card) => {
              const active = feedTab === card.tab
              return (
                <button
                  key={card.event}
                  className={`uiHomeLifeCard ${active ? 'uiHomeLifeCardActive' : ''}`}
                  onClick={() => {
                    setFeedTab(card.tab)
                    setFeedSort('NEWEST')
                    setLikedOnly(false)
                    setSavedOnly(false)
                  }}
                >
                  <div className="uiHomeLifeCardTop">
                    <span className="uiBadge" style={eventBadgeStyle(card.event)}>
                      {card.title}
                    </span>
                    <span className="uiHomeLifeCardCadence">{card.cadence}</span>
                  </div>
                  <div className="uiHomeLifeCardMain">
                    <b>{card.total}</b>
                    <span>累计动态</span>
                  </div>
                  <div className="uiHomeLifeCardMeta">24 小时内 {card.recent24h} 条</div>
                  <div className="uiHomeLifeCardMeta">
                    {card.latestAt ? `最近：${relativeTimeLabel(card.latestAt)}` : card.emptyHint}
                  </div>
                  {card.latestPreview ? <div className="uiHomeLifeCardPreview">{card.latestPreview}</div> : null}
                </button>
              )
            })}
          </div>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiHomeWorkspace">
            <div className="uiHomeCol">
              {selectedCharacter && selectedCharacterStats && (
                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">当前角色状态</div>
                      <div className="uiPanelSub">{selectedCharacter.name} 的动态活跃情况</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="uiBadge">动态总数: {selectedCharacterStats.total}</span>
                      <span className="uiBadge">朋友圈: {selectedCharacterStats.moment}</span>
                      <span className="uiBadge">日记: {selectedCharacterStats.diary}</span>
                      <span className="uiBadge">日程: {selectedCharacterStats.schedule}</span>
                      <span className="uiBadge">评论: {selectedCharacterStats.comments}</span>
                      <span className={`uiBadge ${selectedCharacterStats.ledgerComplete >= 4 ? 'uiBadgeHealthOk' : 'uiBadgeHealthWarn'}`}>
                        账本完整度: {selectedCharacterStats.ledgerComplete}/4
                      </span>
                    </div>
                    <div className="uiHint" style={{ marginTop: 0 }}>
                      最近更新时间：{selectedCharacterStats.latestAt ? new Date(selectedCharacterStats.latestAt).toLocaleString() : '暂无'}
                    </div>
                    {selectedCharacterStats.latestContent ? (
                      <div className="uiHint" style={{ marginTop: 0 }}>
                        最近动态：{selectedCharacterStats.latestContent.slice(0, 90)}
                        {selectedCharacterStats.latestContent.length > 90 ? '...' : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">角色队列</div>
                    <div className="uiPanelSub">{viewMode === 'ACTIVE' ? '当前只显示已激活角色' : '当前显示全部已解锁角色'}</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/square')}>
                      去广场解锁
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                      创建角色
                    </button>
                    <button className={`uiPill ${viewMode === 'ACTIVE' ? 'uiPillActive' : ''}`} onClick={() => setViewMode('ACTIVE')}>
                      仅看已激活
                    </button>
                    <button className={`uiPill ${viewMode === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setViewMode('UNLOCKED')}>
                      全部已解锁
                    </button>
                    <button className={`uiPill ${!activeCharId ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId('')}>
                      全部角色
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${roleSort === 'QUEUE' ? 'uiPillActive' : ''}`} onClick={() => setRoleSort('QUEUE')}>
                      排序：队列顺序
                    </button>
                    <button className={`uiPill ${roleSort === 'RECENT' ? 'uiPillActive' : ''}`} onClick={() => setRoleSort('RECENT')}>
                      排序：最近动态
                    </button>
                    <button className={`uiPill ${roleSort === 'LEDGER' ? 'uiPillActive' : ''}`} onClick={() => setRoleSort('LEDGER')}>
                      排序：账本完整
                    </button>
                  </div>

                  {visibleCharacters.length === 0 && (
                    <div className="uiEmpty" style={{ marginTop: 8 }}>
                      <div className="uiEmptyTitle">{viewMode === 'ACTIVE' ? '还没有激活角色' : '还没有已解锁角色'}</div>
                      <div className="uiEmptyDesc">去广场解锁一个公开角色，它会出现在这里并开始产生动态。</div>
                    </div>
                  )}

                  {sortedVisibleCharacters.length > 0 && (
                    <div className="uiRoleRail">
                      {sortedVisibleCharacters.slice(0, 40).map((c) => {
                        const digest = characterDigestById[c.id]
                        const status = activatedIdSet.has(c.id) ? '已激活' : '未激活'
                        const health = digest ? `${digest.complete}/4` : '0/4'
                        return (
                          <button key={c.id} className={`uiRoleRailItem ${activeCharId === c.id ? 'uiRoleRailItemActive' : ''}`} onClick={() => setActiveCharId(c.id)}>
                            <div className="uiRoleRailMedia">
                              {imgById[c.id] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={imgById[c.id]} alt="" />
                              ) : (
                                <span>{c.name.slice(0, 1)}</span>
                              )}
                            </div>
                            <div className="uiRoleRailBody">
                              <div className="uiRoleRailName">{c.name}</div>
                              <div className="uiRoleRailMeta">
                                {status} · 账本 {health}
                              </div>
                              <div className="uiRoleRailMeta">{digest?.latestAt ? `最近动态 ${relativeTimeLabel(digest.latestAt)}` : '暂无动态'}</div>
                            </div>
                            <div className="uiRoleRailActions">
                              <span
                                className={`uiBadge ${digest && digest.complete >= 4 ? 'uiBadgeHealthOk' : 'uiBadgeHealthWarn'}`}
                                title={
                                  digest
                                    ? `服装:${digest.outfit ? '✓' : '×'} 物品:${digest.inventory ? '✓' : '×'} NPC:${digest.npc ? '✓' : '×'} 高光:${digest.highlights ? '✓' : '×'}`
                                    : '服装:× 物品:× NPC:× 高光:×'
                                }
                              >
                                账本 {health}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="uiHomeCol">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">动态流</div>
                    <div className="uiPanelSub">{selectedCharacter ? `${selectedCharacter.name} 的动态` : '全部角色动态'}</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="uiInput"
                      style={{ maxWidth: 320 }}
                      placeholder="搜索动态内容..."
                      value={feedQuery}
                      onChange={(e) => setFeedQuery(e.target.value)}
                    />
                    <button className={`uiPill ${feedTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('ALL')}>
                      全部
                    </button>
                    <button className={`uiPill ${feedTab === 'MOMENT' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('MOMENT')}>
                      朋友圈
                    </button>
                    <button className={`uiPill ${feedTab === 'DIARY' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('DIARY')}>
                      日记
                    </button>
                    <button className={`uiPill ${feedTab === 'SCHEDULE' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('SCHEDULE')}>
                      日程
                    </button>
                    <button className={`uiPill ${likedOnly ? 'uiPillActive' : ''}`} onClick={() => setLikedOnly((v) => !v)}>
                      仅看喜欢
                    </button>
                    <button className={`uiPill ${savedOnly ? 'uiPillActive' : ''}`} onClick={() => setSavedOnly((v) => !v)}>
                      仅看收藏
                    </button>
                    <button className={`uiPill ${feedSort === 'NEWEST' ? 'uiPillActive' : ''}`} onClick={() => setFeedSort('NEWEST')}>
                      最新优先
                    </button>
                    <button className={`uiPill ${feedSort === 'LIKED_FIRST' ? 'uiPillActive' : ''}`} onClick={() => setFeedSort('LIKED_FIRST')}>
                      喜欢优先
                    </button>
                    <button className={`uiPill ${feedSort === 'SAVED_FIRST' ? 'uiPillActive' : ''}`} onClick={() => setFeedSort('SAVED_FIRST')}>
                      收藏优先
                    </button>
                    <button className={`uiPill ${feedSort === 'COMMENT_FIRST' ? 'uiPillActive' : ''}`} onClick={() => setFeedSort('COMMENT_FIRST')}>
                      评论优先
                    </button>
                    <button className={`uiPill ${feedSort === 'HOT_FIRST' ? 'uiPillActive' : ''}`} onClick={() => setFeedSort('HOT_FIRST')}>
                      热度优先
                    </button>
                  </div>

                  {filtered.length === 0 && (
                    <div className="uiEmpty" style={{ marginTop: 8 }}>
                      <div className="uiEmptyTitle">还没有动态</div>
                      <div className="uiEmptyDesc">去聊天，或等一会儿让角色自动发生活片段、写日记。</div>
                    </div>
                  )}

                  {filtered.length > 0 && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {filtered.map((it) => {
                        const comments = feedComments[it.id] || []
                        const commentsExpanded = !!commentExpandedByMessageId[it.id]
                        return (
                          <div key={it.id} className="uiPanel" style={{ marginTop: 0 }}>
                            <div className="uiPanelHeader">
                              <div>
                                <div className="uiPanelTitle">
                                  <span className="uiBadge" style={eventBadgeStyle(it.input_event)}>
                                    {eventTitle(it.input_event)}
                                  </span>
                                  {(() => {
                                    const cid = String(it.conversations?.character_id || '')
                                    const nm = cid && nameById[cid] ? nameById[cid] : ''
                                    return nm ? ` · ${nm}` : ''
                                  })()}
                                </div>
                                <div className="uiPanelSub">{new Date(it.created_at).toLocaleString()}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button
                                  className={`uiPill ${feedReactions[it.id]?.liked ? 'uiPillActive' : ''}`}
                                  onClick={() => toggleReaction(it.id, 'liked')}
                                >
                                  {feedReactions[it.id]?.liked ? '已喜欢' : '喜欢'}
                                </button>
                                <button
                                  className={`uiPill ${feedReactions[it.id]?.saved ? 'uiPillActive' : ''}`}
                                  onClick={() => toggleReaction(it.id, 'saved')}
                                >
                                  {feedReactions[it.id]?.saved ? '已收藏' : '收藏'}
                                </button>
                                <button className={`uiPill ${commentsExpanded ? 'uiPillActive' : ''}`} onClick={() => toggleCommentExpanded(it.id)}>
                                  评论 {comments.length}
                                </button>
                                <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${String(it.conversations?.character_id || '')}`)}>
                                  去聊天
                                </button>
                              </div>
                            </div>
                            <div className="uiForm">
                              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{it.content}</div>
                              {commentsExpanded && (
                                <div style={{ display: 'grid', gap: 10 }}>
                                  {!feedCommentTableReady ? (
                                    <div className="uiHint">评论功能未启用，请先执行 `schema_feed_comments.sql`。</div>
                                  ) : (
                                    <>
                                      <div style={{ display: 'grid', gap: 8 }}>
                                        {comments.length === 0 && <div className="uiHint">还没有评论。</div>}
                                        {comments.map((c) => (
                                          <div key={c.id} className="uiRow" style={{ alignItems: 'flex-start' }}>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{c.content}</div>
                                              <div className="uiHint" style={{ marginTop: 4 }}>
                                                {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                                              </div>
                                            </div>
                                            <button className="uiBtn uiBtnGhost" disabled={commentDeletingId === c.id} onClick={() => void removeComment(it.id, c.id)}>
                                              {commentDeletingId === c.id ? '删除中...' : '删除'}
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                      <div style={{ display: 'flex', gap: 10 }}>
                                        <input
                                          className="uiInput"
                                          placeholder="写一条评论（最多 300 字）"
                                          value={commentDraftByMessageId[it.id] || ''}
                                          onChange={(e) => setCommentDraftByMessageId((prev) => ({ ...prev, [it.id]: e.target.value.slice(0, 300) }))}
                                          onKeyDown={(e) => {
                                            if (e.key !== 'Enter') return
                                            e.preventDefault()
                                            void submitComment(it.id)
                                          }}
                                        />
                                        <button className="uiBtn uiBtnPrimary" disabled={commentSavingMessageId === it.id} onClick={() => void submitComment(it.id)}>
                                          {commentSavingMessageId === it.id ? '发送中...' : '发表评论'}
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {(feedHasMore || loadingMoreFeed) && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button className="uiBtn uiBtnGhost" onClick={() => void loadMoreFeed()} disabled={loadingMoreFeed}>
                        {loadingMoreFeed ? '加载更多中...' : '加载更多动态'}
                      </button>
                    </div>
                  )}
                  {!feedHasMore && !loadingMoreFeed && items.length > 0 && <div className="uiHint">已加载当前可见的全部动态。</div>}
                </div>
              </div>
            </div>

            <div className="uiHomeCol">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">生活入口</div>
                    <div className="uiPanelSub">按类型查看动态，快速进入聊天与角色中心</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button
                      className={`uiBtn ${feedTab === 'MOMENT' ? 'uiBtnPrimary' : 'uiBtnGhost'}`}
                      onClick={() => {
                        setFeedTab('MOMENT')
                        setFeedSort('NEWEST')
                      }}
                    >
                      看朋友圈
                    </button>
                    <button
                      className={`uiBtn ${feedTab === 'DIARY' ? 'uiBtnPrimary' : 'uiBtnGhost'}`}
                      onClick={() => {
                        setFeedTab('DIARY')
                        setFeedSort('NEWEST')
                      }}
                    >
                      看日记
                    </button>
                    <button
                      className={`uiBtn ${feedTab === 'SCHEDULE' ? 'uiBtnPrimary' : 'uiBtnGhost'}`}
                      onClick={() => {
                        setFeedTab('SCHEDULE')
                        setFeedSort('NEWEST')
                      }}
                    >
                      看日程片段
                    </button>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/characters')}>
                      管理角色
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/wardrobe')}>
                      衣柜资产中心
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
                      去广场
                    </button>
                    {selectedCharacter && (
                      <>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${selectedCharacter.id}`)}>
                          与 {selectedCharacter.name} 聊天
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${selectedCharacter.id}`)}>
                          打开 {selectedCharacter.name} 动态中心
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">激活队列</div>
                    <div className="uiPanelSub">排序影响首页展示顺序；隐藏/取消激活不会删除角色。</div>
                  </div>
                  <button className="uiBtn uiBtnGhost" onClick={() => setManage((v) => !v)}>
                    {manage ? '收起' : '展开管理'}
                  </button>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  {activated.length === 0 && <div className="uiHint">暂无已激活角色。</div>}
                  {activated.length > 0 && !manage && <div className="uiHint">已激活 {activated.length} 个角色，点击“展开管理”进行排序和下线。</div>}
                  {manage &&
                    activated.map((c, idx) => (
                      <div key={c.id} className="uiRow">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {idx + 1}. {c.name}
                          </div>
                          <div className="uiHint" style={{ marginTop: 4 }}>
                            {c.id.slice(0, 8)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="uiBtn uiBtnGhost" disabled={idx === 0} onClick={() => void moveActivated(idx, 'UP')}>
                            上移
                          </button>
                          <button className="uiBtn uiBtnGhost" disabled={idx === activated.length - 1} onClick={() => void moveActivated(idx, 'DOWN')}>
                            下移
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => void hideCharacter(c.id)}>
                            隐藏
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => void deactivateCharacter(c.id)}>
                            取消激活
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
