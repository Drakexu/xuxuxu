'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type CharacterRow = {
  id: string
  name: string
  system_prompt: string
  visibility?: 'private' | 'public' | string | null
  created_at?: string
}

type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type Alert = { type: 'ok' | 'err'; text: string } | null

function pickAssetPath(rows: CharacterAssetRow[]) {
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

export default function CharactersPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState<CharacterRow[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState<Alert>(null)
  const [manageMode, setManageMode] = useState(false)
  const [deletingId, setDeletingId] = useState<string>('')

  const canRefresh = useMemo(() => !loading && !deletingId, [loading, deletingId])

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
    setEmail(userData.user.email ?? '')

    const r1 = await supabase.from('characters').select('id,name,system_prompt,visibility,created_at').order('created_at', { ascending: false })

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && msg.includes('visibility')
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `加载失败：${msg}` })
        setCharacters([])
      } else {
        const r2 = await supabase.from('characters').select('id,name,system_prompt,created_at').order('created_at', { ascending: false })
        if (r2.error) {
          setAlert({ type: 'err', text: `加载失败：${r2.error.message || 'unknown error'}` })
          setCharacters([])
        } else {
          setCharacters((r2.data ?? []) as CharacterRow[])
        }
      }
    } else {
      const rows = (r1.data ?? []) as CharacterRow[]
      setCharacters(rows)

      // Best-effort media.
      try {
        const ids = rows.map((c) => c.id).filter(Boolean)
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
        // ignore
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  const deleteCharacter = async (id: string) => {
    if (deletingId) return
    const ok = confirm('确认删除这个角色？删除后不可恢复。')
    if (!ok) return

    setDeletingId(id)
    setAlert(null)
    try {
      const r = await supabase.from('characters').delete().eq('id', id)
      if (r.error) throw new Error(r.error.message)

      setCharacters((prev) => prev.filter((c) => c.id !== id))
      setAlert({ type: 'ok', text: '已删除。' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlert({ type: 'err', text: `删除失败：${msg}` })
    } finally {
      setDeletingId('')
    }
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">我的角色</h1>
              <span className="uiBadge">v1</span>
            </div>
            <p className="uiSubtitle">{email}</p>
          </div>

          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/home')}>
              首页
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              广场
            </button>
            <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/characters/new')}>
              创建角色
            </button>
            <button className="uiBtn uiBtnSecondary" onClick={() => setManageMode((v) => !v)}>
              {manageMode ? '完成' : '管理'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canRefresh}>
              刷新
            </button>
            <button className="uiBtn uiBtnGhost" onClick={logout}>
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}

        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && characters.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">还没有角色</div>
            <div className="uiEmptyDesc">去创建一个角色，或在广场解锁别人公开的角色。</div>
          </div>
        )}

        {!loading && characters.length > 0 && (
          <div className="uiGrid">
            {characters.map((c) => (
              <div
                key={c.id}
                className="uiCard"
                style={{ cursor: manageMode ? 'default' : 'pointer', userSelect: 'none' }}
                onClick={() => {
                  if (!manageMode) router.push(`/chat/${c.id}`)
                }}
              >
                <div className="uiCardMedia">
                  {imgById[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgById[c.id]} alt="" />
                  ) : (
                    <div className="uiCardMediaFallback">No image</div>
                  )}
                </div>

                <div className="uiCardTitle">{c.name}</div>
                <div className="uiCardMeta">{c.visibility === 'public' ? '公开' : '私密'}</div>

                {!manageMode && <div className="uiHint">点击进入聊天</div>}

                {manageMode && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/characters/${c.id}/edit`)}>
                      编辑
                    </button>
                    <button className="uiBtn uiBtnGhost" disabled={deletingId === c.id} onClick={() => deleteCharacter(c.id)}>
                      {deletingId === c.id ? '删除中...' : '删除'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
