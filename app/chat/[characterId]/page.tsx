'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'
import { inferPresentationCue, pickBestBackgroundPath } from '@/lib/presentation/cues'

type InputEvent =
  | 'TALK_HOLD'
  | 'FUNC_HOLD'
  | 'TALK_DBL'
  | 'FUNC_DBL'
  | 'SCHEDULE_TICK'
  | 'SCHEDULE_PLAY'
  | 'SCHEDULE_PAUSE'

type Msg = { id?: string; created_at?: string; role: 'user' | 'assistant'; content: string; input_event?: string | null }
type DbMessageRow = { id: string; role: string; content: string; created_at: string; input_event?: string | null }
type CharacterAssetRow = { kind: string; storage_path: string; created_at?: string }
type RelationshipStage = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7'
type RomanceMode = 'ROMANCE_ON' | 'ROMANCE_OFF'
type PlotGranularity = 'LINE' | 'BEAT' | 'SCENE'
type EndingMode = 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED'
const RECENT_MESSAGES_LIMIT = 60
const OLDER_MESSAGES_LIMIT = 20
const OLDER_LOAD_COOLDOWN_MS = 700
const CONVERSATION_LIST_LIMIT = 20

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
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

function messageTailKey(m?: Msg) {
  if (!m) return ''
  return [m.id || '', m.created_at || '', m.role, m.content.slice(0, 80)].join('|')
}

