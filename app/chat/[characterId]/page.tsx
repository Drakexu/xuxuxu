'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type InputEvent =
  | 'TALK_HOLD'
  | 'FUNC_HOLD'
  | 'TALK_DBL'
  | 'FUNC_DBL'
  | 'SCHEDULE_TICK'
  | 'SCHEDULE_PLAY'
  | 'SCHEDULE_PAUSE'

type Msg = { id?: string; created_at?: string; role: 'user' | 'assistant'; content: string }
type DbMessageRow = { id: string; role: string; content: string; created_at: string }
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
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')

  const [assistantAvatarUrl, setAssistantAvatarUrl] = useState('')
  const [userCard, setUserCard] = useState('')
  const [showUserCard, setShowUserCard] = useState(false)
  const [userCardDraft, setUserCardDraft] = useState('')

  const [patchOk, setPatchOk] = useState<boolean | null>(null)
  const [patchError, setPatchError] = useState('')

  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [oldestTs, setOldestTs] = useState<string>('')

  const listRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])
  const convKey = useMemo(() => `xuxuxu:conversationId:${characterId}`, [characterId])

  const assistantInitial = useMemo(() => {
    const t = (title || 'AI').trim()
    return (t ? t.slice(0, 1) : 'A').toUpperCase()
  }, [title])

  const loadRecentMessages = async (convId: string) => {
    setLoadingHistory(true)
    setHasMore(true)
    setOldestTs('')
    try {
      const r = await supabase
        .from('messages')
        .select('id,role,content,created_at')
        .eq('conversation_id', convId)
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

  const loadOlderMessages = async () => {
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
        .select('id,role,content,created_at')
        .eq('conversation_id', conversationId)
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
      if (!userData.user) {
        router.replace('/login')
        return
      }

      const { data: c, error: ce } = await supabase.from('characters').select('name').eq('id', characterId).single()
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

        if (!convId) {
          const r = await supabase
            .from('conversations')
            .select('id,created_at')
            .eq('character_id', characterId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (!r.error && r.data?.id) convId = r.data.id
        }

        if (convId) {
          setConversationId(convId)
          await loadRecentMessages(convId)
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
          .in('kind', ['head', 'full_body'])
          .order('created_at', { ascending: false })
          .limit(12)

        if (!assets.error && (assets.data ?? []).length) {
          const rows = (assets.data ?? []) as CharacterAssetRow[]
          const pick = rows.find((r) => r.kind === 'head') ?? rows[0]
          if (pick?.storage_path) {
            const signed = await supabase.storage.from('character-assets').createSignedUrl(pick.storage_path, 60 * 60)
            if (!signed.error && signed.data?.signedUrl) setAssistantAvatarUrl(signed.data.signedUrl)
          }
        }
      } catch {
        // ignore
      }

      setLoading(false)
    }

    init()
  }, [characterId, convKey, router])

  useEffect(() => {
    // Persist identity card locally (best-effort).
    try {
      const k = `xuxuxu:userCard:${characterId}`
      localStorage.setItem(k, userCard.slice(0, 300))
    } catch {
      // ignore
    }
  }, [characterId, userCard])

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
        <header className="uiTopbar">
          <div className="uiTopbarInner">
            <div className="uiTitleRow">
              <h1 className="uiTitle">聊天</h1>
            </div>
          </div>
        </header>
        <main className="uiMain">
          <div className="uiSkeleton">加载中...</div>
        </main>
      </div>
    )
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">{title || '聊天'}</h1>
              <span className="uiBadge">m2-her</span>
            </div>
            <p className="uiSubtitle">对话会自动保存。旁白请用括号输入。</p>
          </div>

          <div className="uiActions">
            <button
              className="uiBtn uiBtnGhost"
              onClick={() => {
                setShowUserCard(true)
              }}
            >
              身份卡
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              返回角色
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {patchOk === false && patchError && <div className="uiAlert uiAlertErr">PatchScribe: {patchError}</div>}

        <div
          ref={listRef}
          onScroll={() => {
            const el = listRef.current
            if (!el) return
            if (el.scrollTop < 80) loadOlderMessages()
          }}
          style={{
            height: '62vh',
            overflow: 'auto',
            border: '1px solid rgba(0,0,0,.08)',
            borderRadius: 18,
            padding: 16,
            background: 'rgba(250,246,255,.35)',
            marginTop: 12,
          }}
        >
          {loadingHistory && <div className="uiHint">正在加载聊天记录...</div>}
          {!loadingHistory && hasMore && <div className="uiHint">上滑加载更早的聊天记录</div>}
          {loadingOlder && <div className="uiHint">加载更早...</div>}

          {messages.length === 0 && (
            <div className="uiEmpty" style={{ marginTop: 0 }}>
              <div className="uiEmptyTitle">开始对话</div>
              <div className="uiEmptyDesc">先打个招呼，或用括号旁白来导演剧情。</div>
            </div>
          )}

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

              <div className={`chatBubble ${m.role === 'user' ? 'chatBubbleUser' : 'chatBubbleAssistant'}`}>{m.content}</div>

              {m.role === 'user' && (
                <div className="uiAvatar" aria-hidden="true">
                  <div className="uiAvatarFallback">我</div>
                </div>
              )}
            </div>
          ))}
        </div>

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
      </main>

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
