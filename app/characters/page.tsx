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

type Alert = { type: 'ok' | 'err'; text: string } | null

export default function CharactersPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState<CharacterRow[]>([])
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

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      router.replace('/login')
      return
    }
    setEmail(userData.user.email ?? '')

    const r1 = await supabase
      .from('characters')
      .select('id,name,system_prompt,visibility,created_at')
      .order('created_at', { ascending: false })

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
      setCharacters((r1.data ?? []) as CharacterRow[])
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
            <div className="uiEmptyDesc">去广场右上角“创建角色”，创建成功后会回到这里。</div>
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