function formatMessageTime(ts?: string) {
  if (!ts) return ''
  const t = new Date(ts)
  if (!Number.isFinite(t.getTime())) return ''
  return t.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function hasAssistantUserSpeech(text: string) {
  const t = String(text || '')
  if (!t.trim()) return false
  return /(^|\n)\s*(\{?user\}?|USER|User|user|用户|你)\s*[:：]/.test(t)
}

function stripAssistantUserSpeech(text: string) {
  const lines = String(text || '')
    .split('\n')
    .filter((line) => !/^\s*(\{?user\}?|USER|User|user|用户|你)\s*[:：]/.test(line))
  return lines.join('\n').trim()
}

export default function ChatPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [error, setError] = useState('')
  const [guardWarn, setGuardWarn] = useState('')
  const [title, setTitle] = useState('')

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationList, setConversationList] = useState<Array<{ id: string; created_at?: string }>>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')

  const [assistantAvatarUrl, setAssistantAvatarUrl] = useState('')
  const [chatBgUrl, setChatBgUrl] = useState('')
  const [chatBgPath, setChatBgPathState] = useState('')
  const [chatRoleUrl, setChatRoleUrl] = useState('')
  const [chatRolePath, setChatRolePathState] = useState('')
  const [chatRoleScale, setChatRoleScale] = useState(104)
  const [chatRoleYOffset, setChatRoleYOffset] = useState(0)
  const [assetUrls, setAssetUrls] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [bgAutoEnabled, setBgAutoEnabled] = useState(true)
  const [bgCue, setBgCue] = useState('')
  const [userCard, setUserCard] = useState('')
  const [showUserCard, setShowUserCard] = useState(false)
  const [userCardDraft, setUserCardDraft] = useState('')

  const [patchOk, setPatchOk] = useState<boolean | null>(null)
  const [patchError, setPatchError] = useState('')

  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [oldestTs, setOldestTs] = useState<string>('')
  const [showTimestamps, setShowTimestamps] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [pendingDownCount, setPendingDownCount] = useState(0)
  const [outfitHint, setOutfitHint] = useState('')
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
  const [showDetails, setShowDetails] = useState(false)
  const [showSceneDock, setShowSceneDock] = useState(true)
  const [savingOutfit, setSavingOutfit] = useState(false)
  const [manualOutfit, setManualOutfit] = useState('')
  const [details, setDetails] = useState<{
    inventory: Array<{ name: string; count?: number }>
    npcs: string[]
    highlights: Array<{ day_start?: string; item?: string }>
    eventLog: string[]
    outfit: string
    wardrobeItems: string[]
  } | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)
  const messageTailRef = useRef('')
  const messageLenRef = useRef(0)
  const olderLoadAtRef = useRef(0)

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])
  const convKey = useMemo(() => `xuxuxu:conversationId:${characterId}`, [characterId])
  const bgKey = useMemo(() => `xuxuxu:chatBgPath:${characterId}`, [characterId])
  const roleKey = useMemo(() => `xuxuxu:chatRolePath:${characterId}`, [characterId])
  const tsKey = useMemo(() => `xuxuxu:showTimestamps:${characterId}`, [characterId])

  const assistantInitial = useMemo(() => {
    const t = (title || 'AI').trim()
    return (t ? t.slice(0, 1) : 'A').toUpperCase()
  }, [title])

  const ledgerHealth = useMemo(() => {
    if (!details) {
      return [
        { key: 'wardrobe', label: '服装', ok: false },
        { key: 'inventory', label: '物品', ok: false },
        { key: 'npc', label: 'NPC', ok: false },
        { key: 'highlights', label: '高光事件', ok: false },
        { key: 'events', label: '事件日志', ok: false },
      ]
    }
    return [
      { key: 'wardrobe', label: '服装', ok: !!details.outfit },
      { key: 'inventory', label: '物品', ok: details.inventory.length > 0 },
      { key: 'npc', label: 'NPC', ok: details.npcs.length > 0 },
      { key: 'highlights', label: '高光事件', ok: details.highlights.length > 0 },
      { key: 'events', label: '事件日志', ok: details.eventLog.length > 0 },
    ]
  }, [details])

  const ledgerSummary = useMemo(() => {
    const ok = ledgerHealth.filter((x) => x.ok).length
    return { ok, total: ledgerHealth.length }
  }, [ledgerHealth])

  const messageStats = useMemo(() => {
    let user = 0
    let assistant = 0
    for (const m of messages) {
      if (m.role === 'user') user += 1
      else assistant += 1
    }
    return { total: messages.length, user, assistant }
  }, [messages])

  const touchConversationList = (id: string) => {
    if (!id) return
    setConversationList((prev) => {
      const hit = prev.find((x) => x.id === id)
      const nowIso = new Date().toISOString()
      const nextHead = hit ? { ...hit, created_at: nowIso } : { id, created_at: nowIso }
      const rest = prev.filter((x) => x.id !== id)
      return [nextHead, ...rest].slice(0, CONVERSATION_LIST_LIMIT)
    })
  }

  const backgroundAssets = useMemo(
    () => assetUrls.filter((a) => a.kind === 'cover' || /bg|background|scene|street|city|room|night|beach/i.test(a.path)),
    [assetUrls],
  )

  const roleAssets = useMemo(
    () => assetUrls.filter((a) => a.kind === 'full_body' || a.kind === 'head' || /body|head|portrait|avatar|role|character/i.test(a.path)),
    [assetUrls],
  )

  const backgroundPresets = useMemo(() => {
    const list = backgroundAssets
    if (!list.length) return [] as Array<{ id: string; label: string; path: string }>
    const pick = (keys: string[]) => list.find((a) => keys.some((k) => a.path.toLowerCase().includes(k))) || list[0]
    return [
      { id: 'daily', label: 'Daily', path: pick(['street', 'city', 'day', 'cafe']).path },
      { id: 'night', label: 'Night', path: pick(['night', 'moon', 'neon']).path },
      { id: 'room', label: 'Room', path: pick(['room', 'home', 'indoor']).path },
    ]
  }, [backgroundAssets])

  const scenePresets = useMemo(() => {
    if (!backgroundAssets.length && !roleAssets.length) return [] as Array<{ id: string; label: string; bgPath: string; rolePath: string; scale: number; y: number }>
    const pickBg = (keys: string[]) => backgroundAssets.find((a) => keys.some((k) => a.path.toLowerCase().includes(k))) || backgroundAssets[0]
    const pickRole = (keys: string[]) => roleAssets.find((a) => keys.some((k) => a.path.toLowerCase().includes(k))) || roleAssets[0]
    return [
      { id: 'daily', label: 'Daily', bgPath: pickBg(['street', 'city', 'day', 'cafe'])?.path || '', rolePath: pickRole(['full', 'body'])?.path || '', scale: 104, y: 0 },
      { id: 'night', label: 'Night', bgPath: pickBg(['night', 'moon', 'neon'])?.path || '', rolePath: pickRole(['full', 'body'])?.path || '', scale: 108, y: 2 },
      { id: 'closeup', label: 'Closeup', bgPath: pickBg(['room', 'home', 'indoor'])?.path || '', rolePath: pickRole(['head', 'portrait'])?.path || '', scale: 124, y: 10 },
    ]
  }, [backgroundAssets, roleAssets])

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

  const applyControlState = (state: unknown) => {
    const root = asRecord(state)
    const run = asRecord(root.run_state)
    const board = asRecord(root.schedule_board)
    const style = asRecord(root.style_guard)

    setScheduleState(normalizeSchedule(board.schedule_state || run.schedule_state))
    setLockMode(String(board.lock_mode || 'manual'))
    setStoryLockUntil(typeof board.story_lock_until === 'string' ? board.story_lock_until : '')
    setRelationshipStage(normalizeStage(run.relationship_stage))
    setRomanceMode(normalizeRomance(run.romance_mode))
    setPlotGranularity(normalizePlotGranularity(run.plot_granularity))
    setEndingMode(normalizeEndingMode(run.ending_mode))
    const winRaw = Number(style.ending_repeat_window ?? 6)
    const win = Number.isFinite(winRaw) ? Math.max(3, Math.min(Math.floor(winRaw), 12)) : 6
    setEndingRepeatWindow(win)
  }

  const loadRecentMessages = async (convId: string, userId: string) => {
    setLoadingHistory(true)
    setHasMore(true)
    setOldestTs('')
    olderLoadAtRef.current = 0
    try {
      const r = await supabase
        .from('messages')
        .select('id,role,content,created_at,input_event')
        .eq('conversation_id', convId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(RECENT_MESSAGES_LIMIT)
      if (r.error) throw new Error(r.error.message)

      const rows = (r.data ?? []) as DbMessageRow[]
      const next: Msg[] = rows
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          created_at: m.created_at,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
          input_event: m.input_event ?? null,
        }))

      messageTailRef.current = messageTailKey(next[next.length - 1])
      messageLenRef.current = next.length
      setMessages(next)
      if (next.length) setOldestTs(next[0].created_at || '')
      setHasMore(rows.length >= RECENT_MESSAGES_LIMIT)
      setPendingDownCount(0)

      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' })
        setShowScrollDown(false)
      })
    } catch {
      setHasMore(false)
    } finally {
      setLoadingHistory(false)
    }
  }

  const loadOlderMessages = async (userId: string) => {
    if (!conversationId) return
    if (loadingOlder || loadingHistory || !hasMore) return
    if (!oldestTs) return
    const now = Date.now()
    if (now - olderLoadAtRef.current < OLDER_LOAD_COOLDOWN_MS) return
    olderLoadAtRef.current = now

    const el = listRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0
    const prevScrollTop = el?.scrollTop ?? 0

    setLoadingOlder(true)
    try {
      const r = await supabase
        .from('messages')
        .select('id,role,content,created_at,input_event')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .lt('created_at', oldestTs)
        .order('created_at', { ascending: false })
        .limit(OLDER_MESSAGES_LIMIT)
      if (r.error) throw new Error(r.error.message)

      const rows = (r.data ?? []) as DbMessageRow[]
      if (!rows.length) {
        setHasMore(false)
        return
      }

      const older: Msg[] = rows
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          created_at: m.created_at,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
          input_event: m.input_event ?? null,
        }))

      setMessages((prev) => [...older, ...prev])
      setOldestTs(older[0]?.created_at || oldestTs)
      setHasMore(rows.length >= OLDER_MESSAGES_LIMIT)

      requestAnimationFrame(() => {
        const el2 = listRef.current
        if (!el2) return
        const nextScrollHeight = el2.scrollHeight
        const delta = nextScrollHeight - prevScrollHeight
        el2.scrollTop = prevScrollTop + delta
      })
    } catch {
      setHasMore(false)
    } finally {
      setLoadingOlder(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError('')

      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        setCurrentUserId('')
        router.replace('/login')
        return
      }
      setCurrentUserId(userId)

      const { data: c, error: ce } = await supabase.from('characters').select('name').eq('id', characterId).eq('user_id', userId).single()
      if (ce || !c) {
        setError('角色不存在或无权限。')
        setLoading(false)
        return
      }
      setTitle(c.name || '')

      // Load per-character identity card from localStorage (best-effort).
      try {
        const k = `xuxuxu:userCard:${characterId}`
        const v = localStorage.getItem(k) || ''
        setUserCard(v)
      } catch {
        // ignore
      }

      // Restore conversation + messages (best-effort).
      try {
        let convId = ''
        try {
          convId = localStorage.getItem(convKey) || ''
        } catch {
          convId = ''
        }

        // Load recent conversations for this character.
        try {
          const rr = await supabase
            .from('conversations')
            .select('id,created_at')
            .eq('character_id', characterId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(CONVERSATION_LIST_LIMIT)
          if (!rr.error) setConversationList((rr.data ?? []) as Array<{ id: string; created_at?: string }>)
        } catch {
          // ignore
        }

        if (!convId) {
          const r = await supabase
            .from('conversations')
            .select('id,created_at')
            .eq('character_id', characterId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (!r.error && r.data?.id) convId = r.data.id
        }

        if (convId) {
          setConversationId(convId)
          await loadRecentMessages(convId, userId)
        }
      } catch {
        // ignore
      }

      // Best-effort: load avatar from character_assets (head preferred; fall back to full_body).
      try {
        const assets = await supabase
          .from('character_assets')
          .select('kind,storage_path,created_at')
          .eq('character_id', characterId)
          .in('kind', ['head', 'full_body', 'cover'])
          .order('created_at', { ascending: false })
          .limit(60)

        if (!assets.error && (assets.data ?? []).length) {
          const rows = (assets.data ?? []) as CharacterAssetRow[]
          const avatar = rows.find((r) => r.kind === 'head') ?? rows.find((r) => r.kind === 'full_body') ?? rows[0]
          const bg = rows.find((r) => r.kind === 'cover') ?? rows.find((r) => r.kind === 'full_body') ?? null
          const role = rows.find((r) => r.kind === 'full_body') ?? rows.find((r) => r.kind === 'head') ?? null

          // Allow user override for chat background (store storage_path, sign per session).
          let bgPath = ''
          let hasBgOverride = false
          try {
            bgPath = localStorage.getItem(bgKey) || ''
            hasBgOverride = !!bgPath
          } catch {
            bgPath = ''
            hasBgOverride = false
          }
          const bgPick = (bgPath && rows.find((r) => r.storage_path === bgPath)) || bg

          let rolePath = ''
          try {
            rolePath = localStorage.getItem(roleKey) || ''
          } catch {
            rolePath = ''
          }
          const rolePick = (rolePath && rows.find((r) => r.storage_path === rolePath)) || role

          if (avatar?.storage_path) {
            const signed = await supabase.storage.from('character-assets').createSignedUrl(avatar.storage_path, 60 * 60)
            if (!signed.error && signed.data?.signedUrl) setAssistantAvatarUrl(signed.data.signedUrl)
          }
          if (bgPick?.storage_path) {
            const signed2 = await supabase.storage.from('character-assets').createSignedUrl(bgPick.storage_path, 60 * 60)
            if (!signed2.error && signed2.data?.signedUrl) {
              setChatBgUrl(signed2.data.signedUrl)
              setChatBgPathState(bgPick.storage_path)
              setBgAutoEnabled(!hasBgOverride)
            }
          }
          if (rolePick?.storage_path) {
            const signed3 = await supabase.storage.from('character-assets').createSignedUrl(rolePick.storage_path, 60 * 60)
            if (!signed3.error && signed3.data?.signedUrl) {
              setChatRoleUrl(signed3.data.signedUrl)
              setChatRolePathState(rolePick.storage_path)
            }
          }

          // Sign a small list for UI selection (best-effort).
          const uniquePaths = new Set<string>()
          const picks = rows
            .filter((r) => !!r.storage_path && (r.kind === 'cover' || r.kind === 'full_body' || r.kind === 'head'))
            .filter((r) => {
              if (uniquePaths.has(r.storage_path)) return false
              uniquePaths.add(r.storage_path)
              return true
            })
            .slice(0, 24)

          const signedList = await Promise.all(
            picks.map(async (r) => {
              const s2 = await supabase.storage.from('character-assets').createSignedUrl(r.storage_path, 60 * 60)
              return { kind: r.kind, path: r.storage_path, url: s2.data?.signedUrl || '' }
            }),
          )
          setAssetUrls(signedList.filter((x) => !!x.url))
        }
      } catch {
        // ignore
      }

      setLoading(false)
    }

    init()
  }, [characterId, convKey, bgKey, roleKey, router])

  const loadOutfitHint = async (convId: string, userId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (r.error || !r.data?.state || typeof r.data.state !== 'object') {
        setOutfitHint('')
        setScheduleState('PLAY')
        setLockMode('manual')
        setStoryLockUntil('')
        setRelationshipStage('S1')
        setRomanceMode('ROMANCE_ON')
        setPlotGranularity('BEAT')
        setEndingMode('MIXED')
        setEndingRepeatWindow(6)
        return
      }
      const st = asRecord(r.data.state)
      applyControlState(st)
      const ledger = asRecord(st.ledger)
      const wardrobe = asRecord(ledger.wardrobe)
      const outfit = typeof wardrobe.current_outfit === 'string' ? wardrobe.current_outfit.trim() : ''
      setOutfitHint(outfit ? `当前穿搭：${outfit}` : '')
    } catch {
      // ignore (table may not exist)
    }
  }

  const loadDetails = async (convId: string, userId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (r.error || !r.data?.state || typeof r.data.state !== 'object') return
      const st = asRecord(r.data.state)
      applyControlState(st)
      const ledger = asRecord(st.ledger)
      const wardrobe = asRecord(ledger.wardrobe)
      const outfit = typeof wardrobe.current_outfit === 'string' ? wardrobe.current_outfit.trim() : ''

      const itemsRaw = Array.isArray(wardrobe.items) ? (wardrobe.items as unknown[]) : []
      const wardrobeItems = itemsRaw
        .slice(0, 40)
        .map((x) => {
          if (typeof x === 'string') return x.trim()
          const r2 = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
          const v =
            (typeof r2.outfit === 'string' && r2.outfit) ||
            (typeof r2.name === 'string' && r2.name) ||
            (typeof r2.title === 'string' && r2.title) ||
            ''
          return String(v).trim()
        })
        .filter(Boolean)

      const invRaw = Array.isArray(ledger.inventory) ? (ledger.inventory as unknown[]) : []
      const inventory = invRaw
        .slice(0, 24)
        .map((x) => {
          const r2 = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
          const name = typeof r2.name === 'string' ? r2.name : ''
          const count = typeof r2.count === 'number' ? r2.count : typeof r2.qty === 'number' ? r2.qty : undefined
          return { name, count }
        })
        .filter((x) => x.name)

      const npcRaw = Array.isArray(ledger.npc_database) ? (ledger.npc_database as unknown[]) : []
      const npcs = npcRaw
        .slice(0, 40)
        .map((x) => {
          const r2 = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
          const name = (typeof r2.name === 'string' && r2.name) || (typeof r2.npc === 'string' && r2.npc) || ''
          return name.trim()
        })
        .filter(Boolean)

      const evRaw = Array.isArray(ledger.event_log) ? (ledger.event_log as unknown[]) : []
      const eventLog = evRaw
        .slice(-20)
        .map((x) => {
          if (typeof x === 'string') return x.trim()
          const r2 = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
          return typeof r2.content === 'string' ? r2.content.trim() : ''
        })
        .filter(Boolean)

      const mem = asRecord(st.memory)
      const hlRaw = Array.isArray(mem.highlights) ? (mem.highlights as unknown[]) : []
      const highlights = hlRaw
        .slice(-20)
        .map((x) => {
          const r2 = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
          const item = typeof r2.item === 'string' ? r2.item : typeof r2.text === 'string' ? r2.text : ''
          const day_start = typeof r2.day_start === 'string' ? r2.day_start : ''
          return { day_start, item }
        })
        .filter((x) => x.item)

      setDetails({ outfit, wardrobeItems, inventory, npcs, highlights, eventLog })
      setManualOutfit(outfit)
    } catch {
      // ignore
    }
  }

  const setOutfit = async (nextOutfit: string) => {
    if (!conversationId) return
    const v = nextOutfit.trim()
    if (!v) return
    if (savingOutfit) return

    setSavingOutfit(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录态失效，请重新登录。')

      const resp = await fetch('/api/state/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, currentOutfit: v, confirmed: true }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        throw new Error(t || `请求失败：${resp.status}`)
      }

      setManualOutfit(v)
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        setError('登录已失效，请重新登录')
        return
      }
      await loadOutfitHint(conversationId, userId)
      await loadDetails(conversationId, userId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setSavingOutfit(false)
    }
  }

  useEffect(() => {
    if (!conversationId) return
    const loadHint = async () => {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) return
      await loadOutfitHint(conversationId, userId)
      if (showDetails) await loadDetails(conversationId, userId)
    }
    loadHint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, showDetails])

  useEffect(() => {
    // Persist identity card locally (best-effort).
    try {
      const k = `xuxuxu:userCard:${characterId}`
      localStorage.setItem(k, userCard.slice(0, 300))
    } catch {
      // ignore
    }
  }, [characterId, userCard])

  const setChatBgPath = async (path: string, opts?: { manual?: boolean; cueLabel?: string }) => {
    const nextPath = String(path || '').trim()
    if (!nextPath) return
    if (nextPath === chatBgPath) return

    if (opts?.manual) setBgAutoEnabled(false)
    else if (opts?.cueLabel) {
      setBgAutoEnabled(true)
      setBgCue(opts.cueLabel)
    }

    try {
      localStorage.setItem(bgKey, nextPath)
    } catch {
      // ignore
    }

    try {
      const signed = await supabase.storage.from('character-assets').createSignedUrl(nextPath, 60 * 60)
      if (!signed.error && signed.data?.signedUrl) {
        setChatBgPathState(nextPath)
        setChatBgUrl(signed.data.signedUrl)
      }
    } catch {
      // ignore
    }
  }

  const setRoleLayerPath = async (path: string) => {
    const nextPath = String(path || '').trim()
    if (!nextPath) return
    if (nextPath === chatRolePath) return

    try {
      localStorage.setItem(roleKey, nextPath)
    } catch {
      // ignore
    }

    try {
      const signed = await supabase.storage.from('character-assets').createSignedUrl(nextPath, 60 * 60)
      if (!signed.error && signed.data?.signedUrl) {
        setChatRolePathState(nextPath)
        setChatRoleUrl(signed.data.signedUrl)
      }
    } catch {
      // ignore
    }
  }

  const applyScenePreset = async (presetId: string) => {
    const preset = scenePresets.find((x) => x.id === presetId)
    if (!preset) return
    if (preset.bgPath) await setChatBgPath(preset.bgPath, { manual: true })
    if (preset.rolePath) await setRoleLayerPath(preset.rolePath)
    setChatRoleScale(preset.scale)
    setChatRoleYOffset(preset.y)
  }

  const updateScheduleControl = async (action: 'PLAY' | 'PAUSE' | 'LOCK' | 'UNLOCK', lockMinutes?: number) => {
    if (!conversationId || updatingSchedule) return

    setUpdatingSchedule(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录态失效，请重新登录。')

      const payload: Record<string, unknown> = { conversationId, action }
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
    if (!conversationId || updatingRelationship) return
    if (!args.stage && !args.romance) return

    setUpdatingRelationship(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录态失效，请重新登录。')

      const payload: Record<string, unknown> = {
        conversationId,
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
      if (data.romanceMode) setRomanceMode(normalizeRomance(data.romanceMode))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdatingRelationship(false)
    }
  }

  const updatePromptPolicyControl = async () => {
    if (!conversationId || updatingPromptPolicy) return

    setUpdatingPromptPolicy(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录态失效，请重新登录。')

      const nextEndingsPrefer =
        endingMode === 'QUESTION'
          ? ['Q', 'A', 'B']
          : endingMode === 'ACTION'
            ? ['A', 'B', 'S']
            : endingMode === 'CLIFF'
              ? ['S', 'A', 'B']
              : ['A', 'B', 'S']

      const payload = {
        conversationId,
        plotGranularity,
        endingMode,
        endingRepeatWindow,
        nextEndingsPrefer,
        persistToCharacter: true,
      }

      const resp = await fetch('/api/state/prompt-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
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

  useEffect(() => {
    if (!showUserCard) return
    // Open modal with a draft copy; closing without save discards changes.
    setUserCardDraft(userCard)
  }, [showUserCard, userCard])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(tsKey) || ''
      setShowTimestamps(raw === '1')
    } catch {
      setShowTimestamps(false)
    }
  }, [tsKey])

  useEffect(() => {
    try {
      localStorage.setItem(tsKey, showTimestamps ? '1' : '0')
    } catch {
      // ignore
    }
  }, [showTimestamps, tsKey])

  useEffect(() => {
    const el = listRef.current
    const tail = messageTailKey(messages[messages.length - 1])
    const prevTail = messageTailRef.current
    const prevLen = messageLenRef.current
    const appendedAtBottom = !!tail && tail !== prevTail

    if (el && appendedAtBottom && messages.length > prevLen) {
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 180
      if (nearBottom) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        setShowScrollDown(false)
        setPendingDownCount(0)
      } else {
        setShowScrollDown(true)
        setPendingDownCount((v) => Math.min(99, v + (messages.length - prevLen)))
      }
    }

    messageTailRef.current = tail
    messageLenRef.current = messages.length
  }, [messages])

  const createNewConversation = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }
      const title2 = (title || '对话').slice(0, 80)
      const ins = await supabase.from('conversations').insert({ user_id: userId, character_id: characterId, title: title2 }).select('id,created_at').single()
      if (ins.error || !ins.data?.id) throw new Error(ins.error?.message || '创建会话失败')
      const id2 = String(ins.data.id)
      setConversationId(id2)
      messageTailRef.current = ''
      messageLenRef.current = 0
      setMessages([])
      setDetails(null)
      setOutfitHint('')
      setPatchOk(null)
      setPatchError('')
      setScheduleState('PLAY')
      setLockMode('manual')
      setStoryLockUntil('')
      setRelationshipStage('S1')
      setRomanceMode('ROMANCE_ON')
      setPlotGranularity('BEAT')
      setEndingMode('MIXED')
      setEndingRepeatWindow(6)
      setShowScrollDown(false)
      setPendingDownCount(0)
      setConversationList((prev) => [{ id: id2, created_at: ins.data.created_at }, ...prev].slice(0, CONVERSATION_LIST_LIMIT))
      try {
        localStorage.setItem(convKey, id2)
      } catch {
        // ignore
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const post = async (text: string, inputEvent?: InputEvent) => {
    setSending(true)
    setError('')
    setGuardWarn('')
    setPatchOk(null)
    setPatchError('')

    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) {
      setError('登录态失效，请重新登录。')
      setSending(false)
      return
    }

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        characterId,
        conversationId,
        message: text,
        inputEvent,
        userCard: userCard.slice(0, 300),
      }),
    })

    if (!resp.ok) {
      const t = await resp.text()
      setError(t || `请求失败：${resp.status}`)
      setSending(false)
      return
    }

    const data = await resp.json()
    if (data.conversationId) {
      const nextConversationId = String(data.conversationId)
      setConversationId(nextConversationId)
      touchConversationList(nextConversationId)
      try {
        localStorage.setItem(convKey, nextConversationId)
      } catch {
        // ignore
      }
    }
    if (data.assistantMessage) {
      let assistantText = String(data.assistantMessage)
      const uiGuardHit = hasAssistantUserSpeech(assistantText)
      if (uiGuardHit) {
        assistantText = stripAssistantUserSpeech(assistantText) || '我只会从角色视角回复，不会代替你发言。'
      }
      const guardTriggered = data?.guardTriggered === true || uiGuardHit
      if (guardTriggered) {
        const notes: string[] = []
        if (data?.guardRewriteUsed === true) notes.push('已自动重写一次')
        if (data?.guardFallbackUsed === true || uiGuardHit) notes.push('已启用防代用户护栏')
        setGuardWarn(`主语护栏触发：${notes.join('，') || '已修正输出'}`)
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }])
      if (bgAutoEnabled && backgroundAssets.length > 0) {
        const cue = inferPresentationCue(assistantText)
        const picked = pickBestBackgroundPath(backgroundAssets.map((x) => ({ path: x.path })), cue)
        if (picked.path && picked.score > 0) {
          const cueLabel = `${cue.emotion}${cue.sceneTags.length ? `/${cue.sceneTags.join('-')}` : ''}`
          await setChatBgPath(picked.path, { cueLabel })
        }
      }
    }
    if (typeof data.patchOk === 'boolean') setPatchOk(data.patchOk)
    if (typeof data.patchError === 'string') setPatchError(data.patchError)
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
      setShowScrollDown(false)
      setPendingDownCount(0)
    })
    setSending(false)
  }

  const send = async () => {
    if (!canSend) return
    const text = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    await post(text, 'TALK_HOLD')
  }

  const pushStory = async () => {
    if (sending) return
    setMessages((prev) => [...prev, { role: 'user', content: '(推进剧情)' }])
    await post('(推进剧情)', 'TALK_DBL')
  }

  if (loading) {
    return (
      <div className="uiPage">
        <AppShell title="对话" badge="m2-her">
          <div className="uiSkeleton">加载中...</div>
        </AppShell>
      </div>
    )
  }

  return (
    <div className="uiPage">
      <AppShell
        title={title || '对话'}
        badge="m2-her"
        subtitle={outfitHint || '对话会自动保存。旁白请用括号输入。'}
        actions={
          <>
            {conversationList.length > 0 && (
              <select
                className="uiInput"
                style={{ width: 220, padding: '10px 10px' }}
                value={conversationId || ''}
                disabled={loadingHistory || sending}
                onChange={async (e) => {
                  const id2 = e.target.value
                  if (!id2) return
                  const userId = currentUserId
                  if (!userId) {
                    router.replace('/login')
                    return
                  }

                  setConversationId(id2)
                  messageTailRef.current = ''
                  messageLenRef.current = 0
                  setMessages([])
                  setShowScrollDown(false)
                  setPendingDownCount(0)
                  try {
                    localStorage.setItem(convKey, id2)
                  } catch {
                    // ignore
                  }
                  await loadRecentMessages(id2, userId)
                }}
              >
                {conversationList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.created_at ? new Date(c.created_at).toLocaleString() : c.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
            <button className="uiBtn uiBtnSecondary" onClick={createNewConversation} disabled={sending}>
              新会话
            </button>
            <button
              className="uiBtn uiBtnGhost"
                onClick={() => {
                  const next = !showDetails
                  setShowDetails(next)
                  if (!next || !conversationId) return
                  ;(async () => {
                    const { data: userData } = await supabase.auth.getUser()
                    const userId = userData.user?.id
                    if (!userId) {
                      router.replace('/login')
                      return
                    }
                    await loadDetails(conversationId, userId)
                  })()
                }}
              >
                {showDetails ? '收起账本' : '账本详情'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => setShowSceneDock((v) => !v)}>
              {showSceneDock ? 'Scene Dock Off' : 'Scene Dock On'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => setShowTimestamps((v) => !v)}>
              {showTimestamps ? '隐藏时间' : '显示时间'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => setShowUserCard(true)}>
              身份卡
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${characterId}`)}>
              动态中心
            </button>
          </>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">实时对话</span>
            <h2 className="uiHeroTitle">角色对话与账本联动工作区</h2>
            <p className="uiHeroSub">支持会话切换、上滑加载历史、身份卡注入、换装写回和聊天背景切换。聊天内容会持续驱动角色记忆与动态。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{conversationList.length}</b>
              <span>可选会话</span>
            </div>
            <div className="uiKpi">
              <b>{messageStats.total}</b>
              <span>当前消息数</span>
            </div>
            <div className="uiKpi">
              <b>{messageStats.user}</b>
              <span>你发送</span>
            </div>
            <div className="uiKpi">
              <b>{messageStats.assistant}</b>
              <span>角色回复</span>
            </div>
            <div className="uiKpi">
              <b>
                {ledgerSummary.ok}/{ledgerSummary.total}
              </b>
              <span>账本完整度</span>
            </div>
            <div className="uiKpi">
              <b>{backgroundAssets.length}</b>
              <span>Backgrounds</span>
            </div>
            <div className="uiKpi">
              <b>{roleAssets.length}</b>
              <span>Role Layers</span>
            </div>
          </div>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {guardWarn && <div className="uiAlert uiAlertWarn">{guardWarn}</div>}
        {patchOk === false && patchError && <div className="uiAlert uiAlertErr">状态补丁错误：{patchError}</div>}

        <div className="uiPanel uiPanelCompactTop">
          <div className="uiPanelHeader">
            <div>
              <div className="uiPanelTitle">执行控制台</div>
              <div className="uiPanelSub">控制日程执行状态、关系阶段和背景自动切换。</div>
            </div>
          </div>
          <div className="uiForm" style={{ paddingTop: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="uiBadge">日程：{scheduleState === 'PAUSE' ? '暂停' : '运行中'}</span>
              <span className="uiBadge">锁模式：{lockMode || 'manual'}</span>
              <span className="uiBadge">关系阶段：{relationshipStage}</span>
              <span className="uiBadge">恋爱：{romanceMode === 'ROMANCE_OFF' ? '关闭' : '开启'}</span>
              <span className="uiBadge">背景：{bgAutoEnabled ? `自动${bgCue ? ` (${bgCue})` : ''}` : '手动'}</span>
              <span className="uiBadge">剧情颗粒度：{plotGranularity}</span>
              <span className="uiBadge">结尾策略：{endingMode}/{endingRepeatWindow}</span>              {!!storyLockUntil && <span className="uiBadge">剧情锁：{storyLockLabel || storyLockUntil}</span>}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="uiBtn uiBtnGhost" disabled={!conversationId || updatingSchedule} onClick={() => updateScheduleControl('PLAY')}>
                恢复日程
              </button>
              <button className="uiBtn uiBtnGhost" disabled={!conversationId || updatingSchedule} onClick={() => updateScheduleControl('PAUSE')}>
                暂停日程
              </button>
              <button className="uiBtn uiBtnGhost" disabled={!conversationId || updatingSchedule} onClick={() => updateScheduleControl('LOCK', 120)}>
                锁剧情 2h
              </button>
              <button className="uiBtn uiBtnGhost" disabled={!conversationId || updatingSchedule} onClick={() => updateScheduleControl('UNLOCK')}>
                解锁剧情
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="uiInput"
                style={{ width: 140 }}
                value={relationshipStage}
                disabled={!conversationId || updatingRelationship}
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
                disabled={!conversationId || updatingRelationship}
                onClick={() => {
                  const next = romanceMode === 'ROMANCE_OFF' ? 'ROMANCE_ON' : 'ROMANCE_OFF'
                  setRomanceMode(next)
                  void updateRelationshipControl({ romance: next })
                }}
              >
                {romanceMode === 'ROMANCE_OFF' ? '开启恋爱模式' : '关闭恋爱模式'}
              </button>
              <button className="uiBtn uiBtnGhost" onClick={() => setBgAutoEnabled(true)}>
                开启背景自动
              </button>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="uiInput" style={{ width: 150 }} value={plotGranularity} onChange={(e) => setPlotGranularity(normalizePlotGranularity(e.target.value))}>
                <option value="LINE">剧情颗粒度 LINE</option>
                <option value="BEAT">剧情颗粒度 BEAT</option>
                <option value="SCENE">剧情颗粒度 SCENE</option>
              </select>
              <select className="uiInput" style={{ width: 170 }} value={endingMode} onChange={(e) => setEndingMode(normalizeEndingMode(e.target.value))}>
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
              <button className="uiBtn uiBtnGhost" disabled={!conversationId || updatingPromptPolicy} onClick={updatePromptPolicyControl}>
                {updatingPromptPolicy ? '保存中...' : '保存叙事策略'}
              </button>
            </div>
          </div>
        </div>

        {showSceneDock && (
          <div className="uiPanel uiPanelCompactTop">
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">Scene Dock</div>
                <div className="uiPanelSub">Static background + role layer composer for chat stage.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="uiBtn uiBtnGhost" onClick={() => setBgAutoEnabled(true)}>
                  Auto BG
                </button>
                <button
                  className="uiBtn uiBtnGhost"
                  onClick={() => {
                    setChatRoleScale(104)
                    setChatRoleYOffset(0)
                  }}
                >
                  Reset Pose
                </button>
              </div>
            </div>
            <div className="uiForm">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {scenePresets.map((p) => (
                  <button key={`scene:${p.id}`} className="uiBtn uiBtnSecondary" onClick={() => void applyScenePreset(p.id)}>
                    Preset {p.label}
                  </button>
                ))}
                {scenePresets.length === 0 && <div className="uiHint">No scene presets available.</div>}
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div className="uiHint">Background</div>
                <div className="uiSceneThumbStrip">
                  {backgroundAssets.slice(0, 12).map((a) => (
                    <button key={`bg:${a.path}`} className={`uiSceneThumb ${chatBgPath === a.path ? 'uiSceneThumbActive' : ''}`} onClick={() => void setChatBgPath(a.path, { manual: true })}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" />
                      <span>{a.kind}</span>
                    </button>
                  ))}
                  {backgroundAssets.length === 0 && <div className="uiHint">No background assets.</div>}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div className="uiHint">Role Layer</div>
                <div className="uiSceneThumbStrip">
                  {roleAssets.slice(0, 12).map((a) => (
                    <button key={`role:${a.path}`} className={`uiSceneThumb ${chatRolePath === a.path ? 'uiSceneThumbActive' : ''}`} onClick={() => void setRoleLayerPath(a.path)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt="" />
                      <span>{a.kind}</span>
                    </button>
                  ))}
                  {roleAssets.length === 0 && <div className="uiHint">No role layer assets.</div>}
                </div>
              </div>

              <div className="uiSceneRangeRow">
                <label className="uiLabel" style={{ margin: 0 }}>
                  Role Scale ({chatRoleScale}%)
                  <input type="range" min={82} max={132} value={chatRoleScale} onChange={(e) => setChatRoleScale(Number(e.target.value))} />
                </label>
                <label className="uiLabel" style={{ margin: 0 }}>
                  Role Offset ({chatRoleYOffset}px)
                  <input type="range" min={-42} max={42} value={chatRoleYOffset} onChange={(e) => setChatRoleYOffset(Number(e.target.value))} />
                </label>
              </div>
            </div>
          </div>
        )}

        <div
          className="uiChatStage"
          ref={listRef}
          onScroll={() => {
            const el = listRef.current
            if (!el) return
            if (el.scrollTop < 80) {
              if (currentUserId) void loadOlderMessages(currentUserId)
            }
            const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 180
            setShowScrollDown(!nearBottom)
            if (nearBottom) setPendingDownCount(0)
          }}
          style={{ height: '62vh' }}
        >
          {chatBgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="uiChatStageBg"
              alt=""
              src={chatBgUrl}
            />
          )}
          {chatRoleUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="uiChatRoleLayer"
              alt=""
              src={chatRoleUrl}
              style={{ transform: `translate(-50%, ${chatRoleYOffset}px) scale(${chatRoleScale / 100})` }}
            />
          )}
          {loadingHistory && <div className="uiHint uiChatLoadHint">正在加载聊天记录...</div>}
          {!loadingHistory && hasMore && messages.length > 0 && <div className="uiHint uiChatLoadHint">上滑加载更早消息</div>}
          {loadingOlder && <div className="uiHint uiChatLoadHint">加载更早消息...</div>}

          {messages.length === 0 && (
            <div className="uiEmpty" style={{ marginTop: 0 }}>
              <div className="uiEmptyTitle">开始对话</div>
              <div className="uiEmptyDesc">先打个招呼，或用括号旁白推进剧情。</div>
            </div>
          )}

          <div className="uiChatStream">
          {messages.map((m, idx) => (
            <div key={m.id || idx} className={`chatRow ${m.role === 'user' ? 'chatRowUser' : 'chatRowAssistant'}`}>
              {m.role === 'assistant' && (
                <div className="uiAvatar" aria-hidden="true">
                  {assistantAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="uiAvatarImg" src={assistantAvatarUrl} alt="" />
                  ) : (
                    <div className="uiAvatarFallback">{assistantInitial}</div>
                  )}
                </div>
              )}

              <div>
                {showTimestamps && m.created_at && <div className="uiHint">{formatMessageTime(m.created_at)}</div>}
                <div className={`chatBubble ${m.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAssistant'}`}>{m.content}</div>
              </div>

              {m.role === 'user' && (
                <div className="uiAvatar" aria-hidden="true">
                  <div className="uiAvatarFallback">我</div>
                </div>
              )}
            </div>
          ))}
          {sending && <div className="uiHint uiChatSendingHint">发送中...</div>}
          </div>
        </div>

        {showDetails && (
          <div className="uiPanel uiPanelCompactTop">
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">账本 / 记忆</div>
                <div className="uiPanelSub">NPC、物品、服装、高光事件（来自状态账本）</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/characters/${characterId}/assets`)}>
                  资产
                </button>
                <button
                  className="uiBtn uiBtnGhost"
                  onClick={() => {
                    if (!conversationId) return
                    ;(async () => {
                      const { data: userData } = await supabase.auth.getUser()
                      const userId = userData.user?.id
                      if (!userId) return
                      await loadDetails(conversationId, userId)
                    })()
                  }}
                >
                  刷新
                </button>
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
              {backgroundAssets.length > 0 && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="uiHint">聊天背景：</div>
                  {backgroundPresets.map((p) => (
                    <button key={`preset:${p.id}`} className="uiBtn uiBtnSecondary" onClick={() => setChatBgPath(p.path, { manual: true })}>
                      Preset {p.label}
                    </button>
                  ))}
                  {backgroundAssets.map((a) => (
                    <button key={a.path} className="uiBtn uiBtnGhost" onClick={() => setChatBgPath(a.path, { manual: true })}>
                      {a.kind}
                    </button>
                  ))}
                </div>
              )}
              {!details && <div className="uiHint">暂无数据（可能状态补丁尚未写入，或未创建 conversation_states 表）。</div>}
              {details && (
                <>
                  <div className="uiHint">当前穿搭：{details.outfit || '(none)'}</div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(details.wardrobeItems || []).slice(0, 16).map((x) => (
                      <button key={x} className={`uiPill ${x === details.outfit ? 'uiPillActive' : ''}`} onClick={() => setOutfit(x)} disabled={savingOutfit}>
                        {x}
                      </button>
                    ))}
                    {details.wardrobeItems.length === 0 && <div className="uiHint">衣柜条目为空。</div>}
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      className="uiInput"
                      value={manualOutfit}
                      onChange={(e) => setManualOutfit(e.target.value)}
                      placeholder="手动设置 outfit"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOutfit(manualOutfit)
                      }}
                    />
                    <button className="uiBtn uiBtnPrimary" onClick={() => setOutfit(manualOutfit)} disabled={savingOutfit}>
                      {savingOutfit ? '保存中...' : '保存'}
                    </button>
                  </div>
                  <div className="uiHint">物品：{details.inventory.length ? details.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `x${x.count}` : ''}`).join(' | ') : '(empty)'}</div>
                  <div className="uiHint">NPC：{details.npcs.length ? details.npcs.join(' | ') : '(empty)'}</div>
                  <div className="uiHint">高光事件：{details.highlights.length ? details.highlights.map((x) => x.item || '').join(' | ') : '(empty)'}</div>
                  <div className="uiHint">事件日志：{details.eventLog.length ? details.eventLog.join(' | ') : '(empty)'}</div>
                </>
              )}
            </div>
          </div>
        )}

        {showScrollDown && (
          <button
            className="uiBtn uiBtnPrimary uiChatJump"
            onClick={() => {
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
              setShowScrollDown(false)
              setPendingDownCount(0)
            }}
          >
            {pendingDownCount > 0 ? `回到底部 · ${pendingDownCount}` : '回到底部'}
          </button>
        )}

        <div className="uiChatComposer">
          <input
            className="uiInput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息（旁白请用括号）"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="uiBtn uiBtnSecondary" disabled={sending} onClick={pushStory}>
            推进剧情
          </button>
          <button className="uiBtn uiBtnPrimary" disabled={!canSend} onClick={send}>
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </AppShell>

      {showUserCard && (
        <div
          className="uiModalOverlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowUserCard(false)}
        >
          <div
            className="uiPanel uiModalPanel"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">身份卡（注入 prompt）</div>
                <div className="uiPanelSub">每个角色一份，最多 300 字，保存在本地浏览器。</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="uiBtn uiBtnSecondary"
                  onClick={() => {
                    setUserCard(userCardDraft.slice(0, 300))
                    setShowUserCard(false)
                  }}
                >
                  保存
                </button>
                <button className="uiBtn uiBtnGhost" onClick={() => setShowUserCard(false)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="uiForm">
              <label className="uiLabel">
                身份卡
                <textarea
                  className="uiTextarea"
                  value={userCardDraft}
                  onChange={(e) => setUserCardDraft(e.target.value.slice(0, 300))}
                  placeholder="例如：你希望TA重点知道的事、你们的关系定位、禁区、偏好等。"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
