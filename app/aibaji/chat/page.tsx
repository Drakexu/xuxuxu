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
        className="w-full text-left flex items-center gap-4 px-4 py-3.5 bg-white border border-zinc-100 rounded-2xl shadow-sm hover:border-pink-200 hover:shadow-[0_8px_24px_rgba(236,72,153,0.07)] active:scale-[0.98] transition-all disabled:opacity-60"
      >
        {/* Avatar */}
        <div className="w-14 h-14 flex-shrink-0 rounded-[1rem] overflow-hidden bg-gradient-to-br from-pink-50 to-zinc-50 border border-zinc-100 flex items-center justify-center">
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={c.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xl font-black" style={{ color: '#EC4899', opacity: 0.4 }}>
              {c.name?.[0] || '?'}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-black text-zinc-900 truncate">{c.name}</span>
          </div>
          {(gender || age) && (
            <p className="text-[10px] text-zinc-400 font-medium mb-1">
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
            <Loader className="w-4 h-4 text-[#EC4899] animate-spin" />
          ) : dest ? (
            <ChevronRight className="w-4 h-4 text-zinc-300" />
          ) : (
            <span className="text-[9px] font-black uppercase tracking-widest text-[#EC4899] bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-100">
              聊天
            </span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Banner */}
      <div className="px-5 pt-8 pb-6 bg-gradient-to-br from-pink-50/80 to-[#FBFBFA] border-b border-zinc-100/60">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#EC4899] animate-pulse" />
          <span className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
            My Companions
          </span>
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-zinc-900 leading-none mb-2">聊天</h1>
        <p className="text-xs font-medium text-zinc-400">收藏的角色和进行中的对话</p>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 px-4 pt-4 pb-2">
        {(['favorites', 'active'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
            style={
              tab === t
                ? { background: '#EC4899', color: 'white', boxShadow: '0 4px 16px rgba(236,72,153,0.2)' }
                : { background: 'rgba(0,0,0,0.04)', color: '#A1A1AA' }
            }
          >
            {t === 'favorites' ? '收藏' : '正在聊天'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2.5 px-4 pt-2 pb-4">
        {tab === 'favorites' && (
          <>
            {favoriteChars.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-pink-50 border border-pink-100 flex items-center justify-center">
                  <Heart className="w-6 h-6 text-[#EC4899] opacity-50" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">还没有收藏的角色</p>
                  <p className="text-[11px] text-zinc-400">去广场发现喜欢的角色，点击收藏</p>
                </div>
                <button
                  onClick={() => router.push('/aibaji/square')}
                  className="px-6 py-2.5 rounded-xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-colors"
                >
                  去广场 →
                </button>
              </div>
            ) : (
              favoriteChars.map((c) => renderCharCard(c))
            )}
          </>
        )}

        {tab === 'active' && (
          <>
            {!isLoggedIn ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-100 border border-zinc-200 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-zinc-400" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">请先登录</p>
                  <p className="text-[11px] text-zinc-400">登录后查看你的对话记录</p>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="px-6 py-2.5 rounded-xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-colors"
                >
                  去登录 →
                </button>
              </div>
            ) : loading ? (
              <div className="flex flex-col gap-2.5 pt-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5 bg-white border border-zinc-100 rounded-2xl animate-pulse">
                    <div className="w-14 h-14 rounded-[1rem] bg-zinc-100 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-zinc-100 rounded-full w-1/3" />
                      <div className="h-2.5 bg-zinc-100 rounded-full w-1/4" />
                      <div className="h-2 bg-zinc-100 rounded-full w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activeChars.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-[1.25rem] bg-pink-50 border border-pink-100 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-[#EC4899] opacity-50" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-xs font-black uppercase tracking-widest text-zinc-500">还没有进行中的聊天</p>
                  <p className="text-[11px] text-zinc-400">在广场选择一个角色，开始对话</p>
                </div>
                <button
                  onClick={() => router.push('/aibaji/square')}
                  className="px-6 py-2.5 rounded-xl bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-colors"
                >
                  去广场 →
                </button>
              </div>
            ) : (
              activeChars.map(({ char, localId }) => renderCharCard(char, localId))
            )}
          </>
        )}
      </div>
    </div>
  )
}
