'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Sparkles, Heart } from 'lucide-react'

type Character = {
  id: string
  name: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
}

type AssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

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
  const intro = getStr(p, 'summary') || getStr(p, 'occupation') || getStr(p, 'introduction') || getStr(p, 'description')
  return { gender, age, intro }
}

export default function SquarePage() {
  const router = useRouter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('characters')
        .select('id,name,profile,settings')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(60)
      if (error || !data) { setLoading(false); return }
      const chars = data as Character[]
      setCharacters(chars)

      const ids = chars.map((c) => c.id)
      if (!ids.length) { setLoading(false); return }
      const { data: assets, error: ae } = await supabase
        .from('character_assets')
        .select('character_id,kind,storage_path,created_at')
        .in('character_id', ids)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(300)
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

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 pb-[72px] md:pb-8">
      {/* Banner */}
      <div className="mx-4 mt-6 mb-6">
        <div className="h-[280px] md:h-[380px] rounded-[2.5rem] bg-zinc-900 p-8 md:p-12 flex flex-col justify-end relative overflow-hidden shadow-2xl">
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent opacity-90" />

          {/* Pink/purple glow blurs */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl" />

          {/* Banner content */}
          <div className="relative z-10">
            {/* Badge */}
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

      {/* Section header */}
      <div className="px-5 md:px-8 mb-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
          <Heart className="w-4 h-4 text-pink-500" />
        </div>
        <h2 className="text-2xl font-black text-white">发现角色</h2>
      </div>

      {/* Grid */}
      <div className="px-4 md:px-8 pb-8">
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-[2rem] overflow-hidden bg-zinc-900 shadow-2xl">
                <div
                  className="bg-zinc-800 animate-pulse"
                  style={{ aspectRatio: '3/4' }}
                />
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-zinc-800 rounded-full w-3/4 animate-pulse" />
                  <div className="h-2 bg-zinc-800 rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && characters.length === 0 && (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-[1.25rem] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-zinc-600" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              广场暂时没有公开角色
            </p>
          </div>
        )}

        {!loading && characters.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {characters.map((c) => {
              const { gender, age, intro } = getCharacterMeta(c)
              const imgUrl = imgById[c.id]
              return (
                <button
                  key={c.id}
                  className="text-left flex flex-col bg-zinc-900 rounded-[2rem] overflow-hidden group cursor-pointer shadow-2xl transition-all active:scale-95"
                  onClick={() => router.push(`/aibaji/square/${c.id}`)}
                >
                  {/* Image area */}
                  <div className="relative overflow-hidden" style={{ aspectRatio: '3/4' }}>
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

                    {/* Gradient overlay on image */}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90" />

                    {/* Name overlay at bottom of image */}
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      {/* Tags */}
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

                      {/* Intro text revealed on hover */}
                      {intro && (
                        <p className="text-[11px] text-zinc-300 line-clamp-2 leading-snug mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          {intro}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
