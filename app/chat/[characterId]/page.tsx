'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Msg = { role: 'user' | 'assistant'; content: string }

export default function ChatPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>('')
  const [title, setTitle] = useState<string>('')

  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')

  const listRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError('')

      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.replace('/login')
        return
      }

      // 取角色名（RLS 会限制只能读自己的角色）
      const { data: c, error: ce } = await supabase
        .from('characters')
        .select('name')
        .eq('id', characterId)
        .single()

      if (ce || !c) {
        setError('角色不存在或无权限')
        setLoading(false)
        return
      }
      setTitle(c.name)

      setLoading(false)
    }

    init()
  }, [characterId, router])

  useEffect(() => {
    // 自动滚动到底部
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!canSend) return

    setSending(true)
    setError('')
    const text = input.trim()
    setInput('')

    // 先把用户消息放进 UI（即时反馈）
    setMessages((prev) => [...prev, { role: 'user', content: text }])

    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) {
      setError('登录态失效，请重新登录')
      setSending(false)
      return
    }

    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        characterId,
        conversationId,
        message: text,
      }),
    })

    if (!resp.ok) {
      const t = await resp.text()
      setError(t)
      setSending(false)
      return
    }

    const data = await resp.json()
    setConversationId(data.conversationId)
    setMessages((prev) => [...prev, { role: 'assistant', content: data.assistantMessage }])
    setSending(false)
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
          <div className="uiSkeleton">加载中…</div>
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
            <p className="uiSubtitle">对话会自动保存</p>
          </div>

          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              返回角色
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {error && (
          <div className="uiToast uiToastErr" style={{ position: 'static', transform: 'none', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div
          ref={listRef}
          style={{
            height: '58vh',
            overflow: 'auto',
            border: '1px solid rgba(0,0,0,.08)',
            borderRadius: 18,
            padding: 16,
            background: 'rgba(250,246,255,.35)',
          }}
        >
          {messages.length === 0 && (
            <div className="uiEmpty" style={{ marginTop: 0 }}>
              <div className="uiEmptyTitle">开始对话</div>
              <div className="uiEmptyDesc">你可以先打个招呼，或直接下达“角色扮演”指令。</div>
            </div>
          )}

          {messages.map((m, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  maxWidth: '78%',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.55,
                  padding: '10px 12px',
                  borderRadius: 14,
                  border: '1px solid rgba(0,0,0,.08)',
                  background: m.role === 'user' ? 'rgba(240,230,255,.92)' : '#fff',
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <input
            className="uiInput"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="uiBtn uiBtnPrimary" disabled={!canSend} onClick={send}>
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      </main>
    </div>
  )
}
