'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

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
    <div className="squarePage">
      {/* 品牌 Banner */}
      <div className="squareBanner">
        <div className="squareBannerInner">
          <div className="squareBannerTitle">爱巴基广场</div>
          <div className="squareBannerSub">发现你喜欢的 AI 角色，收藏并开始聊天</div>
        </div>
      </div>

      {/* 角色卡片网格 */}
      <div className="squareContent">
        {loading && (
          <div className="squareLoading">加载中...</div>
        )}
        {!loading && characters.length === 0 && (
          <div className="squareEmpty">广场暂时没有公开角色。</div>
        )}
        {!loading && characters.length > 0 && (
          <div className="squareGrid">
            {characters.map((c) => {
              const { gender, age, intro } = getCharacterMeta(c)
              const imgUrl = imgById[c.id]
              return (
                <button
                  key={c.id}
                  className="squareCard"
                  onClick={() => router.push(`/aibaji/square/${c.id}`)}
                >
                  <div className="squareCardImage">
                    {imgUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgUrl} alt={c.name} />
                    ) : (
                      <div className="squareCardImageFallback">
                        <span>{c.name?.[0] || '?'}</span>
                      </div>
                    )}
                  </div>
                  <div className="squareCardInfo">
                    <div className="squareCardName">{c.name}</div>
                    <div className="squareCardMeta">
                      {[gender, age ? `${age}岁` : ''].filter(Boolean).join(' · ') || '神秘角色'}
                    </div>
                    {intro && <div className="squareCardIntro">{intro}</div>}
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
