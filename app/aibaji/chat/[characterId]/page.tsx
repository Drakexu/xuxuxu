'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; created_at?: string }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export default function ChatWindowPage() {
  const router = useRouter()
  const params = useParams()
  const characterId = String(params?.characterId || '')

  const [characterName, setCharacterName] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])

  // Scroll to bottom
  const scrollToBottom = () => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }

  useEffect(() => { scrollToBottom() }, [messages])

  // Load character + conversation + messages
  useEffect(() => {
    if (!characterId) return
    const run = async () => {
      setLoading(true)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { router.push('/login'); return }
      const userId = userData.user.id

      // Get character
      const { data: char, error: charErr } = await supabase
        .from('characters')
        .select('id,name,settings')
        .eq('id', characterId)
        .maybeSingle()
      if (charErr || !char) { setError('角色不存在'); setLoading(false); return }

      // Get display name (use source if available)
      const s = asRecord(char.settings)
      const displayName = (typeof s.source_name === 'string' && s.source_name.trim())
        ? s.source_name.trim()
        : String(char.name || '角色')
      setCharacterName(displayName)

      // Get or verify conversation
      let convId = ''
      const { data: convs } = await supabase
        .from('conversations')
        .select('id,created_at')
        .eq('user_id', userId)
        .eq('character_id', characterId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (convs?.length) {
        convId = convs[0].id
      } else {
        const { data: newConv } = await supabase
          .from('conversations')
          .insert({ user_id: userId, character_id: characterId, title: displayName })
          .select('id')
          .single()
        if (newConv?.id) convId = newConv.id
      }
      setConversationId(convId)

      if (convId) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('id,role,content,created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })
          .limit(60)
        if (msgs) setMessages(msgs as Msg[])
      }
      setLoading(false)
    }
    run().catch(() => { setError('加载失败'); setLoading(false) })
  }, [characterId, router])

  const sendMessage = async () => {
    if (!canSend || !conversationId) return
    const text = input.trim()
    setInput('')
    setSending(true)
    setError('')

    const optimisticMsg: Msg = { role: 'user', content: text, id: `opt-${Date.now()}` }
    setMessages((prev) => [...prev, optimisticMsg])

    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          characterId,
          conversationId,
          message: text,
          inputEvent: 'TALK_HOLD',
        }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        setError(json.error || '发送失败')
        // Remove optimistic message
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
        setInput(text)
        return
      }
      const assistantContent = String(json.assistantMessage || '')
      setMessages((prev) => {
        const withoutOpt = prev.filter((m) => m.id !== optimisticMsg.id)
        return [
          ...withoutOpt,
          { role: 'user', content: text, id: `u-${Date.now()}` },
          { role: 'assistant', content: assistantContent, id: `a-${Date.now()}` },
        ]
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '网络错误')
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  if (loading) return <div className="chatWindowLoading">加载中...</div>

  return (
    <div className="chatWindow">
      {/* 顶部栏 */}
      <div className="chatWindowHeader">
        <button className="chatWindowBack" onClick={() => router.push('/aibaji/chat')}>
          ←
        </button>
        <span className="chatWindowName">{characterName || '聊天'}</span>
        <div style={{ width: 40 }} />
      </div>

      {/* 消息列表 */}
      <div className="chatWindowMessages" ref={listRef}>
        {messages.length === 0 && !sending && (
          <div className="chatWindowEmpty">开始和 {characterName} 聊天吧</div>
        )}
        {messages.map((m, i) => (
          <div key={m.id || i} className={`chatMsg${m.role === 'user' ? ' chatMsgUser' : ' chatMsgAssistant'}`}>
            <div className="chatMsgBubble">{m.content}</div>
          </div>
        ))}
        {sending && (
          <div className="chatMsg chatMsgAssistant">
            <div className="chatMsgBubble chatMsgTyping">···</div>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && <div className="chatWindowError">{error}</div>}

      {/* 输入框 */}
      <div className="chatWindowInput">
        <textarea
          className="chatWindowTextarea"
          placeholder={`和 ${characterName} 说点什么...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={sending}
        />
        <button
          className="chatWindowSendBtn"
          onClick={() => { void sendMessage() }}
          disabled={!canSend}
        >
          {sending ? '···' : '发送'}
        </button>
      </div>
    </div>
  )
}
