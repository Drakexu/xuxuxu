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

type Alert = { type: 'ok' | 'err'; text: string } | null

export default function SquarePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<PubCharacter[]>([])
  const [fullBodyById, setFullBodyById] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState<Alert>(null)

  const [cloningId, setCloningId] = useState<string>('')

  const canRefresh = useMemo(() => !loading, [loading])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  const load = async () => {
    setLoading(true)
    setAlert(null)
    setFullBodyById({})

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
        // Legacy schema has no "public" concept; show empty.
        setItems([])
      }
    } else {
      const nextItems = (r1.data ?? []) as PubCharacter[]
      setItems(nextItems)

      // Best-effort media: load latest full_body per character and sign URLs (if allowed by RLS/policies).
      try {
        const ids = nextItems.map((c) => c.id).filter(Boolean)
        if (ids.length) {
          const assets = await supabase
            .from('character_assets')
            .select('character_id,kind,storage_path,created_at')
            .in('character_id', ids)
            .eq('kind', 'full_body')
            .order('created_at', { ascending: false })
            .limit(200)

          if (!assets.error) {
            const chosen: Record<string, string> = {}
            for (const row of (assets.data ?? []) as Array<{ character_id: string; storage_path: string }>) {
              if (!row.character_id || !row.storage_path) continue
              if (!chosen[row.character_id]) chosen[row.character_id] = row.storage_path
            }

            const entries = Object.entries(chosen)
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
              setFullBodyById(map)
            }
          }
        }
      } catch {
        // ignore: media is optional
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const clone = async (c: PubCharacter) => {
    if (cloningId) return
    setCloningId(c.id)
    setAlert(null)

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    // Best-effort: works for new schema; fall back to legacy insert if columns don't exist.
    const payloadV2: {
      user_id: string
      name: string
      system_prompt: string
      visibility: 'private'
      profile: Record<string, unknown>
      settings: Record<string, unknown>
    } = {
      user_id: userId,
      name: `${c.name}（复制）`,
      system_prompt: c.system_prompt,
      visibility: 'private',
      profile: c.profile ?? {},
      settings: c.settings ?? {},
    }

    const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `复制失败：${msg}` })
        setCloningId('')
        return
      }

      const r2 = await supabase
        .from('characters')
        .insert({ user_id: userId, name: `${c.name}（复制）`, system_prompt: c.system_prompt })
        .select('id')
        .single()

      if (r2.error || !r2.data?.id) {
        setAlert({ type: 'err', text: `复制失败：${r2.error?.message || 'unknown error'}` })
        setCloningId('')
        return
      }

      setAlert({ type: 'ok', text: '已复制到你的角色列表。' })
      setCloningId('')
      router.push(`/chat/${r2.data.id}`)
      return
    }

    setAlert({ type: 'ok', text: '已复制到你的角色列表。' })
    setCloningId('')
    router.push(`/chat/${r1.data.id}`)
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">广场</h1>
              <span className="uiBadge">public</span>
            </div>
            <p className="uiSubtitle">浏览公开角色，并复制到你的账号。</p>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/characters/new')}>
              创建角色
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              返回
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
            <div className="uiEmptyDesc">你可以先在“角色”页把角色设置为公开。</div>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="uiGrid">
            {items.map((c) => (
              <div key={c.id} className="uiCard">
                <div className="uiCardMedia">
                  {fullBodyById[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fullBodyById[c.id]} alt="" />
                  ) : (
                    <div className="uiCardMediaFallback">No image</div>
                  )}
                </div>
                <div className="uiCardTitle">{c.name}</div>
                <div className="uiCardMeta">公开角色</div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                  <button className="uiBtn uiBtnPrimary" onClick={() => clone(c)} disabled={!!cloningId}>
                    {cloningId === c.id ? '复制中...' : '复制到我的角色'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
