'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Heart, MessageCircle, User } from 'lucide-react'

type Character = {
  id: string
  name: string
  system_prompt?: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  visibility?: string | null
}

type AssetRow = { kind: string; storage_path: string; created_at?: string | null }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(r: Record<string, unknown>, k: string): string {
  const v = r[k]
  return typeof v === 'string' ? v.trim() : ''
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

const FAVORITES_KEY = 'aibaji_favorites'

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

function saveFavorites(ids: string[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

export default function CharacterDetailPage() {
  const params = useParams()
  const router = useRouter()
  const characterId = String(params?.characterId || '')

  const [character, setCharacter] = useState<Character | null>(null)
  const [imgUrl, setImgUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [isFavorited, setIsFavorited] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [alert, setAlert] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (alert) {
      const t = setTimeout(() => setAlert(null), 2500)
      return () => clearTimeout(t)
    }
  }, [alert])

  useEffect(() => {
    const favs = loadFavorites()
    setIsFavorited(favs.includes(characterId))
  }, [characterId])

  useEffect(() => {
    if (!characterId) return
    const run = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('characters')
        .select('id,name,system_prompt,profile,settings,visibility')
        .eq('id', characterId)
        .maybeSingle()
      if (error || !data) { setLoading(false); return }
      setCharacter(data as Character)

      const { data: assets, error: ae } = await supabase
        .from('character_assets')
        .select('kind,storage_path,created_at')
        .eq('character_id', characterId)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(20)
      if (!ae && assets) {
        const path = pickAssetPath(assets as AssetRow[])
        if (path) {
          const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
          if (s.data?.signedUrl) setImgUrl(s.data.signedUrl)
        }
      }
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [characterId])

  const toggleFavorite = useCallback(() => {
    const favs = loadFavorites()
    if (isFavorited) {
      saveFavorites(favs.filter((id) => id !== characterId))
      setIsFavorited(false)
      setAlert({ type: 'ok', text: '已取消收藏' })
    } else {
      saveFavorites([...favs.filter((id) => id !== characterId), characterId])
      setIsFavorited(true)
      setAlert({ type: 'ok', text: '已收藏，可在聊天页找到' })
    }
  }, [characterId, isFavorited])

  const startChat = useCallback(async () => {
    if (chatLoading) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) {
      router.push('/login')
      return
    }
    setChatLoading(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/aibaji/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceCharacterId: characterId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.localCharacterId) {
        setAlert({ type: 'err', text: json.error || '启动失败，请重试' })
        return
      }
      router.push(`/aibaji/chat/${json.localCharacterId}`)
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : '网络错误' })
    } finally {
      setChatLoading(false)
    }
  }, [characterId, chatLoading, router])

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 text-lg font-medium tracking-wide">加载中...</div>
      </div>
    )
  }

  /* ── Error state ── */
  if (!character) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="p-8 rounded-[2.5rem] bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 shadow-2xl text-center space-y-6 max-w-md w-full">
          <div className="text-white text-lg font-semibold">角色不存在或已被删除</div>
          <button
            onClick={() => router.push('/aibaji/square')}
            className="w-full py-4 rounded-[2rem] bg-gradient-to-r from-pink-600 to-purple-600 text-white font-black uppercase tracking-widest shadow-[0_0_30px_rgba(236,72,153,0.3)] hover:shadow-[0_0_40px_rgba(236,72,153,0.5)] transition-all"
          >
            回到广场
          </button>
        </div>
      </div>
    )
  }

  const p = asRecord(character.profile)
  const gender = getStr(p, 'gender') || getStr(p, 'sex')
  const age = getStr(p, 'age')
  const occupation = getStr(p, 'occupation')
  const org = getStr(p, 'organization')
  const summary = getStr(p, 'summary') || getStr(p, 'introduction') || getStr(p, 'description')
  const personality = getStr(p, 'personality') || getStr(p, 'personality_summary')

  const metaItems = [
    gender && `${gender}`,
    age && `${age}岁`,
    occupation,
    org,
  ].filter(Boolean)

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 text-white pb-[72px] md:pb-0">
      {/* ── Back button ── */}
      <button
        onClick={() => router.back()}
        className="absolute top-6 left-6 z-20 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      {/* ── Alert toast ── */}
      {alert && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl backdrop-blur-xl border text-sm font-medium shadow-2xl transition-all ${
            alert.type === 'err'
              ? 'bg-red-500/20 border-red-500/30 text-red-300'
              : 'bg-zinc-900/80 border-zinc-700/50 text-white'
          }`}
        >
          {alert.text}
        </div>
      )}

      {/* ── Hero image section ── */}
      <div className="h-[55vh] md:h-[65vh] relative">
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="absolute inset-0 w-full h-full object-cover"
            src={imgUrl}
            alt={character.name}
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-zinc-900 flex items-center justify-center">
            <User className="w-24 h-24 text-zinc-700" />
          </div>
        )}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-transparent to-transparent" />
      </div>

      {/* ── Content area ── */}
      <div className="-mt-40 relative z-10 space-y-10 pb-32 px-6 md:px-12 max-w-4xl mx-auto">
        {/* Name + favorite row */}
        <div className="flex items-end justify-between gap-4">
          <h1 className="text-6xl font-black tracking-tighter drop-shadow-2xl text-white leading-none">
            {character.name}
          </h1>
          <button
            onClick={toggleFavorite}
            className={`w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center border transition-all ${
              isFavorited
                ? 'bg-pink-500 border-pink-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.4)]'
                : 'bg-zinc-900/80 backdrop-blur-xl border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Heart className={`w-6 h-6 ${isFavorited ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Meta tags */}
        {metaItems.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {metaItems.map((item, i) => (
              <span
                key={i}
                className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl text-xs font-black tracking-widest uppercase text-white border border-white/10"
              >
                {item}
              </span>
            ))}
          </div>
        )}

        {/* Info card */}
        {(summary || personality) && (
          <div className="p-8 rounded-[2.5rem] bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 space-y-6 shadow-2xl">
            {summary && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                    <User className="w-4 h-4 text-pink-500" />
                  </div>
                  <span className="text-sm font-bold text-zinc-300 tracking-wide uppercase">简介</span>
                </div>
                <p className="text-zinc-300 leading-relaxed text-[15px]">{summary}</p>
              </div>
            )}
            {personality && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
                    <Heart className="w-4 h-4 text-pink-500" />
                  </div>
                  <span className="text-sm font-bold text-zinc-300 tracking-wide uppercase">性格</span>
                </div>
                <p className="text-zinc-300 leading-relaxed text-[15px]">{personality}</p>
              </div>
            )}
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={() => { void startChat() }}
          disabled={chatLoading}
          className="w-full py-5 rounded-[2rem] bg-gradient-to-r from-pink-600 to-purple-600 text-white font-black uppercase tracking-widest shadow-[0_0_30px_rgba(236,72,153,0.3)] hover:shadow-[0_0_40px_rgba(236,72,153,0.5)] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          <MessageCircle className="w-5 h-5" />
          {chatLoading ? '启动中...' : '开始聊天'}
        </button>
      </div>
    </div>
  )
}
