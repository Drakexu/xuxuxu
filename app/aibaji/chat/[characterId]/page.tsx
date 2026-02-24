'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Send, Loader } from 'lucide-react'
import { motion } from 'motion/react'

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

  const scrollToBottom = () => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }

  useEffect(() => { scrollToBottom() }, [messages])

  useEffect(() => {
    if (!characterId) return
    const run = async () => {
      setLoading(true)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { router.push('/login'); return }
      const userId = userData.user.id

      const { data: char, error: charErr } = await supabase
        .from('characters')
        .select('id,name,settings')
        .eq('id', characterId)
        .maybeSingle()
      if (charErr || !char) { setError('角色不存在'); setLoading(false); return }

      const s = asRecord(char.settings)
      const displayName = (typeof s.source_name === 'string' && s.source_name.trim())
        ? s.source_name.trim()
        : String(char.name || '角色')
      setCharacterName(displayName)

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

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader className="w-8 h-8 text-pink-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800/50 flex items-center justify-between px-4 bg-zinc-950/80 backdrop-blur-xl shrink-0">
        <button
          onClick={() => router.push('/aibaji/chat')}
          className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-base font-black tracking-tight">{characterName || '聊天'}</h1>
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Online</span>
        </div>
        <div className="w-10" />
      </header>

      {/* Messages */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 pb-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {messages.length === 0 && !sending && (
          <div className="flex justify-center py-8">
            <span className="text-xs text-zinc-600 font-medium">和 {characterName} 开始聊天吧</span>
          </div>
        )}

        <div className="flex justify-center my-2">
          <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/50 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Today</span>
        </div>

        {messages.map((m, i) => (
          <motion.div
            key={m.id || i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'} max-w-[85%] ${m.role === 'user' ? 'ml-auto' : 'mr-auto'}`}
          >
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-zinc-800 shrink-0 border border-zinc-700/50 flex items-center justify-center mt-1">
                <span className="text-xs font-black text-pink-400">{characterName?.[0] || 'A'}</span>
              </div>
            )}
            <div
              className="px-4 py-3 rounded-2xl text-sm leading-relaxed"
              style={
                m.role === 'user'
                  ? { background: 'linear-gradient(135deg, #ec4899, #a855f7)', color: 'white', borderRadius: '1rem 1rem 0.25rem 1rem' }
                  : { background: '#18181b', border: '1px solid rgba(63,63,70,0.5)', color: '#e4e4e7', borderRadius: '1rem 1rem 1rem 0.25rem' }
              }
            >
              {m.content}
            </div>
          </motion.div>
        ))}

        {sending && (
          <div className="flex gap-3 justify-start max-w-[85%]">
            <div className="w-7 h-7 rounded-full bg-zinc-800 shrink-0 border border-zinc-700/50 flex items-center justify-center mt-1">
              <span className="text-xs font-black text-pink-400">{characterName?.[0] || 'A'}</span>
            </div>
            <div className="px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800/50 flex items-center gap-1.5 h-[44px]" style={{ borderRadius: '1rem 1rem 1rem 0.25rem' }}>
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 mx-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium text-center mb-2">
          {error}
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-end gap-3">
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-[1.5rem] p-1 flex items-end transition-colors focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/50">
            <textarea
              placeholder={`和 ${characterName} 说点什么...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent text-white placeholder:text-zinc-600 px-4 py-3 max-h-32 min-h-[44px] resize-none focus:outline-none text-sm"
              rows={1}
              disabled={sending}
            />
          </div>
          <button
            onClick={() => { void sendMessage() }}
            disabled={!canSend}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white shrink-0 transition-all disabled:opacity-40 active:scale-95"
            style={
              canSend
                ? { background: 'linear-gradient(135deg, #ec4899, #a855f7)', boxShadow: '0 4px 16px rgba(236,72,153,0.3)' }
                : { background: '#27272a' }
            }
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
