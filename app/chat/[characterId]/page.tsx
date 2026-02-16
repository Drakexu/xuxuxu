'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

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

export default function ChatPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversationList, setConversationList] = useState<Array<{ id: string; created_at?: string }>>([])
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')

  const [assistantAvatarUrl, setAssistantAvatarUrl] = useState('')
  const [chatBgUrl, setChatBgUrl] = useState('')
  const [assetUrls, setAssetUrls] = useState<Array<{ kind: string; url: string; path: string }>>([])
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
  const [outfitHint, setOutfitHint] = useState('')
  const [showDetails, setShowDetails] = useState(false)
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

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])
  const convKey = useMemo(() => `xuxuxu:conversationId:${characterId}`, [characterId])
  const bgKey = useMemo(() => `xuxuxu:chatBgPath:${characterId}`, [characterId])

  const assistantInitial = useMemo(() => {
    const t = (title || 'AI').trim()
    return (t ? t.slice(0, 1) : 'A').toUpperCase()
  }, [title])

  const loadRecentMessages = async (convId: string, userId: string) => {
    setLoadingHistory(true)
    setHasMore(true)
    setOldestTs('')
    try {
      const r = await supabase
        .from('messages')
        .select('id,role,content,created_at,input_event')
        .eq('conversation_id', convId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)
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

      setMessages(next)
      if (next.length) setOldestTs(next[0].created_at || '')
      setHasMore(rows.length >= 60)

      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' })
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
        .limit(20)
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
      setHasMore(rows.length >= 20)

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
        router.replace('/login')
        return
      }

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
            .limit(10)
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
          .limit(12)

        if (!assets.error && (assets.data ?? []).length) {
          const rows = (assets.data ?? []) as CharacterAssetRow[]
          const avatar = rows.find((r) => r.kind === 'head') ?? rows.find((r) => r.kind === 'full_body') ?? rows[0]
          const bg = rows.find((r) => r.kind === 'cover') ?? rows.find((r) => r.kind === 'full_body') ?? null

          // Allow user override for chat background (store storage_path, sign per session).
          let bgPath = ''
          try {
            bgPath = localStorage.getItem(bgKey) || ''
          } catch {
            bgPath = ''
          }
          const bgPick = (bgPath && rows.find((r) => r.storage_path === bgPath)) || bg

          if (avatar?.storage_path) {
            const signed = await supabase.storage.from('character-assets').createSignedUrl(avatar.storage_path, 60 * 60)
            if (!signed.error && signed.data?.signedUrl) setAssistantAvatarUrl(signed.data.signedUrl)
          }
          if (bgPick?.storage_path) {
            const signed2 = await supabase.storage.from('character-assets').createSignedUrl(bgPick.storage_path, 60 * 60)
            if (!signed2.error && signed2.data?.signedUrl) setChatBgUrl(signed2.data.signedUrl)
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
            .slice(0, 6)

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
  }, [characterId, convKey, bgKey, router])

  const loadOutfitHint = async (convId: string, userId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (r.error || !r.data?.state || typeof r.data.state !== 'object') return
      const st = r.data.state as Record<string, unknown>
      const ledger = (st.ledger && typeof st.ledger === 'object' ? (st.ledger as Record<string, unknown>) : {}) as Record<string, unknown>
      const wardrobe = (ledger.wardrobe && typeof ledger.wardrobe === 'object' ? (ledger.wardrobe as Record<string, unknown>) : {}) as Record<string, unknown>
      const outfit = typeof wardrobe.current_outfit === 'string' ? wardrobe.current_outfit.trim() : ''
      setOutfitHint(outfit ? `Outfit: ${outfit}` : '')
    } catch {
      // ignore (table may not exist)
    }
  }

  const loadDetails = async (convId: string, userId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (r.error || !r.data?.state || typeof r.data.state !== 'object') return
      const st = r.data.state as Record<string, unknown>
      const ledger = (st.ledger && typeof st.ledger === 'object' ? (st.ledger as Record<string, unknown>) : {}) as Record<string, unknown>
      const wardrobe = (ledger.wardrobe && typeof ledger.wardrobe === 'object' ? (ledger.wardrobe as Record<string, unknown>) : {}) as Record<string, unknown>
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

      const mem = (st.memory && typeof st.memory === 'object' ? (st.memory as Record<string, unknown>) : {}) as Record<string, unknown>
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

  const setChatBgPath = async (path: string) => {
    try {
      localStorage.setItem(bgKey, path)
    } catch {}
    try {
      const signed = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
      if (!signed.error && signed.data?.signedUrl) setChatBgUrl(signed.data.signedUrl)
    } catch {}
  }

  useEffect(() => {
    if (!showUserCard) return
    // Open modal with a draft copy; closing without save discards changes.
    setUserCardDraft(userCard)
  }, [showUserCard, userCard])

  useEffect(() => {
    // Keep near bottom if the user is already near bottom.
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 180
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const createNewConversation = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }
      const title2 = (title || 'Chat').slice(0, 80)
      const ins = await supabase.from('conversations').insert({ user_id: userId, character_id: characterId, title: title2 }).select('id,created_at').single()
      if (ins.error || !ins.data?.id) throw new Error(ins.error?.message || 'Create conversation failed')
      const id2 = String(ins.data.id)
      setConversationId(id2)
      setMessages([])
      setConversationList((prev) => [{ id: id2, created_at: ins.data.created_at }, ...prev].slice(0, 12))
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
      setConversationId(data.conversationId)
      try {
        localStorage.setItem(convKey, String(data.conversationId))
      } catch {
        // ignore
      }
    }
    if (data.assistantMessage) setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantMessage }])
    if (typeof data.patchOk === 'boolean') setPatchOk(data.patchOk)
    if (typeof data.patchError === 'string') setPatchError(data.patchError)
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
    setMessages((prev) => [...prev, { role: 'user', content: '（推进剧情）' }])
    await post('（推进剧情）', 'TALK_DBL')
  }

  if (loading) {
    return (
      <div className="uiPage">
        <AppShell title="Chat" badge="m2-her">
          <div className="uiSkeleton">加载中...</div>
        </AppShell>
      </div>
    )
  }

  return (
    <div className="uiPage">
      <AppShell
        title={title || 'Chat'}
        badge="m2-her"
        subtitle={outfitHint || '对话会自动保存。旁白请用括号输入。'}
        actions={
          <>
            {conversationList.length > 0 && (
              <select
                className="uiInput"
                style={{ width: 220, padding: '10px 10px' }}
                value={conversationId || ''}
                onChange={async (e) => {
                  const id2 = e.target.value
                  if (!id2) return
                  const { data: userData } = await supabase.auth.getUser()
                  const userId = userData.user?.id
                  if (!userId) {
                    router.replace('/login')
                    return
                  }

                  setConversationId(id2)
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
              New
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
                Details
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => setShowTimestamps((v) => !v)}>
              {showTimestamps ? 'Hide time' : 'Show time'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => setShowUserCard(true)}>
              身份卡
            </button>
          </>
        }
      >
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {patchOk === false && patchError && <div className="uiAlert uiAlertErr">PatchScribe: {patchError}</div>}

        <div
          ref={listRef}
          onScroll={() => {
            const el = listRef.current
            if (!el) return
            if (el.scrollTop < 80) {
              ;(async () => {
                const { data: userData } = await supabase.auth.getUser()
                const userId = userData.user?.id
                if (userId) await loadOlderMessages(userId)
              })()
            }
            const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 180
            setShowScrollDown(!nearBottom)
          }}
          style={{
            height: '62vh',
            overflow: 'auto',
            border: '1px solid rgba(0,0,0,.08)',
            borderRadius: 18,
            padding: 16,
            background: 'rgba(255,255,255,.62)',
            marginTop: 12,
            position: 'relative',
          }}
        >
          {chatBgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              src={chatBgUrl}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                opacity: 0.14,
                filter: 'saturate(1.05) contrast(1.05)',
                pointerEvents: 'none',
              }}
            />
          )}
          {loadingHistory && <div className="uiHint">正在加载聊天记录...</div>}
          {!loadingHistory && hasMore && <div className="uiHint">上滑加载更早的聊天记录</div>}
          {loadingOlder && <div className="uiHint">加载更早...</div>}

          {messages.length === 0 && (
            <div className="uiEmpty" style={{ marginTop: 0 }}>
              <div className="uiEmptyTitle">开始对话</div>
              <div className="uiEmptyDesc">先打个招呼，或用括号旁白来导演剧情。</div>
            </div>
          )}

          <div style={{ position: 'relative' }}>
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
                {showTimestamps && m.created_at && <div className="uiHint">{new Date(m.created_at).toLocaleString()}</div>}
                <div className={`chatBubble ${m.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAssistant'}`}>{m.content}</div>
              </div>

              {m.role === 'user' && (
                <div className="uiAvatar" aria-hidden="true">
                  <div className="uiAvatarFallback">我</div>
                </div>
              )}
            </div>
          ))}
          </div>
        </div>

        {showDetails && (
          <div className="uiPanel" style={{ marginTop: 12 }}>
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">Ledger / Memory</div>
                <div className="uiPanelSub">npc、物品、服装、高光事件（来自状态账本）</div>
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
                  Refresh
                </button>
              </div>
            </div>
            <div className="uiForm">
              {assetUrls.length > 0 && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="uiHint">Chat background:</div>
                  {assetUrls.map((a) => (
                    <button key={a.path} className="uiBtn uiBtnGhost" onClick={() => setChatBgPath(a.path)}>
                      {a.kind}
                    </button>
                  ))}
                </div>
              )}
              {!details && <div className="uiHint">暂无数据（可能还没跑 PatchScribe，或未创建 conversation_states 表）。</div>}
              {details && (
                <>
                  <div className="uiHint">Outfit: {details.outfit || '(none)'}</div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(details.wardrobeItems || []).slice(0, 16).map((x) => (
                      <button key={x} className={`uiPill ${x === details.outfit ? 'uiPillActive' : ''}`} onClick={() => setOutfit(x)} disabled={savingOutfit}>
                        {x}
                      </button>
                    ))}
                    {details.wardrobeItems.length === 0 && <div className="uiHint">Wardrobe items empty.</div>}
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
                  <div className="uiHint">Inventory: {details.inventory.length ? details.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `x${x.count}` : ''}`).join('、') : '(empty)'}</div>
                  <div className="uiHint">NPC: {details.npcs.length ? details.npcs.join('、') : '(empty)'}</div>
                  <div className="uiHint">Highlights: {details.highlights.length ? details.highlights.map((x) => x.item || '').join(' | ') : '(empty)'}</div>
                  <div className="uiHint">Event log: {details.eventLog.length ? details.eventLog.join(' | ') : '(empty)'}</div>
                </>
              )}
            </div>
          </div>
        )}

        {showScrollDown && (
          <button
            className="uiBtn uiBtnPrimary"
            style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 30 }}
            onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })}
          >
            ↓
          </button>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
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
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 18,
          }}
          onClick={() => setShowUserCard(false)}
        >
          <div
            className="uiPanel"
            style={{ width: 'min(820px, 100%)', marginTop: 56 }}
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
