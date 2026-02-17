'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

type CharacterRow = {
  id: string
  name: string
  system_prompt: string
  visibility?: 'private' | 'public' | string | null
  created_at?: string
  settings?: Record<string, unknown>
}

type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type Alert = { type: 'ok' | 'err'; text: string } | null
type StudioTab = 'CREATED' | 'UNLOCKED' | 'ALL'
type VisibilityFilter = 'ALL' | 'PUBLIC' | 'PRIVATE'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isUnlockedFromSquare(c: CharacterRow) {
  const s = asRecord(c.settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0) || s.unlocked_from_square === true
}

function getSourceCharacterId(c: CharacterRow) {
  const s = asRecord(c.settings)
  return typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
}

function getForkedFromCharacterId(c: CharacterRow) {
  const s = asRecord(c.settings)
  return typeof s.forked_from_character_id === 'string' ? s.forked_from_character_id.trim() : ''
}

function isActivatedForHome(c: CharacterRow) {
  if (!isUnlockedFromSquare(c)) return false
  const s = asRecord(c.settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

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

  const [loading, setLoading] = useState(true)
  const [characters, setCharacters] = useState<CharacterRow[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState<Alert>(null)
  const [manageMode, setManageMode] = useState(false)
  const [deletingId, setDeletingId] = useState<string>('')
  const [busyId, setBusyId] = useState<string>('')
  const [studioTab, setStudioTab] = useState<StudioTab>('CREATED')
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('ALL')
  const [query, setQuery] = useState('')

  const canRefresh = useMemo(() => !loading && !deletingId, [loading, deletingId])
  const counts = useMemo(() => {
    let unlocked = 0
    let active = 0
    let publicCount = 0
    for (const c of characters) {
      if (isUnlockedFromSquare(c)) unlocked += 1
      if (isActivatedForHome(c)) active += 1
      if (c.visibility === 'public') publicCount += 1
    }
    const created = Math.max(0, characters.length - unlocked)
    const privateCount = Math.max(0, characters.length - publicCount)
    return { created, unlocked, all: characters.length, active, publicCount, privateCount }
  }, [characters])
  const filteredCharacters = useMemo(() => {
    const q = query.trim().toLowerCase()
    return characters.filter((c) => {
      const unlocked = isUnlockedFromSquare(c)
      if (studioTab === 'CREATED' && unlocked) return false
      if (studioTab === 'UNLOCKED' && !unlocked) return false
      const isPublic = c.visibility === 'public'
      if (visibilityFilter === 'PUBLIC' && !isPublic) return false
      if (visibilityFilter === 'PRIVATE' && isPublic) return false
      if (!q) return true
      return String(c.name || '').toLowerCase().includes(q)
    })
  }, [characters, studioTab, visibilityFilter, query])

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
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }
    const r1 = await supabase
      .from('characters')
      .select('id,name,system_prompt,visibility,created_at,settings')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('visibility') || msg.includes('settings'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `加载失败：${msg}` })
        setCharacters([])
      } else {
        const r2 = await supabase
          .from('characters')
          .select('id,name,system_prompt,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
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

  const deleteCharacter = async (id: string) => {
    if (deletingId) return
    const ok = confirm('确认删除这个角色？删除后不可恢复。')
    if (!ok) return

    setDeletingId(id)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
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

  const updateSettings = async (id: string, patch: Record<string, unknown>) => {
    if (busyId) return
    setBusyId(id)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const row = characters.find((c) => c.id === id)
      const nextSettings = { ...asRecord(row?.settings), ...patch }
      const r = await supabase
        .from('characters')
        .update({ settings: nextSettings })
        .eq('id', id)
        .eq('user_id', userId)
      if (r.error) throw new Error(r.error.message)
      setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, settings: nextSettings } : c)))
      setAlert({ type: 'ok', text: '已更新。' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlert({ type: 'err', text: `更新失败：${msg}` })
    } finally {
      setBusyId('')
    }
  }

  const toggleVisibility = async (id: string, nextVisibility: 'public' | 'private') => {
    if (busyId) return
    setBusyId(id)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .update({ visibility: nextVisibility })
        .eq('id', id)
        .eq('user_id', userId)
      if (r.error) throw new Error(r.error.message)
      setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, visibility: nextVisibility } : c)))
      setAlert({ type: 'ok', text: nextVisibility === 'public' ? '已发布到广场。' : '已设为私密。' })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlert({ type: 'err', text: `更新发布状态失败：${msg}` })
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="uiPage">
      <AppShell
        title="创建角色"
        badge="studio"
        subtitle="你创建和管理角色的工作台"
        actions={
          <>
            <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/characters/new')}>
              新建角色
            </button>
            <button className="uiBtn uiBtnSecondary" onClick={() => setManageMode((v) => !v)}>
              {manageMode ? '完成' : '管理'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canRefresh}>
              刷新
            </button>
          </>
        }
      >
        {!loading && (
          <section className="uiStudioBoard">
            <div className="uiStudioBoardHead">
              <div>
                <h3 className="uiSectionTitle">创作工作流</h3>
                <p className="uiHint" style={{ marginTop: 6 }}>
                  创建角色 → 配置资产 → 发布到广场 → 在首页激活并进入长期互动。
                </p>
              </div>
              <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                新建并开聊
              </button>
            </div>
            <div className="uiStudioBoardGrid">
              <button className={`uiStudioBoardCard ${studioTab === 'CREATED' ? 'uiStudioBoardCardActive' : ''}`} onClick={() => setStudioTab('CREATED')}>
                <b>{counts.created}</b>
                <span>我的创作</span>
              </button>
              <button className={`uiStudioBoardCard ${studioTab === 'UNLOCKED' ? 'uiStudioBoardCardActive' : ''}`} onClick={() => setStudioTab('UNLOCKED')}>
                <b>{counts.unlocked}</b>
                <span>已解锁角色</span>
              </button>
              <button className={`uiStudioBoardCard ${visibilityFilter === 'PUBLIC' ? 'uiStudioBoardCardActive' : ''}`} onClick={() => setVisibilityFilter('PUBLIC')}>
                <b>{counts.publicCount}</b>
                <span>公开角色</span>
              </button>
              <button className={`uiStudioBoardCard ${visibilityFilter === 'PRIVATE' ? 'uiStudioBoardCardActive' : ''}`} onClick={() => setVisibilityFilter('PRIVATE')}>
                <b>{counts.privateCount}</b>
                <span>私密角色</span>
              </button>
            </div>
          </section>
        )}

        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}

        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiStudioWorkspace">
            <aside className="uiStudioSidebar">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">工作台筛选</div>
                    <div className="uiPanelSub">查看你的创作、解锁角色和发布状态</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="uiBadge">总数: {characters.length}</span>
                    <span className="uiBadge">我的创作: {counts.created}</span>
                    <span className="uiBadge">已解锁: {counts.unlocked}</span>
                    <span className="uiBadge">已激活: {counts.active}</span>
                    <span className="uiBadge">公开: {counts.publicCount}</span>
                    <span className="uiBadge">私密: {counts.privateCount}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${studioTab === 'CREATED' ? 'uiPillActive' : ''}`} onClick={() => setStudioTab('CREATED')}>
                      我的创作
                    </button>
                    <button className={`uiPill ${studioTab === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setStudioTab('UNLOCKED')}>
                      已解锁角色
                    </button>
                    <button className={`uiPill ${studioTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setStudioTab('ALL')}>
                      全部
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${visibilityFilter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setVisibilityFilter('ALL')}>
                      可见性：全部
                    </button>
                    <button className={`uiPill ${visibilityFilter === 'PUBLIC' ? 'uiPillActive' : ''}`} onClick={() => setVisibilityFilter('PUBLIC')}>
                      仅公开
                    </button>
                    <button className={`uiPill ${visibilityFilter === 'PRIVATE' ? 'uiPillActive' : ''}`} onClick={() => setVisibilityFilter('PRIVATE')}>
                      仅私密
                    </button>
                  </div>
                  <input className="uiInput" placeholder="搜索角色名..." value={query} onChange={(e) => setQuery(e.target.value)} />
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/square')}>
                      去广场解锁角色
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/home')}>
                      去首页看动态
                    </button>
                  </div>
                </div>
              </div>
            </aside>

            <div className="uiStudioMain">
              {filteredCharacters.length === 0 && (
                <div className="uiEmpty">
                  <div className="uiEmptyTitle">
                    {studioTab === 'CREATED' ? '还没有创建角色' : studioTab === 'UNLOCKED' ? '还没有已解锁角色' : '还没有角色'}
                  </div>
                  <div className="uiEmptyDesc">
                    {query.trim() ? '没有匹配结果，试试清空搜索词。' : '去创建一个角色，或在广场解锁别人公开的角色。'}
                  </div>
                </div>
              )}

              {filteredCharacters.length > 0 && (
                <div className="uiGrid">
                  {filteredCharacters.map((c) => {
                    const unlocked = isUnlockedFromSquare(c)
                    const sourceCharacterId = unlocked ? getSourceCharacterId(c) : getForkedFromCharacterId(c)
                    const active = isActivatedForHome(c)
                    const hidden = unlocked && asRecord(c.settings).home_hidden === true
                    const isCreated = !unlocked
                    const isForked = isCreated && !!sourceCharacterId
                    const isPublic = c.visibility === 'public'

                    return (
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
                            <div className="uiCardMediaFallback">暂无图片</div>
                          )}
                        </div>

                        <div className="uiCardTitle">{c.name}</div>
                        <div className="uiCardMeta">
                          {isPublic ? '公开' : '私密'}
                          {unlocked ? ` · 已解锁${active ? ' · 已激活' : ''}` : ' · 我的创作'}
                          {sourceCharacterId ? ` · ${unlocked ? '来源广场' : '衍生自广场'}` : ''}
                          {hidden ? ' · 已隐藏' : ''}
                        </div>

                        {!manageMode && (
                          <div className="uiCardActions">
                            <button
                              className="uiBtn uiBtnPrimary"
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/chat/${c.id}`)
                              }}
                            >
                              聊天
                            </button>
                            <button
                              className="uiBtn uiBtnSecondary"
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/characters/${c.id}/assets`)
                              }}
                            >
                              资产
                            </button>
                            <button
                              className="uiBtn uiBtnGhost"
                              onClick={(e) => {
                                e.stopPropagation()
                                router.push(`/characters/${c.id}/edit`)
                              }}
                            >
                              编辑
                            </button>
                            {sourceCharacterId ? (
                              <button
                                className="uiBtn uiBtnGhost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/square/${sourceCharacterId}`)
                                }}
                              >
                                模板详情
                              </button>
                            ) : null}
                            {unlocked && (
                              <button
                                className="uiBtn uiBtnGhost"
                                disabled={busyId === c.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const s = asRecord(c.settings)
                                  updateSettings(c.id, {
                                    activated: !active,
                                    home_hidden: active ? s.home_hidden : false,
                                    activated_order: !active ? Date.now() : s.activated_order,
                                    activated_at: !active ? new Date().toISOString() : s.activated_at,
                                  })
                                }}
                                title="激活到首页可聊队列"
                              >
                                {active ? '取消激活' : '激活到首页'}
                              </button>
                            )}
                            {isCreated && (
                              <button
                                className="uiBtn uiBtnGhost"
                                disabled={busyId === c.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void toggleVisibility(c.id, isPublic ? 'private' : 'public')
                                }}
                              >
                                {isPublic ? '取消公开' : '发布到广场'}
                              </button>
                            )}
                            {isCreated && isPublic && (
                              <button
                                className="uiBtn uiBtnGhost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/square/${c.id}`)
                                }}
                              >
                                查看广场页
                              </button>
                            )}
                          </div>
                        )}

                        {manageMode && (
                          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <button
                              className="uiBtn uiBtnSecondary"
                              onClick={() => router.push(`/characters/${c.id}/assets`)}
                              title="衣柜 / 资产 / 账本"
                            >
                              资产
                            </button>
                            <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/characters/${c.id}/edit`)}>
                              编辑
                            </button>
                            {isCreated && (
                              <button className="uiBtn uiBtnGhost" disabled={busyId === c.id} onClick={() => void toggleVisibility(c.id, isPublic ? 'private' : 'public')}>
                                {isPublic ? '取消公开' : '发布到广场'}
                              </button>
                            )}
                            {isCreated && isPublic && (
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${c.id}`)}>
                                查看广场页
                              </button>
                            )}
                            {unlocked && (
                              <>
                                {sourceCharacterId ? <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${sourceCharacterId}`)}>模板详情</button> : null}
                                <button
                                  className="uiBtn uiBtnSecondary"
                                  disabled={busyId === c.id}
                                  onClick={() => {
                                    const s = asRecord(c.settings)
                                    if (s.home_hidden === true) updateSettings(c.id, { home_hidden: false, activated: true, activated_order: Date.now() })
                                    else updateSettings(c.id, { home_hidden: true })
                                  }}
                                  title="在首页显示/隐藏"
                                >
                                  {hidden ? '取消隐藏' : '从首页隐藏'}
                                </button>
                                <button className="uiBtn uiBtnGhost" disabled={busyId === c.id} onClick={() => updateSettings(c.id, { activated: false })}>
                                  取消激活
                                </button>
                              </>
                            )}
                            {isForked && !unlocked ? (
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${sourceCharacterId}`)}>
                                模板详情
                              </button>
                            ) : null}
                            <button className="uiBtn uiBtnGhost" disabled={deletingId === c.id} onClick={() => deleteCharacter(c.id)}>
                              {deletingId === c.id ? '删除中...' : '删除'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
