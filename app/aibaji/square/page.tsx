'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Sparkles } from 'lucide-react'

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
      <div className="px-5 pt-8 pb-6 bg-gradient-to-br from-pink-50/80 to-[#FBFBFA] border-b border-zinc-100/60">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#EC4899] animate-pulse" />
          <span className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
            Public Characters
          </span>
          <Sparkles className="w-3 h-3 text-[#EC4899]" />
        </div>
        <h1 className="text-5xl font-black tracking-tighter text-zinc-900 leading-none mb-2">广场</h1>
        <p className="text-xs font-medium text-zinc-400 leading-relaxed">
          发现你喜欢的 AI 角色，收藏并开始聊天
        </p>
      </div>

      {/* Grid */}
      <div className="p-3">
        {loading && (
          <div className="grid grid-cols-3 gap-2.5">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden border border-zinc-100">
                <div
                  className="bg-zinc-100 animate-pulse"
                  style={{ aspectRatio: '9/16' }}
                />
                <div className="p-2 pb-3 bg-white space-y-1.5">
                  <div className="h-2.5 bg-zinc-100 rounded-full w-3/4 animate-pulse" />
                  <div className="h-2 bg-zinc-100 rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && characters.length === 0 && (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-[1.25rem] bg-pink-50 border border-pink-100 flex items-center justify-center">
              <span className="text-2xl font-black text-[#EC4899] opacity-60">✦</span>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
              广场暂时没有公开角色
            </p>
          </div>
        )}

        {!loading && characters.length > 0 && (
          <div className="grid grid-cols-3 gap-2.5">
            {characters.map((c) => {
              const { gender, age, intro } = getCharacterMeta(c)
              const imgUrl = imgById[c.id]
              return (
                <button
                  key={c.id}
                  className="text-left flex flex-col rounded-2xl border border-zinc-100 bg-white shadow-sm overflow-hidden transition-all active:scale-95 hover:border-pink-200 hover:shadow-[0_8px_24px_rgba(236,72,153,0.08)]"
                  onClick={() => router.push(`/aibaji/square/${c.id}`)}
                >
                  <div
                    className="bg-gradient-to-br from-pink-50/60 to-zinc-50/40 overflow-hidden"
                    style={{ aspectRatio: '9/16' }}
                  >
                    {imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgUrl} alt={c.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span
                          className="text-4xl font-black"
                          style={{ color: '#EC4899', opacity: 0.35 }}
                        >
                          {c.name?.[0] || '?'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-2 pb-3 flex flex-col gap-0.5">
                    <span className="text-[12px] font-black text-zinc-900 truncate leading-snug">
                      {c.name}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-medium leading-snug">
                      {[gender, age ? `${age}岁` : ''].filter(Boolean).join(' · ') || '神秘角色'}
                    </span>
                    {intro && (
                      <span className="text-[10px] text-zinc-400 line-clamp-2 leading-snug mt-0.5">
                        {intro}
                      </span>
                    )}
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
