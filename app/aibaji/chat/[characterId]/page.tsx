'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Send, ChevronDown, RotateCcw } from 'lucide-react'

type Msg = { id?: string; role: 'user' | 'assistant'; content: string; created_at?: string }
type AssetRow = { kind: string; storage_path: string }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function formatDateSeparator(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function pickAssetPath(rows: AssetRow[]): string {
  const byKind: Record<string, AssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  for (const k of ['cover', 'full_body', 'head']) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

const DRAFT_KEY_PREFIX = 'aibaji:chatDraft:'

export default function ChatWindowPage() {
  const router = useRouter()
  const params = useParams()
  const characterId = String(params?.characterId || '')

  const [characterName, setCharacterName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [showJump, setShowJump] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const canSend = useMemo(() => input.trim().length > 0 && !sending, [input, sending])

  // Load draft from localStorage
  useEffect(() => {
    if (!characterId) return
    try {
      const draft = localStorage.getItem(DRAFT_KEY_PREFIX + characterId)
      if (draft) setInput(draft)
    } catch { /* ignore */ }
  }, [characterId])

  // Persist draft
  useEffect(() => {
    if (!characterId) return
    try {
      if (input.trim()) {
        localStorage.setItem(DRAFT_KEY_PREFIX + characterId, input)
      } else {
        localStorage.removeItem(DRAFT_KEY_PREFIX + characterId)
      }
    } catch { /* ignore */ }
  }, [input, characterId])

  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  // Track scroll position for jump button
  const handleScroll = useCallback(() => {
    if (!listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    setShowJump(scrollHeight - scrollTop - clientHeight > 200)
  }, [])

  // Load character + conversation + messages + avatar
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

      // Load avatar image
      const sourceId = typeof s.source_character_id === 'string' ? s.source_character_id : characterId
      const { data: assets } = await supabase
        .from('character_assets')
        .select('kind,storage_path')
        .eq('character_id', sourceId)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(10)
      if (assets?.length) {
        const path = pickAssetPath(assets as AssetRow[])
        if (path) {
          const signed = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
          if (signed.data?.signedUrl) setAvatarUrl(signed.data.signedUrl)
        }
      }

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
          .limit(80)
        if (msgs) setMessages(msgs as Msg[])
      }
      setLoading(false)
    }
    run().catch(() => { setError('加载失败'); setLoading(false) })
  }, [characterId, router])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || sending || !conversationId) return
    if (!overrideText) setInput('')
    setSending(true)
    setError('')

    try { localStorage.removeItem(DRAFT_KEY_PREFIX + characterId) } catch { /* ignore */ }

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
          { role: 'user', content: text, id: `u-${Date.now()}`, created_at: new Date().toISOString() },
          { role: 'assistant', content: assistantContent, id: `a-${Date.now()}`, created_at: new Date().toISOString() },
        ]
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '网络错误')
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id))
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [input, sending, conversationId, characterId])

  const regenerate = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        void sendMessage(messages[i].content)
        return
      }
    }
  }, [messages, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

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
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800/50 animate-pulse" />
          <div className="text-zinc-500 text-sm font-medium">加载中...</div>
        </div>
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
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400 font-bold">
                {characterName.charAt(0) || 'AI'}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center">
            <span className="text-base font-black tracking-tight text-white">
              {characterName || '聊天'}
            </span>
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
              AI 角色
            </span>
          </div>
        </div>
        <div className="w-10" />
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-900 border border-zinc-800/50 flex items-center justify-center">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl text-zinc-600">💬</span>
              )}
            </div>
            <p className="text-zinc-500 text-sm font-medium">
              开始和 {characterName} 聊天吧
            </p>
            <p className="text-zinc-600 text-xs">发送你的第一条消息</p>
          </div>
        )}

        {messages.map((m, i) => {
          const prevMsg = i > 0 ? messages[i - 1] : undefined
          const showDate = shouldShowDate(m, prevMsg)

          return (
            <div key={m.id || i}>
              {showDate && m.created_at && (
                <div className="flex justify-center my-4">
                  <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/50 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    {formatDateSeparator(m.created_at)}
                  </span>
                </div>
              )}

              {m.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] md:max-w-[70%]">
                    <div className="p-4 rounded-2xl rounded-tr-sm bg-pink-600 text-white text-sm leading-relaxed shadow-lg shadow-pink-900/20 whitespace-pre-wrap">
                      {m.content}
                    </div>
                    {m.created_at && (
                      <div className="text-right mt-1">
                        <span className="text-[9px] text-zinc-600">{formatTime(m.created_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 mt-1">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400 font-bold">
                        {characterName.charAt(0) || 'AI'}
                      </div>
                    )}
                  </div>
                  <div className="max-w-[80%] md:max-w-[70%]">
                    <span className="text-[10px] text-zinc-500 font-bold mb-1 block">
                      {characterName}
                    </span>
                    <div className="p-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                    {m.created_at && (
                      <div className="mt-1">
                        <span className="text-[9px] text-zinc-600">{formatTime(m.created_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {sending && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700/50 shrink-0 mt-1">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400 font-bold">
                  {characterName.charAt(0) || 'AI'}
                </div>
              )}
            </div>
            <div>
              <span className="text-[10px] text-zinc-500 font-bold mb-1 block">
                {characterName}
              </span>
              <div className="p-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms', animationDuration: '0.6s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms', animationDuration: '0.6s' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms', animationDuration: '0.6s' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Jump to bottom */}
      {showJump && (
        <div className="absolute bottom-[140px] md:bottom-[120px] left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={scrollToBottom}
            className="px-4 py-2 rounded-full bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 text-xs font-bold text-zinc-300 flex items-center gap-2 hover:bg-zinc-800 transition-all shadow-xl"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            回到底部
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mb-2 px-4 py-2 rounded-xl bg-red-950/50 border border-red-900/50 text-red-400 text-sm text-center">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 shrink-0">
        {messages.length > 0 && (
          <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
            <button
              onClick={regenerate}
              disabled={sending || messages.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors disabled:opacity-40 shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              重新生成
            </button>
          </div>
        )}

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
        <div className="mt-1.5 px-2 flex items-center justify-between">
          <span className="text-[9px] text-zinc-600">Enter 发送 · Shift+Enter 换行</span>
          <span className="text-[9px] text-zinc-600">{input.length > 0 ? `${input.length} 字` : ''}</span>
        </div>
      </div>
    </div>
  )
}
