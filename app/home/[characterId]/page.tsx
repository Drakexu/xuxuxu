'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { fetchFeedReactions, mergeFeedReactionMap, saveFeedReaction, type FeedReactionMap } from '@/lib/feedReactions'
import {
  createFeedComment,
  deleteFeedComment,
  fetchFeedComments,
  mergeFeedCommentMap,
  type FeedCommentMap,
} from '@/lib/feedComments'
import AppShell from '@/app/_components/AppShell'

type FeedItem = {
  id: string
  created_at: string
  input_event: string | null
  content: string
  conversation_id: string
}

type FeedTab = 'ALL' | 'MOMENT' | 'DIARY' | 'SCHEDULE'
type FeedSort = 'NEWEST' | 'LIKED_FIRST' | 'SAVED_FIRST' | 'COMMENT_FIRST' | 'HOT_FIRST'
const CHARACTER_FEED_PAGE_SIZE = 120
const CHARACTER_FEED_LIVE_POLL_MS = 60 * 1000
const HOURLY_MS = 60 * 60 * 1000
const DAILY_MS = 24 * HOURLY_MS
const CADENCE_CONFIG = [
  { event: 'MOMENT_POST', label: '朋友圈', expectedMs: HOURLY_MS },
  { event: 'SCHEDULE_TICK', label: '日程片段', expectedMs: HOURLY_MS },
  { event: 'DIARY_DAILY', label: '日记', expectedMs: DAILY_MS },
] as const
type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type ConversationRow = { id: string; created_at?: string | null; state?: unknown }
type RelationshipStage = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7'
type RomanceMode = 'ROMANCE_ON' | 'ROMANCE_OFF'
type PlotGranularity = 'LINE' | 'BEAT' | 'SCENE'
type EndingMode = 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED'

