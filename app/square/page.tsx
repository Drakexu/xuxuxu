'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type PubCharacter = {
  id: string
  name: string
  system_prompt: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  visibility?: string | null
  created_at?: string
}

type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type Alert = { type: 'ok' | 'err'; text: string } | null

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(r: Record<string, unknown>, k: string) {
  const v = r[k]
  return typeof v === 'string' ? v : ''
}

function pickAssetPath(rows: CharacterAssetRow[]) {
  // Prefer cover > full_body > head.
  const byKind: Record<string, CharacterAssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  const prefer = ['cover', 'full_body', 'head']
  for (const k of prefer) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

export default function SquarePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PubCharacter[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState<Alert>(null)

  const canRefresh = useMemo(() => !loading, [loading])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  const load = async () => {
    setLoading(true)
    setAlert(null)
    setImgById({})

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      router.replace('/login')
      return
    }

    const r1 = await supabase
      .from('characters')
      .select('id,name,system_prompt,profile,settings,visibility,created_at')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(60)

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('visibility') || msg.includes('profile') || msg.includes('settings'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `加载失败：${msg}` })
        setItems([])
      } else {
        // Legacy schema has no "public" concept.
        setItems([])
      }
      setLoading(false)
      return
    }

    const nextItems = (r1.data ?? []) as PubCharacter[]
    setItems(nextItems)

    // Best-effort media: sign latest cover/full_body/head per character.
    try {
      const ids = nextItems.map((c) => c.id).filter(Boolean)
      if (ids.length) {
        const assets = await supabase
          .from('character_assets')
          .select('character_id,kind,storage_path,created_at')
          .in('character_id', ids)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(400)

        if (!assets.error) {
          const grouped: Record<string, CharacterAssetRow[]> = {}
          for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
            if (!row.character_id) continue
            if (!grouped[row.character_id]) grouped[row.character_id] = []
            grouped[row.character_id].push(row)
          }

          const entries = Object.entries(grouped)
            .map(([characterId, rows]) => [characterId, pickAssetPath(rows)] as const)
            .filter(([, path]) => !!path)

          if (entries.length) {
            const signed = await Promise.all(
              entries.map(async ([characterId, path]) => {
                const r = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
                return [characterId, r.data?.signedUrl || ''] as const
              }),
            )

            const map: Record<string, string> = {}
            for (const [characterId, url] of signed) {
              if (url) map[characterId] = url
            }
            setImgById(map)
          }
        }
      }
    } catch {
      // ignore: media is optional
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">广场</h1>
              <span className="uiBadge">public</span>
            </div>
            <p className="uiSubtitle">浏览所有用户公开的角色，点击进入详情页。</p>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/characters/new')}>
              创建角色
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/home')}>
              首页
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canRefresh}>
              刷新
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}

        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && items.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">暂无公开角色</div>
            <div className="uiEmptyDesc">你可以先去创建角色，并在角色设置里设为公开。</div>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="uiGrid">
            {items.map((c) => {
              const p = asRecord(c.profile)
              const age = getStr(p, 'age').trim()
              const occupation = getStr(p, 'occupation').trim()
              const meta = [age ? `${age}岁` : '', occupation].filter(Boolean).join(' · ')

              return (
                <div key={c.id} className="uiCard" style={{ cursor: 'pointer' }} onClick={() => router.push(`/square/${c.id}`)}>
                  <div className="uiCardMedia">
                    {imgById[c.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgById[c.id]} alt="" />
                    ) : (
                      <div className="uiCardMediaFallback">No image</div>
                    )}
                  </div>
                  <div className="uiCardTitle">{c.name}</div>
                  <div className="uiCardMeta">{meta || '公开角色'}</div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
