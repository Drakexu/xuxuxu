'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Send } from 'lucide-react'

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; created_at?: string }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function formatDateSeparator(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
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

  // Helper: check if we should show a date separator before this message
  const shouldShowDate = (msg: Msg, prevMsg?: Msg): boolean => {
    if (!msg.created_at) return false
    if (!prevMsg?.created_at) return true
    const d1 = new Date(prevMsg.created_at).toDateString()
    const d2 = new Date(msg.created_at).toDateString()
    return d1 !== d2
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="text-zinc-500 text-sm font-medium">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-950" style={{ height: 0, minHeight: '100%' }}>
      {/* Header */}
      <div className="h-16 border-b border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-950/80 backdrop-blur-xl shrink-0">
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
          onClick={() => router.push('/aibaji/chat')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-base font-black tracking-tight text-white">
            {characterName || '聊天'}
          </span>
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
            AI 角色
          </span>
        </div>
        <div className="w-10" />
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800/50 flex items-center justify-center">
              <span className="text-2xl text-zinc-600">💬</span>
            </div>
            <p className="text-zinc-500 text-sm font-medium">
              开始和 {characterName} 聊天吧
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : undefined
          const showDate = shouldShowDate(m, prevMsg)

          return (
            <div key={m.id || i}>
              {/* Date separator */}
              {showDate && m.created_at && (
                <div className="flex justify-center my-4">
                  <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/50 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    {formatDateSeparator(m.created_at)}
                  </span>
                </div>
              )}

              {/* Message */}
              {m.role === 'user' ? (
                /* User message - right aligned */
                <div className="flex justify-end">
                  <div className="max-w-[75%]">
                    <div className="p-4 rounded-2xl rounded-tr-sm bg-pink-600 text-white text-sm leading-relaxed shadow-lg shadow-pink-900/20">
                      {m.content}
                    </div>
                  </div>
                </div>
              ) : (
                /* Assistant message - left aligned with avatar */
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-xs text-zinc-400 font-bold">
                      {characterName.charAt(0) || 'AI'}
                    </span>
                  </div>
                  <div className="max-w-[75%]">
                    <span className="text-[10px] text-zinc-500 font-bold mb-1 block">
                      {characterName}
                    </span>
                    <div className="p-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 text-zinc-100 text-sm leading-relaxed">
                      {m.content}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Typing indicator */}
        {sending && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0 mt-1">
              <span className="text-xs text-zinc-400 font-bold">
                {characterName.charAt(0) || 'AI'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 font-bold mb-1 block">
                {characterName}
              </span>
              <div className="p-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '0ms', animationDuration: '0.6s' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '150ms', animationDuration: '0.6s' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: '300ms', animationDuration: '0.6s' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-xl bg-red-950/50 border border-red-900/50 text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 shrink-0">
        <div className="bg-zinc-900 border border-zinc-800 rounded-[1.5rem] p-1 flex items-end gap-2 focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/50 transition-all">
          <textarea
            className="flex-1 bg-transparent text-white placeholder:text-zinc-500 px-4 py-3 focus:outline-none text-sm resize-none max-h-32"
            placeholder={`和 ${characterName} 说点什么...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={sending}
          />
          <button
            className="w-12 h-12 rounded-full bg-pink-600 text-white hover:bg-pink-500 shadow-lg shadow-pink-900/20 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:hover:bg-pink-600 transition-colors"
            onClick={() => { void sendMessage() }}
            disabled={!canSend}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