type LedgerSnapshot = {
  outfit: string
  inventory: Array<{ name: string; count?: number }>
  npcs: string[]
  highlights: string[]
  events: string[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function pickAssetPath(rows: CharacterAssetRow[]) {
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

function eventTitle(ev: string | null) {
  if (ev === 'MOMENT_POST') return '朋友圈'
  if (ev === 'DIARY_DAILY') return '日记'
  if (ev === 'SCHEDULE_TICK') return '日程片段'
  return ev || '动态'
}

function eventBadgeStyle(ev: string | null) {
  if (ev === 'MOMENT_POST') return { borderColor: 'rgba(249,217,142,.44)', color: 'rgba(249,217,142,.98)', background: 'rgba(77,29,40,.72)' }
  if (ev === 'DIARY_DAILY') return { borderColor: 'rgba(208,176,103,.42)', color: 'rgba(249,217,142,.9)', background: 'rgba(54,54,54,.7)' }
  if (ev === 'SCHEDULE_TICK') return { borderColor: 'rgba(185,25,35,.45)', color: 'rgba(255,208,208,.94)', background: 'rgba(77,29,40,.58)' }
  return {}
}

function normalizeStage(v: unknown): RelationshipStage {
  const s = String(v || '').trim().toUpperCase()
  return (['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].includes(s) ? s : 'S1') as RelationshipStage
}

function normalizeRomance(v: unknown): RomanceMode {
  const s = String(v || '').trim().toUpperCase()
  return (s === 'ROMANCE_OFF' ? 'ROMANCE_OFF' : 'ROMANCE_ON') as RomanceMode
}

function normalizeSchedule(v: unknown): 'PLAY' | 'PAUSE' {
  return String(v || '').trim().toUpperCase() === 'PAUSE' ? 'PAUSE' : 'PLAY'
}

function normalizePlotGranularity(v: unknown): PlotGranularity {
  const s = String(v || '').trim().toUpperCase()
  return (s === 'LINE' || s === 'SCENE' || s === 'BEAT' ? s : 'BEAT') as PlotGranularity
}

function normalizeEndingMode(v: unknown): EndingMode {
  const s = String(v || '').trim().toUpperCase()
  return (s === 'QUESTION' || s === 'ACTION' || s === 'CLIFF' || s === 'MIXED' ? s : 'MIXED') as EndingMode
}

function formatAgo(iso: string) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return '无数据'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return `${d} 天前`
}

function formatDelay(ms: number) {
  if (ms <= 0) return '按节奏'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `延迟 ${m} 分钟`
  const h = Math.floor(m / 60)
  if (h < 24) return `延迟 ${h} 小时`
  const d = Math.floor(h / 24)
  return `延迟 ${d} 天`
}

export default function CharacterHomePage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
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
  const [feedCursor, setFeedCursor] = useState('')
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [loadingMoreFeed, setLoadingMoreFeed] = useState(false)
  const [feedReactionTableReady, setFeedReactionTableReady] = useState(true)
  const [feedCommentTableReady, setFeedCommentTableReady] = useState(true)
  const [feedLiveRefresh, setFeedLiveRefresh] = useState(true)
  const [feedLiveSyncAt, setFeedLiveSyncAt] = useState('')
  const latestFeedAtRef = useRef('')
  const [coverUrl, setCoverUrl] = useState('')
  const [assetUrls, setAssetUrls] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null)
  const [latestConversationId, setLatestConversationId] = useState('')
  const [teenMode, setTeenMode] = useState(false)
  const [scheduleState, setScheduleState] = useState<'PLAY' | 'PAUSE'>('PLAY')
  const [lockMode, setLockMode] = useState('manual')
  const [storyLockUntil, setStoryLockUntil] = useState('')
  const [relationshipStage, setRelationshipStage] = useState<RelationshipStage>('S1')
  const [romanceMode, setRomanceMode] = useState<RomanceMode>('ROMANCE_ON')
  const [plotGranularity, setPlotGranularity] = useState<PlotGranularity>('BEAT')
  const [endingMode, setEndingMode] = useState<EndingMode>('MIXED')
  const [endingRepeatWindow, setEndingRepeatWindow] = useState(6)
  const [updatingSchedule, setUpdatingSchedule] = useState(false)
  const [updatingRelationship, setUpdatingRelationship] = useState(false)
  const [updatingPromptPolicy, setUpdatingPromptPolicy] = useState(false)
  const [triggeringScheduleSnippet, setTriggeringScheduleSnippet] = useState(false)
  const feedReactionStorageKey = useMemo(() => `xuxuxu:feed:reactions:v1:${characterId}`, [characterId])
  const feedLiveStorageKey = useMemo(() => `xuxuxu:feed:live_refresh:v1:${characterId}`, [characterId])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(feedReactionStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as FeedReactionMap
      if (parsed && typeof parsed === 'object') setFeedReactions(parsed)
    } catch {
      // ignore corrupted local cache
    }
  }, [feedReactionStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(feedReactionStorageKey, JSON.stringify(feedReactions))
    } catch {
      // ignore quota/private mode errors
    }
  }, [feedReactionStorageKey, feedReactions])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(feedLiveStorageKey)
      if (!raw) return
      const normalized = raw.trim().toLowerCase()
      if (normalized === '0' || normalized === 'false' || normalized === 'off') setFeedLiveRefresh(false)
      else if (normalized === '1' || normalized === 'true' || normalized === 'on') setFeedLiveRefresh(true)
    } catch {
      // ignore
    }
  }, [feedLiveStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(feedLiveStorageKey, feedLiveRefresh ? '1' : '0')
    } catch {
      // ignore
    }
  }, [feedLiveStorageKey, feedLiveRefresh])

  useEffect(() => {
    let newest = ''
    let newestTs = 0
    for (const it of items) {
      const ts = Date.parse(String(it.created_at || ''))
      if (!Number.isFinite(ts)) continue
      if (ts > newestTs) {
        newestTs = ts
        newest = String(it.created_at || '')
      }
    }
    latestFeedAtRef.current = newest
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

  const applyControlState = (state: unknown, forceTeen = false) => {
    const root = asRecord(state)
    const run = asRecord(root.run_state)
    const board = asRecord(root.schedule_board)
    const style = asRecord(root.style_guard)
    const ageMode = String(run.age_mode || '').trim().toLowerCase()
    const nextTeenMode = forceTeen || ageMode === 'teen'

    setTeenMode(nextTeenMode)
    setScheduleState(normalizeSchedule(board.schedule_state || run.schedule_state))
    setLockMode(String(board.lock_mode || 'manual'))
    setStoryLockUntil(typeof board.story_lock_until === 'string' ? board.story_lock_until : '')
    setRelationshipStage(normalizeStage(run.relationship_stage))
    setRomanceMode(nextTeenMode ? 'ROMANCE_OFF' : normalizeRomance(run.romance_mode))
    setPlotGranularity(normalizePlotGranularity(run.plot_granularity))
    setEndingMode(normalizeEndingMode(run.ending_mode))
    const winRaw = Number(style.ending_repeat_window ?? 6)
    const win = Number.isFinite(winRaw) ? Math.max(3, Math.min(Math.floor(winRaw), 12)) : 6
    setEndingRepeatWindow(win)
  }

  const getAccessToken = async () => {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) throw new Error('登录态失效，请重新登录。')
    return token
  }

  const updateScheduleControl = async (action: 'PLAY' | 'PAUSE' | 'LOCK' | 'UNLOCK', lockMinutes?: number) => {
    if (!latestConversationId || updatingSchedule) return
    setUpdatingSchedule(true)
    setError('')
    try {
      const token = await getAccessToken()
      const payload: Record<string, unknown> = { conversationId: latestConversationId, action }
      if (action === 'LOCK') {
        payload.lockMinutes = Number(lockMinutes ?? 120)
        payload.reason = 'story_lock'
      }

      const resp = await fetch('/api/state/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) throw new Error(String(data.error || `请求失败：${resp.status}`))

      setScheduleState(normalizeSchedule(data.scheduleState))
      setLockMode(String(data.lockMode || 'manual'))
      setStoryLockUntil(String(data.storyLockUntil || ''))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingSchedule(false)
    }
  }

  const updateRelationshipControl = async (args: { stage?: RelationshipStage; romance?: RomanceMode }) => {
    if (!latestConversationId || updatingRelationship) return
    if (!args.stage && !args.romance) return
    setUpdatingRelationship(true)
    setError('')
    try {
      const token = await getAccessToken()
      const payload: Record<string, unknown> = {
        conversationId: latestConversationId,
        persistToCharacter: true,
      }
      if (args.stage) payload.relationshipStage = args.stage
      if (args.romance) payload.romanceMode = args.romance

      const resp = await fetch('/api/state/relationship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) throw new Error(String(data.error || `请求失败：${resp.status}`))

      if (data.relationshipStage) setRelationshipStage(normalizeStage(data.relationshipStage))
      if (data.romanceMode) setRomanceMode(teenMode ? 'ROMANCE_OFF' : normalizeRomance(data.romanceMode))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingRelationship(false)
    }
  }

  const updatePromptPolicyControl = async () => {
    if (!latestConversationId || updatingPromptPolicy) return
    setUpdatingPromptPolicy(true)
    setError('')
    try {
      const token = await getAccessToken()
      const nextEndingsPrefer =
        endingMode === 'QUESTION'
          ? ['Q', 'A', 'B']
          : endingMode === 'ACTION'
            ? ['A', 'B', 'S']
            : endingMode === 'CLIFF'
              ? ['S', 'A', 'B']
              : ['A', 'B', 'S']

      const resp = await fetch('/api/state/prompt-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          conversationId: latestConversationId,
          plotGranularity,
          endingMode,
          endingRepeatWindow,
          nextEndingsPrefer,
          persistToCharacter: true,
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) throw new Error(String(data.error || `请求失败：${resp.status}`))

      setPlotGranularity(normalizePlotGranularity(data.plotGranularity))
      setEndingMode(normalizeEndingMode(data.endingMode))
      const winRaw = Number(data.endingRepeatWindow ?? 6)
      setEndingRepeatWindow(Number.isFinite(winRaw) ? Math.max(3, Math.min(Math.floor(winRaw), 12)) : 6)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingPromptPolicy(false)
    }
  }

  const load = async () => {
    setLoading(true)
    setError('')
    setAssetUrls([])
    setCoverUrl('')
    setSnapshot(null)
    setItems([])
    setFeedCursor('')
    setFeedHasMore(false)
    setLoadingMoreFeed(false)
    setFeedComments({})
    setCommentDraftByMessageId({})
    setCommentExpandedByMessageId({})
    setCommentSavingMessageId('')
    setCommentDeletingId('')
    setLatestConversationId('')
    setScheduleState('PLAY')
    setLockMode('manual')
    setStoryLockUntil('')
    setRelationshipStage('S1')
    setPlotGranularity('BEAT')
    setEndingMode('MIXED')
    setEndingRepeatWindow(6)
    setTeenMode(false)
    setRomanceMode('ROMANCE_ON')

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const c = await supabase.from('characters').select('id,name,settings').eq('id', characterId).eq('user_id', userId).maybeSingle()
    if (c.error || !c.data) {
      setError('角色不存在或无权限')
      setLoading(false)
      return
    }
    const characterData = c.data as { name?: string; settings?: unknown }
    const settings = asRecord(characterData.settings)
    const settingsAgeMode = String(settings.age_mode || '').trim().toLowerCase()
    const settingsTeenMode = settings.teen_mode === true || settingsAgeMode === 'teen'
    setTeenMode(settingsTeenMode)
    setRomanceMode(settingsTeenMode ? 'ROMANCE_OFF' : 'ROMANCE_ON')
    setTitle(characterData.name || '角色')

    const rFeed = await supabase
      .from('messages')
      .select('id,created_at,input_event,content,conversation_id')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
      .order('created_at', { ascending: false })
      .limit(CHARACTER_FEED_PAGE_SIZE)
    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
    } else {
      const rows = (rFeed.data ?? []) as FeedItem[]
      setItems(rows)
      setFeedCursor(rows.length ? String(rows[rows.length - 1]?.created_at || '') : '')
      setFeedHasMore(rows.length >= CHARACTER_FEED_PAGE_SIZE)
    }

    const rConv = await supabase
      .from('conversations')
      .select('id,created_at')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const convId = (rConv.data as ConversationRow | null)?.id || ''
    setLatestConversationId(convId)
    if (convId) {
      const st = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (!st.error && st.data?.state) {
        const root = asRecord(st.data.state)
        applyControlState(st.data.state, settingsTeenMode)
        const ledger = asRecord(root.ledger)
        const wardrobe = asRecord(ledger.wardrobe)
        const memory = asRecord(root.memory)

        const inv = asArray(ledger.inventory)
          .slice(0, 20)
          .map((x) => {
            const r = asRecord(x)
            const name = String(r.name ?? r.item ?? '').trim()
            const countRaw = Number(r.count ?? r.qty)
            return { name, count: Number.isFinite(countRaw) ? countRaw : undefined }
          })
          .filter((x) => !!x.name)

        const npcs = asArray(ledger.npc_database)
          .slice(0, 24)
          .map((x) => {
            const r = asRecord(x)
            return String(r.name ?? r.npc ?? '').trim()
          })
          .filter(Boolean)

        const events = asArray(ledger.event_log)
          .slice(-20)
          .map((x) => {
            if (typeof x === 'string') return x.trim()
            const r = asRecord(x)
            return String(r.content ?? '').trim()
          })
          .filter(Boolean)

        const highlights = asArray(memory.highlights)
          .slice(-16)
          .map((x) => {
            const r = asRecord(x)
            return String(r.item ?? r.text ?? '').trim()
          })
          .filter(Boolean)

        setSnapshot({
          outfit: String(wardrobe.current_outfit ?? '').trim(),
          inventory: inv,
          npcs,
          highlights,
          events,
        })
      }
    }

    try {
      const assets = await supabase
        .from('character_assets')
        .select('character_id,kind,storage_path,created_at')
        .eq('character_id', characterId)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(36)

      if (!assets.error && (assets.data ?? []).length) {
        const rows = (assets.data ?? []) as CharacterAssetRow[]
        const uniquePaths = new Set<string>()
        const picks = rows
          .filter((r) => !!r.storage_path)
          .filter((r) => {
            if (uniquePaths.has(r.storage_path)) return false
            uniquePaths.add(r.storage_path)
            return true
          })
          .slice(0, 10)

        const signed = await Promise.all(
          picks.map(async (r) => {
            const s = await supabase.storage.from('character-assets').createSignedUrl(r.storage_path, 60 * 60)
            return { kind: r.kind, path: r.storage_path, url: s.data?.signedUrl || '' }
          }),
        )

        const filtered = signed.filter((x) => !!x.url)
        setAssetUrls(filtered)
        const coverPath = pickAssetPath(rows)
        const coverPick = filtered.find((x) => x.path === coverPath) || filtered[0]
        if (coverPick?.url) setCoverUrl(coverPick.url)
      }
    } catch {
      // ignore assets
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, characterId])

  useEffect(() => {
    if (loading || !feedLiveRefresh) return
    let canceled = false
    const poll = async () => {
      if (canceled || loading || loadingMoreFeed) return
      try {
        const { data: userData } = await supabase.auth.getUser()
        const userId = userData.user?.id
        if (!userId) return
        const since = latestFeedAtRef.current || new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        const rFeed = await supabase
          .from('messages')
          .select('id,created_at,input_event,content,conversation_id')
          .eq('user_id', userId)
          .eq('character_id', characterId)
          .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
          .gt('created_at', since)
          .order('created_at', { ascending: true })
          .limit(200)
        if (rFeed.error) return
        const rows = (rFeed.data ?? []) as FeedItem[]
        if (!rows.length) {
          setFeedLiveSyncAt(new Date().toISOString())
          return
        }
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          const merged = [...rows.filter((x) => !seen.has(x.id)), ...prev]
          merged.sort((a, b) => (Date.parse(String(b.created_at || '')) || 0) - (Date.parse(String(a.created_at || '')) || 0))
          return merged.slice(0, 400)
        })
        setFeedLiveSyncAt(new Date().toISOString())
      } catch {
        // ignore polling errors
      }
    }
    const timer = setInterval(() => {
      void poll()
    }, CHARACTER_FEED_LIVE_POLL_MS)
    void poll()
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [loading, loadingMoreFeed, characterId, feedLiveRefresh])

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

      const rFeed = await supabase
        .from('messages')
        .select('id,created_at,input_event,content,conversation_id')
        .eq('user_id', userId)
        .eq('character_id', characterId)
        .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
        .lt('created_at', feedCursor)
        .order('created_at', { ascending: false })
        .limit(CHARACTER_FEED_PAGE_SIZE)

      if (rFeed.error) {
        setError(rFeed.error.message || '加载更多动态失败')
        return
      }

      const rows = (rFeed.data ?? []) as FeedItem[]
      if (rows.length) {
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          const merged = [...prev]
          for (const row of rows) {
            if (seen.has(row.id)) continue
            merged.push(row)
          }
          return merged
        })
      }
      setFeedCursor(rows.length ? String(rows[rows.length - 1]?.created_at || '') : '')
      if (rows.length < CHARACTER_FEED_PAGE_SIZE) setFeedHasMore(false)
    } finally {
      setLoadingMoreFeed(false)
    }
  }

  const filtered = useMemo(() => {
    let next = items
    if (feedTab === 'MOMENT') next = next.filter((x) => x.input_event === 'MOMENT_POST')
    else if (feedTab === 'DIARY') next = next.filter((x) => x.input_event === 'DIARY_DAILY')
    else if (feedTab === 'SCHEDULE') next = next.filter((x) => x.input_event === 'SCHEDULE_TICK')
    const q = feedQuery.trim().toLowerCase()
    if (q) next = next.filter((x) => (x.content || '').toLowerCase().includes(q))
    if (likedOnly) next = next.filter((x) => !!feedReactions[x.id]?.liked)
    if (savedOnly) next = next.filter((x) => !!feedReactions[x.id]?.saved)
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
  }, [items, feedTab, feedQuery, feedSort, likedOnly, savedOnly, feedReactions, feedComments])

  const stats = useMemo(() => {
    const moment = items.filter((x) => x.input_event === 'MOMENT_POST').length
    const diary = items.filter((x) => x.input_event === 'DIARY_DAILY').length
    const schedule = items.filter((x) => x.input_event === 'SCHEDULE_TICK').length
    const liked = items.filter((x) => !!feedReactions[x.id]?.liked).length
    const saved = items.filter((x) => !!feedReactions[x.id]?.saved).length
    const comments = Object.values(feedComments).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
    return { moment, diary, schedule, liked, saved, comments, total: items.length }
  }, [items, feedReactions, feedComments])

  const cadence = useMemo(() => {
    const now = Date.now()
    return CADENCE_CONFIG.map((cfg) => {
      let latestIso = ''
      let latestTs = 0
      for (const it of items) {
        if (it.input_event !== cfg.event) continue
        const ts = Date.parse(String(it.created_at || ''))
        if (!Number.isFinite(ts)) continue
        if (ts > latestTs) {
          latestTs = ts
          latestIso = String(it.created_at || '')
        }
      }
      if (!latestTs) {
        return {
          ...cfg,
          hasData: false,
          latestIso: '',
          latestLabel: '无数据',
          status: 'missing' as const,
          delayMs: cfg.expectedMs,
          delayLabel: '等待首条',
        }
      }
      const graceMs = Math.min(Math.floor(cfg.expectedMs * 0.2), 2 * HOURLY_MS)
      const dueAt = latestTs + cfg.expectedMs + graceMs
      const delayMs = Math.max(0, now - dueAt)
      const isLate = delayMs > 0
      return {
        ...cfg,
        hasData: true,
        latestIso,
        latestLabel: formatAgo(latestIso),
        status: isLate ? ('late' as const) : ('ok' as const),
        delayMs,
        delayLabel: isLate ? formatDelay(delayMs) : '按节奏',
      }
    })
  }, [items])

  const ledgerHealth = useMemo(() => {
    if (!snapshot) {
      return [
        { key: 'wardrobe', label: '服装', ok: false },
        { key: 'inventory', label: '物品', ok: false },
        { key: 'npc', label: 'NPC', ok: false },
        { key: 'highlights', label: '高光事件', ok: false },
        { key: 'events', label: '事件日志', ok: false },
      ]
    }
    return [
      { key: 'wardrobe', label: '服装', ok: !!snapshot.outfit },
      { key: 'inventory', label: '物品', ok: snapshot.inventory.length > 0 },
      { key: 'npc', label: 'NPC', ok: snapshot.npcs.length > 0 },
      { key: 'highlights', label: '高光事件', ok: snapshot.highlights.length > 0 },
      { key: 'events', label: '事件日志', ok: snapshot.events.length > 0 },
    ]
  }, [snapshot])
  const ledgerHealthSummary = useMemo(() => {
    const ok = ledgerHealth.filter((x) => x.ok).length
    return { ok, total: ledgerHealth.length }
  }, [ledgerHealth])

  const storyLockLabel = useMemo(() => {
    if (!storyLockUntil) return ''
    const t = Date.parse(storyLockUntil)
    if (!Number.isFinite(t)) return ''
    const mins = Math.ceil((t - Date.now()) / 60000)
    if (mins <= 0) return '已到期'
    if (mins < 60) return `${mins} 分钟后解锁`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}小时${m ? `${m}分钟` : ''}后解锁`
  }, [storyLockUntil])

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

  const triggerScheduleNow = async () => {
    if (!latestConversationId || triggeringScheduleSnippet) return
    setTriggeringScheduleSnippet(true)
    setError('')
    try {
      const token = await getAccessToken()
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          characterId,
          conversationId: latestConversationId,
          message: '(schedule_tick)',
          inputEvent: 'SCHEDULE_TICK',
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) throw new Error(String(data.error || `请求失败：${resp.status}`))
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTriggeringScheduleSnippet(false)
    }
  }

  return (
    <div className="uiPage">
      <AppShell
        title={title ? `${title} · 动态中心` : '角色动态中心'}
        badge="life"
        subtitle="角色朋友圈（每小时）/ 日记（每天）/ 日程片段（每小时） + 账本快照 + 视觉资产"
        actions={
          <>
            <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/chat/${characterId}`)}>
              聊天
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/${characterId}/assets`)}>
              资产页
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={loading}>
              刷新
            </button>
          </>
        }
      >
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div style={{ display: 'grid', gap: 14 }}>
            <section className="uiHero">
              <div>
                <span className="uiBadge">角色专属视图</span>
                <h2 className="uiHeroTitle">{title || '该角色'}的生活与记忆控制台</h2>
                <p className="uiHeroSub">这里聚合这名角色的朋友圈、日记、日程片段，并展示账本快照和资产预览，便于检查角色是否持续“活着”。</p>
                {!feedReactionTableReady ? <p className="uiHint">互动状态当前使用本地缓存（尚未启用 feed_reactions 数据表）。</p> : null}
                {!feedCommentTableReady ? <p className="uiHint">评论能力未启用（请执行 feed_comments 建表脚本）。</p> : null}
              </div>
              <div className="uiKpiGrid">
                <div className="uiKpi">
                  <b>{stats.total}</b>
                  <span>动态总数</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.moment}</b>
                  <span>朋友圈</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.diary}</b>
                  <span>日记</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.schedule}</b>
                  <span>日程片段</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.liked}</b>
                  <span>喜欢</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.saved}</b>
                  <span>收藏</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.comments}</b>
                  <span>评论</span>
                </div>
                <div className="uiKpi">
                  <b>
                    {ledgerHealthSummary.ok}/{ledgerHealthSummary.total}
                  </b>
                  <span>账本完整度</span>
                </div>
                <div className="uiKpi">
                  <b>{assetUrls.length}</b>
                  <span>可预览资产</span>
                </div>
              </div>
            </section>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">生活节奏监控</div>
                  <div className="uiPanelSub">检查朋友圈/日程是否每小时更新、日记是否每日更新</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="uiBtn uiBtnGhost" disabled={!latestConversationId || triggeringScheduleSnippet} onClick={() => void triggerScheduleNow()}>
                    {triggeringScheduleSnippet ? '触发中...' : '补一条日程片段'}
                  </button>
                </div>
              </div>
              <div className="uiForm">
                <div className="uiKpiGrid">
                  {cadence.map((c) => {
                    const tone =
                      c.status === 'ok'
                        ? { borderColor: 'rgba(126,211,147,.35)', background: 'rgba(33,56,38,.58)', color: 'rgba(203,251,214,.95)' }
                        : c.status === 'late'
                          ? { borderColor: 'rgba(255,164,122,.4)', background: 'rgba(64,38,28,.62)', color: 'rgba(255,226,205,.95)' }
                          : { borderColor: 'rgba(255,120,120,.4)', background: 'rgba(64,26,26,.64)', color: 'rgba(255,215,215,.95)' }
                    return (
                      <div key={c.event} className="uiKpi" style={tone}>
                        <b>{c.label}</b>
                        <span>最近：{c.latestLabel}</span>
                        <span>{c.delayLabel}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">运行态控制台</div>
                  <div className="uiPanelSub">在主页直接调整日程、关系阶段、恋爱模式与叙事策略</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="uiBadge">会话：{latestConversationId ? `${latestConversationId.slice(0, 8)}...` : '未创建'}</span>
                  <span className="uiBadge">日程：{scheduleState === 'PAUSE' ? '暂停' : '运行中'}</span>
                  <span className="uiBadge">锁模式：{lockMode || 'manual'}</span>
                  <span className="uiBadge">关系阶段：{relationshipStage}</span>
                  <span className="uiBadge">恋爱：{romanceMode === 'ROMANCE_OFF' ? '关闭' : '开启'}</span>
                  <span className="uiBadge">剧情颗粒度：{plotGranularity}</span>
                  <span className="uiBadge">结尾策略：{endingMode}/{endingRepeatWindow}</span>
                  {!!storyLockUntil && <span className="uiBadge">剧情锁：{storyLockLabel || storyLockUntil}</span>}
                </div>

                {!latestConversationId && (
                  <div className="uiHint">
                    还没有会话，先进入聊天页创建一条会话后即可在这里控制运行态。
                  </div>
                )}

                {latestConversationId && (
                  <>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button className="uiBtn uiBtnGhost" disabled={updatingSchedule} onClick={() => updateScheduleControl('PLAY')}>
                        恢复日程
                      </button>
                      <button className="uiBtn uiBtnGhost" disabled={updatingSchedule} onClick={() => updateScheduleControl('PAUSE')}>
                        暂停日程
                      </button>
                      <button className="uiBtn uiBtnGhost" disabled={updatingSchedule} onClick={() => updateScheduleControl('LOCK', 120)}>
                        锁剧情 2h
                      </button>
                      <button className="uiBtn uiBtnGhost" disabled={updatingSchedule} onClick={() => updateScheduleControl('UNLOCK')}>
                        解锁剧情
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="uiInput"
                        style={{ width: 150 }}
                        value={relationshipStage}
                        disabled={updatingRelationship}
                        onChange={(e) => {
                          const next = normalizeStage(e.target.value)
                          setRelationshipStage(next)
                          void updateRelationshipControl({ stage: next })
                        }}
                      >
                        {['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].map((s) => (
                          <option key={s} value={s}>
                            阶段 {s}
                          </option>
                        ))}
                      </select>
                      <button
                        className="uiBtn uiBtnGhost"
                        disabled={updatingRelationship || teenMode}
                        onClick={() => {
                          const next = romanceMode === 'ROMANCE_OFF' ? 'ROMANCE_ON' : 'ROMANCE_OFF'
                          setRomanceMode(next)
                          void updateRelationshipControl({ romance: next })
                        }}
                      >
                        {teenMode ? '青少年模式：恋爱固定关闭' : romanceMode === 'ROMANCE_OFF' ? '开启恋爱模式' : '关闭恋爱模式'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select className="uiInput" style={{ width: 170 }} value={plotGranularity} onChange={(e) => setPlotGranularity(normalizePlotGranularity(e.target.value))}>
                        <option value="LINE">剧情颗粒度 LINE</option>
                        <option value="BEAT">剧情颗粒度 BEAT</option>
                        <option value="SCENE">剧情颗粒度 SCENE</option>
                      </select>
                      <select className="uiInput" style={{ width: 180 }} value={endingMode} onChange={(e) => setEndingMode(normalizeEndingMode(e.target.value))}>
                        <option value="MIXED">结尾策略 MIXED</option>
                        <option value="QUESTION">结尾策略 QUESTION</option>
                        <option value="ACTION">结尾策略 ACTION</option>
                        <option value="CLIFF">结尾策略 CLIFF</option>
                      </select>
                      <select
                        className="uiInput"
                        style={{ width: 170 }}
                        value={String(endingRepeatWindow)}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setEndingRepeatWindow(Number.isFinite(n) ? Math.max(3, Math.min(Math.floor(n), 12)) : 6)
                        }}
                      >
                        <option value="4">防复读窗口 4</option>
                        <option value="6">防复读窗口 6</option>
                        <option value="8">防复读窗口 8</option>
                        <option value="10">防复读窗口 10</option>
                        <option value="12">防复读窗口 12</option>
                      </select>
                      <button className="uiBtn uiBtnGhost" disabled={updatingPromptPolicy} onClick={updatePromptPolicyControl}>
                        {updatingPromptPolicy ? '保存中...' : '保存叙事策略'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">动态流</div>
                  <div className="uiPanelSub">按类型查看角色自动发布内容</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="uiInput"
                    style={{ maxWidth: 360 }}
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
                  <button className={`uiPill ${feedLiveRefresh ? 'uiPillActive' : ''}`} onClick={() => setFeedLiveRefresh((v) => !v)}>
                    自动刷新 {feedLiveRefresh ? '开' : '关'}
                  </button>
                </div>
                {feedLiveRefresh ? <div className="uiHint">自动刷新中（每分钟检查一次）{feedLiveSyncAt ? ` · 最近同步 ${new Date(feedLiveSyncAt).toLocaleTimeString()}` : ''}</div> : null}

                {filtered.length === 0 && (
                  <div className="uiEmpty" style={{ marginTop: 0 }}>
                    <div className="uiEmptyTitle">暂无动态</div>
                    <div className="uiEmptyDesc">可以先聊天，或等待定时任务产生日程和日记。</div>
                  </div>
                )}

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
                          </div>
                          <div className="uiPanelSub">{new Date(it.created_at).toLocaleString()}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button className={`uiPill ${feedReactions[it.id]?.liked ? 'uiPillActive' : ''}`} onClick={() => toggleReaction(it.id, 'liked')}>
                            {feedReactions[it.id]?.liked ? '已喜欢' : '喜欢'}
                          </button>
                          <button className={`uiPill ${feedReactions[it.id]?.saved ? 'uiPillActive' : ''}`} onClick={() => toggleReaction(it.id, 'saved')}>
                            {feedReactions[it.id]?.saved ? '已收藏' : '收藏'}
                          </button>
                          <button className={`uiPill ${commentsExpanded ? 'uiPillActive' : ''}`} onClick={() => toggleCommentExpanded(it.id)}>
                            评论 {comments.length}
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${characterId}`)}>
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

                {(feedHasMore || loadingMoreFeed) && (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button className="uiBtn uiBtnGhost" onClick={() => void loadMoreFeed()} disabled={loadingMoreFeed}>
                      {loadingMoreFeed ? '加载更多中...' : '加载更多动态'}
                    </button>
                  </div>
                )}
                {!feedHasMore && !loadingMoreFeed && items.length > 0 && <div className="uiHint">已加载当前角色的全部动态。</div>}
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">账本完整性</div>
                  <div className="uiPanelSub">检查 NPC / 物品 / 服装 / 高光事件 / 日志 是否已进入快照</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ledgerHealth.map((h) => (
                    <span key={h.key} className={`uiBadge ${h.ok ? 'uiBadgeHealthOk' : 'uiBadgeHealthWarn'}`}>
                      {h.label}: {h.ok ? '完整' : '缺失'}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">衣柜与账本快照</div>
                  <div className="uiPanelSub">来自最近会话状态（conversation_states）</div>
                </div>
                <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/${characterId}/assets`)}>
                  打开完整资产页
                </button>
              </div>
              <div className="uiForm">
                {!latestConversationId && <div className="uiHint">还没有会话记录，先去聊一轮。</div>}
                {latestConversationId && !snapshot && <div className="uiHint">有会话但暂无状态快照（可能 patch 尚未落库）。</div>}
                {snapshot && (
                  <>
                    <div className="uiHint">当前穿搭：{snapshot.outfit || '(none)'}</div>
                    <div className="uiHint">
                      物品：{snapshot.inventory.length ? snapshot.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `x${x.count}` : ''}`).join(' | ') : '(empty)'}
                    </div>
                    <div className="uiHint">NPC：{snapshot.npcs.length ? snapshot.npcs.join(' | ') : '(empty)'}</div>
                    <div className="uiHint">高光事件：{snapshot.highlights.length ? snapshot.highlights.join(' | ') : '(empty)'}</div>
                    <div className="uiHint">事件日志：{snapshot.events.length ? snapshot.events.join(' | ') : '(empty)'}</div>
                  </>
                )}
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">视觉资产</div>
                  <div className="uiPanelSub">cover / full_body / head 预览</div>
                </div>
              </div>
              <div className="uiForm">
                <div className="uiSplit">
                  <div className="uiCard" style={{ margin: 0 }}>
                    <div className="uiCardMedia" style={{ height: 220 }}>
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" />
                      ) : (
                        <div className="uiCardMediaFallback">暂无图片</div>
                      )}
                    </div>
                    <div className="uiCardTitle">预览</div>
                    <div className="uiCardMeta">点击缩略图切换</div>
                  </div>
                  <div className="uiThumbGrid">
                    {assetUrls.slice(0, 8).map((a, idx) => (
                      <button key={`${a.kind}:${idx}`} className="uiCard" style={{ margin: 0, padding: 10, cursor: 'pointer' }} onClick={() => setCoverUrl(a.url)}>
                        <div className="uiCardMedia" style={{ height: 84 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt="" />
                        </div>
                        <div className="uiCardMeta" style={{ marginTop: 8 }}>
                          {a.kind}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                {assetUrls.length === 0 && <div className="uiHint">暂无可预览资产。</div>}
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
