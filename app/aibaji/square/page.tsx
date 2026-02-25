'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Sparkles } from 'lucide-react'
import { motion } from 'motion/react'

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
    <div className="flex flex-col">
      {/* Banner */}
      <div className="px-5 pt-8 pb-6 relative overflow-hidden border-b border-zinc-800/50">
        <div className="absolute top-0 right-0 w-48 h-48 bg-pink-500/10 blur-[60px] rounded-full pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
            <span className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-500">
              Public Characters
            </span>
            <Sparkles className="w-3 h-3 text-pink-500" />
          </div>
          <h1 className="text-5xl font-black tracking-tighter text-white leading-none mb-2">广场</h1>
          <p className="text-xs font-medium text-zinc-500 leading-relaxed">
            发现你喜欢的 AI 角色，收藏并开始聊天
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="p-3">
        {loading && (
          <div className="grid grid-cols-3 gap-2.5">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-zinc-800/50">
                <div
                  className="bg-zinc-900 animate-pulse"
                  style={{ aspectRatio: '9/16' }}
                />
                <div className="p-2 pb-3 bg-zinc-900/50 space-y-1.5">
                  <div className="h-2.5 bg-zinc-800 rounded-full w-3/4 animate-pulse" />
                  <div className="h-2 bg-zinc-800 rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && characters.length === 0 && (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-[1.25rem] bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
              <span className="text-2xl font-black text-pink-500 opacity-60">✦</span>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              广场暂时没有公开角色
            </p>
          </div>
        )}

        {!loading && characters.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {characters.map((c, i) => {
              const { gender, age, intro } = getCharacterMeta(c)
              const imgUrl = imgById[c.id]
              return (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="text-left flex flex-col rounded-2xl bg-zinc-900 overflow-hidden transition-all active:scale-95 group relative"
                  onClick={() => router.push(`/aibaji/square/${c.id}`)}
                >
                  <div className="relative overflow-hidden" style={{ aspectRatio: '9/16' }}>
                    {imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgUrl} alt={c.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center">
                        <span className="text-4xl font-black text-pink-500/40">
                          {c.name?.[0] || '?'}
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90 group-hover:opacity-70 transition-opacity duration-500" />
                    <div className="absolute bottom-0 inset-x-0 p-3 translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                      <div className="flex items-end justify-between gap-1 mb-1">
                        <span className="text-sm font-black text-white truncate leading-snug drop-shadow-lg">{c.name}</span>
                      </div>
                      {(gender || age) && (
                        <div className="flex gap-1">
                          {gender && <span className="px-1.5 py-0.5 rounded bg-white/10 backdrop-blur-md text-[8px] text-white font-black border border-white/10">{gender}</span>}
                          {age && <span className="px-1.5 py-0.5 rounded bg-white/10 backdrop-blur-md text-[8px] text-white font-black border border-white/10">{age}岁</span>}
                        </div>
                      )}
                      {intro && (
                        <p className="text-[9px] text-zinc-400 line-clamp-2 leading-snug mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          {intro}
                        </p>
                      )}
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
