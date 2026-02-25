'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Heart, MessageCircle, ChevronRight, Loader } from 'lucide-react'

type Character = {
  id: string
  name: string
  profile?: Record<string, unknown>
}

type AssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type ChatTab = 'favorites' | 'active'

const FAVORITES_KEY = 'aibaji_favorites'

function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

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

async function fetchImgUrls(chars: Character[]): Promise<Record<string, string>> {
  const ids = chars.map((c) => c.id).filter(Boolean)
  if (!ids.length) return {}
  const { data: assets, error } = await supabase
    .from('character_assets')
    .select('character_id,kind,storage_path,created_at')
    .in('character_id', ids)
    .in('kind', ['cover', 'full_body', 'head'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !assets) return {}
  const grouped: Record<string, AssetRow[]> = {}
  for (const row of assets as AssetRow[]) {
    if (!row.character_id) continue
    if (!grouped[row.character_id]) grouped[row.character_id] = []
    grouped[row.character_id].push(row)
  }
  const entries = Object.entries(grouped)
    .map(([cid, rs]) => [cid, pickAssetPath(rs)] as const)
    .filter(([, p]) => !!p)
  const signed = await Promise.all(
    entries.map(async ([cid, path]) => {
      const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
      return [cid, s.data?.signedUrl || ''] as const
    }),
  )
  const map: Record<string, string> = {}
  for (const [cid, url] of signed) if (url) map[cid] = url
  return map
}

export default function ChatHubPage() {
  const router = useRouter()
  const [tab, setTab] = useState<ChatTab>('favorites')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [favoriteChars, setFavoriteChars] = useState<Character[]>([])
  const [activeChars, setActiveChars] = useState<{ char: Character; localId: string }[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState('')

  useEffect(() => {
    const run = async () => {
      const { data: userData } = await supabase.auth.getUser()
      setIsLoggedIn(!!userData.user?.id)

      const ids = loadFavoriteIds()
      if (ids.length) {
        const { data, error } = await supabase
          .from('characters')
          .select('id,name,profile')
          .in('id', ids)
          .eq('visibility', 'public')
        if (!error && data) {
          const byId: Record<string, Character> = {}
          for (const c of data as Character[]) byId[c.id] = c
          setFavoriteChars(ids.filter((id) => byId[id]).map((id) => byId[id]))
        }
      }
    }
    run().catch(() => {})
  }, [])

  useEffect(() => {
    if (tab !== 'active') return
    const run = async () => {
      setLoading(true)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { setLoading(false); return }
      const userId = userData.user.id

      const { data: myChars, error } = await supabase
        .from('characters')
        .select('id,name,profile,settings')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)
      if (error || !myChars) { setLoading(false); return }

      const charIds = (myChars as Character[]).map((c) => c.id)
      if (!charIds.length) { setLoading(false); return }
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('id,character_id,created_at')
        .eq('user_id', userId)
        .in('character_id', charIds)
        .order('created_at', { ascending: false })
        .limit(60)
      if (convErr) { setLoading(false); return }

      const seenChars = new Set<string>()
      const result: { char: Character; localId: string }[] = []
      for (const conv of (convs ?? []) as Array<{ id: string; character_id: string }>) {
        if (seenChars.has(conv.character_id)) continue
        seenChars.add(conv.character_id)
        const char = (myChars as Character[]).find((c) => c.id === conv.character_id)
        if (char) {
          const s = asRecord((char as unknown as Record<string, unknown>).settings)
          const sourceName = getStr(s, 'source_name')
          const displayChar = sourceName ? { ...char, name: sourceName } : char
          result.push({ char: displayChar, localId: char.id })
        }
      }
      setActiveChars(result)
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [tab])

  useEffect(() => {
    const allChars = [
      ...favoriteChars,
      ...activeChars.map((a) => a.char),
    ]
    if (!allChars.length) return
    fetchImgUrls(allChars).then(setImgById).catch(() => {})
  }, [favoriteChars, activeChars])

  const handleStartChat = async (sourceCharacterId: string) => {
    if (chatLoading) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) { router.push('/login'); return }
    setChatLoading(sourceCharacterId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/aibaji/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceCharacterId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.localCharacterId) return
      router.push(`/aibaji/chat/${json.localCharacterId}`)
    } catch { /* ignore */ } finally {
      setChatLoading('')
    }
  }

  const renderFavoriteCard = (c: Character) => {
    const imgUrl = imgById[c.id]
    const isLoading = chatLoading === c.id

    return (
      <button
        key={c.id}
        onClick={() => void handleStartChat(c.id)}
        disabled={isLoading}
        className="group relative aspect-[3/4] rounded-[1.5rem] overflow-hidden shadow-xl disabled:opacity-60 transition-all"
      >
        <div className="absolute inset-0 border-2 border-transparent group-hover:border-pink-500/30 rounded-[1.5rem] z-20 transition-colors" />
        {imgUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt={c.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-zinc-800 flex items-center justify-center">
            <span className="text-3xl font-black text-pink-500/40">
              {c.name?.[0] || '?'}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-80 z-10" />
        <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
          <p className="text-base font-black text-zinc-300 group-hover:text-white truncate transition-colors">
            {c.name}
          </p>
        </div>
        {isLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
            <Loader className="w-6 h-6 text-pink-500 animate-spin" />
          </div>
        )}
      </button>
    )
  }

  const renderCharCard = (c: Character, localId?: string) => {
    const p = asRecord(c.profile)
    const gender = getStr(p, 'gender') || getStr(p, 'sex')
    const age = getStr(p, 'age')
    const intro = getStr(p, 'summary') || getStr(p, 'occupation')
    const imgUrl = imgById[localId || c.id] || imgById[c.id]
    const dest = localId ? `/aibaji/chat/${localId}` : null
    const isLoading = chatLoading === c.id

    return (
      <button
        key={localId || c.id}
        onClick={() => {
          if (dest) { router.push(dest); return }
          void handleStartChat(c.id)
        }}
        disabled={isLoading}
        className="w-full text-left flex items-center gap-4 px-4 py-3.5 bg-zinc-900 border border-zinc-800/50 rounded-2xl hover:border-pink-500/30 active:scale-[0.98] transition-all disabled:opacity-60"
      >
        {/* Avatar */}
        <div className="w-14 h-14 flex-shrink-0 rounded-[1rem] overflow-hidden bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={c.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-black text-pink-500/40">
              {c.name?.[0] || '?'}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-black text-white truncate">{c.name}</span>
          </div>
          {(gender || age) && (
            <p className="text-[10px] text-zinc-500 font-medium mb-1">
              {[gender, age ? `${age}岁` : ''].filter(Boolean).join(' · ')}
            </p>
          )}
          {intro && (
            <p className="text-[11px] text-zinc-400 line-clamp-1 leading-snug">{intro}</p>
          )}
        </div>

        {/* Right indicator */}
        <div className="flex-shrink-0">
          {isLoading ? (
            <Loader className="w-4 h-4 text-pink-500 animate-spin" />
          ) : dest ? (
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          ) : (
            <span className="text-[9px] font-black uppercase tracking-widest bg-pink-500/10 text-pink-500 border border-pink-500/20 px-2.5 py-1 rounded-lg">
              聊天
            </span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950">
      {/* Tab Header */}
      <div className="px-6 py-4 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-xl">
        <div className="flex gap-6">
          {(['favorites', 'active'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative pb-3 transition-colors"
            >
              <span
                className={`text-xl font-black tracking-tight transition-colors ${
                  tab === t ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                {t === 'favorites' ? '收藏' : '正在聊天'}
              </span>
              {tab === t && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-pink-500 to-purple-500 rounded-t-full shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pt-4 pb-4">
        {tab === 'favorites' && (
          <>
            {favoriteChars.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Heart className="w-6 h-6 text-zinc-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">还没有收藏的角色</p>
                  <p className="text-[11px] text-zinc-600">去广场发现喜欢的角色，点击收藏</p>
                </div>
                <button
                  onClick={() => router.push('/aibaji/square')}
                  className="px-6 py-2.5 rounded-xl bg-pink-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-pink-500 transition-colors"
                >
                  去广场 →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {favoriteChars.map((c) => renderFavoriteCard(c))}
              </div>
            )}
          </>
        )}

        {tab === 'active' && (
          <>
            {!isLoggedIn ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-zinc-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">请先登录</p>
                  <p className="text-[11px] text-zinc-600">登录后查看你的对话记录</p>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="px-6 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-900 transition-colors"
                >
                  去登录 →
                </button>
              </div>
            ) : loading ? (
              <div className="flex flex-col gap-2.5 pt-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5 bg-zinc-900 border border-zinc-800/50 rounded-2xl animate-pulse">
                    <div className="w-14 h-14 rounded-[1rem] bg-zinc-800 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-zinc-800 rounded-full w-1/3" />
                      <div className="h-2.5 bg-zinc-800 rounded-full w-1/4" />
                      <div className="h-2 bg-zinc-800 rounded-full w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activeChars.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-zinc-500" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">还没有进行中的聊天</p>
                  <p className="text-[11px] text-zinc-600">在广场选择一个角色，开始对话</p>
                </div>
                <button
                  onClick={() => router.push('/aibaji/square')}
                  className="px-6 py-2.5 rounded-xl bg-pink-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-pink-500 transition-colors"
                >
                  去广场 →
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activeChars.map(({ char, localId }) => renderCharCard(char, localId))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
