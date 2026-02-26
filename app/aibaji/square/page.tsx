'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Sparkles, Heart, Search, SlidersHorizontal, MessageCircle, Loader } from 'lucide-react'

type Character = {
  id: string
  name: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  created_at?: string
}

type AssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type SortMode = 'newest' | 'name' | 'gender_f' | 'gender_m'
type Alert = { type: 'ok' | 'err'; text: string } | null

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

function getCharacterMeta(c: Character) {
  const p = asRecord(c.profile)
  const gender = getStr(p, 'gender') || getStr(p, 'sex')
  const age = getStr(p, 'age')
  const occupation = getStr(p, 'occupation')
  const org = getStr(p, 'organization')
  const intro = getStr(p, 'summary') || getStr(p, 'occupation') || getStr(p, 'introduction') || getStr(p, 'description')
  return { gender, age, occupation, org, intro }
}

export default function SquarePage() {
  const router = useRouter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('newest')
  const [showFilters, setShowFilters] = useState(false)
  const [unlockingId, setUnlockingId] = useState('')
  const [alert, setAlert] = useState<Alert>(null)
  const [unlockedSourceIds, setUnlockedSourceIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (alert) {
      const t = setTimeout(() => setAlert(null), 2500)
      return () => clearTimeout(t)
    }
  }, [alert])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('characters')
        .select('id,name,profile,settings,created_at')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error || !data) { setLoading(false); return }
      const chars = data as Character[]
      setCharacters(chars)

      // Check which characters user has already unlocked
      const { data: userData } = await supabase.auth.getUser()
      if (userData.user?.id) {
        const { data: myChars } = await supabase
          .from('characters')
          .select('settings')
          .eq('user_id', userData.user.id)
          .limit(200)
        if (myChars) {
          const sourceIds = new Set<string>()
          for (const mc of myChars) {
            const s = asRecord(mc.settings)
            const sid = typeof s.source_character_id === 'string' ? s.source_character_id : ''
            if (sid) sourceIds.add(sid)
          }
          setUnlockedSourceIds(sourceIds)
        }
      }

      const ids = chars.map((c) => c.id)
      if (!ids.length) { setLoading(false); return }
      const { data: assets, error: ae } = await supabase
        .from('character_assets')
        .select('character_id,kind,storage_path,created_at')
        .in('character_id', ids)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(400)
      if (!ae && assets) {
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
        setImgById(map)
      }
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    let list = [...characters]

    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((c) => {
        const { gender, occupation, org, intro } = getCharacterMeta(c)
        return (
          c.name.toLowerCase().includes(q) ||
          gender.toLowerCase().includes(q) ||
          occupation.toLowerCase().includes(q) ||
          org.toLowerCase().includes(q) ||
          intro.toLowerCase().includes(q)
        )
      })
    }

    // Sort
    if (sort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    } else if (sort === 'gender_f') {
      list = list.filter((c) => {
        const g = getCharacterMeta(c).gender
        return g === '女' || g.toLowerCase() === 'female'
      })
    } else if (sort === 'gender_m') {
      list = list.filter((c) => {
        const g = getCharacterMeta(c).gender
        return g === '男' || g.toLowerCase() === 'male'
      })
    }
    // 'newest' is already the default order from DB

    return list
  }, [characters, search, sort])

  const stats = useMemo(() => {
    const total = characters.length
    const unlocked = characters.filter((c) => unlockedSourceIds.has(c.id)).length
    return { total, unlocked, locked: total - unlocked }
  }, [characters, unlockedSourceIds])

  const handleUnlockAndChat = async (sourceCharacterId: string) => {
    if (unlockingId) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) { router.push('/login'); return }
    setUnlockingId(sourceCharacterId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/aibaji/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceCharacterId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.localCharacterId) {
        setAlert({ type: 'err', text: json.error || '解锁失败' })
        return
      }
      setUnlockedSourceIds((prev) => new Set([...prev, sourceCharacterId]))
      setAlert({ type: 'ok', text: '解锁成功' })
      router.push(`/aibaji/chat/${json.localCharacterId}`)
    } catch {
      setAlert({ type: 'err', text: '网络错误' })
    } finally {
      setUnlockingId('')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 pb-[72px] md:pb-8">
      {/* Alert */}
      {alert && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg border backdrop-blur-xl ${
            alert.type === 'ok'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          {alert.text}
        </div>
      )}

      {/* Banner */}
      <div className="mx-4 mt-6 mb-6">
        <div className="h-[260px] md:h-[340px] rounded-[2.5rem] bg-zinc-900 p-8 md:p-12 flex flex-col justify-end relative overflow-hidden shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent opacity-90" />
          <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
              <span className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-300">
                Public Characters
              </span>
              <Sparkles className="w-3 h-3 text-pink-400" />
            </div>

            <h1 className="text-4xl font-black tracking-tighter leading-none mb-2">
              <span className="text-white">遇见你的</span>
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">
                赛博灵魂
              </span>
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              探索无限可能的 AI 角色宇宙，与他们建立独一无二的羁绊。
            </p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="px-5 md:px-8 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
            <Heart className="w-4 h-4 text-pink-500" />
          </div>
          <h2 className="text-xl font-black text-white">发现角色</h2>
        </div>
        <div className="flex gap-2 ml-auto">
          <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/50 text-[10px] font-bold text-zinc-400">
            共 {stats.total}
          </span>
          {stats.unlocked > 0 && (
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400">
              已解锁 {stats.unlocked}
            </span>
          )}
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="px-4 md:px-8 mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/50 transition-all">
            <Search className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              className="flex-1 bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              placeholder="搜索角色名、职业、简介..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-all ${
              showFilters
                ? 'bg-pink-500/10 border-pink-500/30 text-pink-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2">
            {([
              ['newest', '最新发布'],
              ['name', '角色名'],
              ['gender_f', '女性角色'],
              ['gender_m', '男性角色'],
            ] as [SortMode, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  sort === key
                    ? 'bg-pink-500/15 text-pink-400 border border-pink-500/30'
                    : 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="px-4 md:px-8 pb-8">
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-[2rem] overflow-hidden bg-zinc-900 shadow-2xl">
                <div className="bg-zinc-800 animate-pulse" style={{ aspectRatio: '3/4' }} />
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-zinc-800 rounded-full w-3/4 animate-pulse" />
                  <div className="h-2 bg-zinc-800 rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-zinc-600" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              {search.trim() ? '没有匹配的角色' : '广场暂时没有公开角色'}
            </p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((c) => {
              const { gender, age, intro } = getCharacterMeta(c)
              const imgUrl = imgById[c.id]
              const isUnlocked = unlockedSourceIds.has(c.id)
              const isUnlocking = unlockingId === c.id

              return (
                <div
                  key={c.id}
                  className="flex flex-col bg-zinc-900 rounded-[2rem] overflow-hidden group shadow-2xl"
                >
                  {/* Image area - clickable to detail */}
                  <button
                    className="text-left relative overflow-hidden"
                    style={{ aspectRatio: '3/4' }}
                    onClick={() => router.push(`/aibaji/square/${c.id}`)}
                  >
                    {imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imgUrl}
                        alt={c.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                        <span className="text-5xl font-black text-pink-500/30">
                          {c.name?.[0] || '?'}
                        </span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90" />

                    {/* Status badge */}
                    {isUnlocked && (
                      <div className="absolute top-3 right-3 z-10">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-[8px] font-bold text-emerald-400">
                          已解锁
                        </span>
                      </div>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <div className="flex flex-wrap gap-1 mb-2">
                        {[gender, age ? `${age}岁` : ''].filter(Boolean).map((tag, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-full bg-white/10 backdrop-blur-xl text-[9px] text-white border border-white/10"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <h3 className="text-xl font-black text-white drop-shadow-lg truncate">
                        {c.name}
                      </h3>

                      {intro && (
                        <p className="text-[11px] text-zinc-300 line-clamp-2 leading-snug mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          {intro}
                        </p>
                      )}
                    </div>
                  </button>

                  {/* Action bar */}
                  <div className="p-3 flex gap-2">
                    {isUnlocked ? (
                      <button
                        onClick={() => {
                          // For unlocked chars, the start-chat API will find existing local copy
                          void handleUnlockAndChat(c.id)
                        }}
                        disabled={isUnlocking}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-bold transition-all hover:bg-pink-500/20 active:scale-95 disabled:opacity-50"
                      >
                        {isUnlocking ? (
                          <Loader className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <MessageCircle className="w-3.5 h-3.5" />
                        )}
                        {isUnlocking ? '...' : '对话'}
                      </button>
                    ) : (
                      <button
                        onClick={() => { void handleUnlockAndChat(c.id) }}
                        disabled={isUnlocking}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white text-xs font-bold transition-all hover:from-pink-500 hover:to-purple-500 active:scale-95 disabled:opacity-50 shadow-lg shadow-pink-900/20"
                      >
                        {isUnlocking ? (
                          <Loader className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Heart className="w-3.5 h-3.5" />
                        )}
                        {isUnlocking ? '解锁中...' : '解锁并聊天'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
