'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

type CharacterRow = { id: string; name: string; created_at?: string; settings?: Record<string, unknown> }
type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type FeedItem = {
  id: string
  created_at: string
  input_event: string | null
  content: string
  conversation_id: string
  conversations?: { character_id?: string | null } | null
}

type FeedTab = 'ALL' | 'MOMENT' | 'DIARY' | 'SCHEDULE'
const FEED_PAGE_SIZE = 80

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isUnlockedFromSquare(c: CharacterRow) {
  const s = asRecord(c.settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0) || s.unlocked_from_square === true
}

function isActivatedCharacter(c: CharacterRow) {
  if (!isUnlockedFromSquare(c)) return false
  const s = asRecord(c.settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

function activationOrder(c: CharacterRow) {
  const s = asRecord(c.settings)
  const n = Number(s.activated_order ?? NaN)
  if (Number.isFinite(n)) return n
  const t = c.created_at ? Date.parse(c.created_at) : NaN
  return Number.isFinite(t) ? t : 0
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

export default function HomeFeedPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [manage, setManage] = useState(false)
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'UNLOCKED'>('ACTIVE')

  const [activated, setActivated] = useState<CharacterRow[]>([])
  const [unlocked, setUnlocked] = useState<CharacterRow[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [activeCharId, setActiveCharId] = useState<string>('') // '' => all
  const [feedTab, setFeedTab] = useState<FeedTab>('ALL')
  const [feedQuery, setFeedQuery] = useState('')
  const [items, setItems] = useState<FeedItem[]>([])
  const [feedAllowedCharacterIds, setFeedAllowedCharacterIds] = useState<string[]>([])
  const [feedCursor, setFeedCursor] = useState('')
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [loadingMoreFeed, setLoadingMoreFeed] = useState(false)

  const canLoad = useMemo(() => !loading, [loading])

  const updateCharacterSettings = async (characterId: string, patch: Record<string, unknown>) => {
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const row = activated.find((c) => c.id === characterId)
    const nextSettings = { ...asRecord(row?.settings), ...patch }
    const r = await supabase
      .from('characters')
      .update({ settings: nextSettings })
      .eq('id', characterId)
      .eq('user_id', userId)
    if (r.error) throw new Error(r.error.message)
    setActivated((prev) => prev.map((c) => (c.id === characterId ? { ...c, settings: nextSettings } : c)))
  }

  const load = async () => {
    setLoading(true)
    setError('')
    setImgById({})
    setFeedAllowedCharacterIds([])
    setFeedCursor('')
    setFeedHasMore(false)
    setLoadingMoreFeed(false)

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const rChars = await supabase
      .from('characters')
      .select('id,name,created_at,settings')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(400)
    let activatedIds = new Set<string>()
    let unlockedIdsForFeed = new Set<string>()
    if (rChars.error) {
      setError(rChars.error.message || '加载角色失败')
      setActivated([])
      setUnlocked([])
    } else {
      const rows = (rChars.data ?? []) as CharacterRow[]
      const nextUnlocked = rows.filter(isUnlockedFromSquare).sort((a, b) => activationOrder(a) - activationOrder(b))
      const nextActivated = rows.filter(isActivatedCharacter).sort((a, b) => activationOrder(a) - activationOrder(b))
      setUnlocked(nextUnlocked)
      setActivated(nextActivated)
      activatedIds = new Set(nextActivated.map((c) => c.id))
      const unlockedIds = new Set(nextUnlocked.map((c) => c.id))
      unlockedIdsForFeed = unlockedIds
      setActiveCharId((prev) => (prev && !unlockedIds.has(prev) ? '' : prev))

      // Best-effort media for activated characters (cover/full_body/head).
      try {
        const ids = nextUnlocked.map((c) => c.id).filter(Boolean)
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
              .map(([characterId, rows2]) => [characterId, pickAssetPath(rows2)] as const)
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
    }

    const feedEvents = ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK']
    const rFeed = await supabase
      .from('messages')
      .select('id,created_at,input_event,content,conversation_id,conversations(character_id)')
      .eq('user_id', userId)
      .in('input_event', feedEvents)
      .order('created_at', { ascending: false })
      .limit(FEED_PAGE_SIZE)

    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
      setItems([])
    } else {
      const raw = (rFeed.data ?? []) as FeedItem[]
      const fallbackIds = unlockedIdsForFeed.size ? unlockedIdsForFeed : activatedIds
      setFeedAllowedCharacterIds(Array.from(fallbackIds))
      setItems(raw.filter((it) => fallbackIds.has(String(it.conversations?.character_id || ''))))
      setFeedCursor(raw.length ? String(raw[raw.length - 1]?.created_at || '') : '')
      setFeedHasMore(raw.length >= FEED_PAGE_SIZE)
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const loadMoreFeed = async () => {
    if (loading || loadingMoreFeed || !feedHasMore || !feedCursor) return
    setLoadingMoreFeed(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const allowed = new Set(feedAllowedCharacterIds)
      const rFeed = await supabase
        .from('messages')
        .select('id,created_at,input_event,content,conversation_id,conversations(character_id)')
        .eq('user_id', userId)
        .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
        .lt('created_at', feedCursor)
        .order('created_at', { ascending: false })
        .limit(FEED_PAGE_SIZE)

      if (rFeed.error) {
        setError(rFeed.error.message || '加载更多动态失败')
        return
      }

      const raw = (rFeed.data ?? []) as FeedItem[]
      const nextFiltered = raw.filter((it) => allowed.has(String(it.conversations?.character_id || '')))

      if (nextFiltered.length) {
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id))
          const merged = [...prev]
          for (const it of nextFiltered) {
            if (seen.has(it.id)) continue
            merged.push(it)
          }
          return merged
        })
      }

      setFeedCursor(raw.length ? String(raw[raw.length - 1]?.created_at || '') : '')
      if (raw.length < FEED_PAGE_SIZE) setFeedHasMore(false)
    } finally {
      setLoadingMoreFeed(false)
    }
  }

  const filtered = useMemo(() => {
    const visibleIds = new Set((viewMode === 'ACTIVE' ? activated : unlocked).map((c) => c.id))
    let next = items
    next = next.filter((it) => visibleIds.has(String(it.conversations?.character_id || '')))
    if (activeCharId) next = next.filter((it) => String(it.conversations?.character_id || '') === activeCharId)
    if (feedTab === 'MOMENT') next = next.filter((it) => it.input_event === 'MOMENT_POST')
    if (feedTab === 'DIARY') next = next.filter((it) => it.input_event === 'DIARY_DAILY')
    if (feedTab === 'SCHEDULE') next = next.filter((it) => it.input_event === 'SCHEDULE_TICK')
    const q = feedQuery.trim().toLowerCase()
    if (q) next = next.filter((it) => (it.content || '').toLowerCase().includes(q))
    return next
  }, [items, activeCharId, feedTab, activated, unlocked, viewMode, feedQuery])

  const nameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of unlocked) m[c.id] = c.name
    return m
  }, [unlocked])

  const visibleCharacters = useMemo(() => (viewMode === 'ACTIVE' ? activated : unlocked), [viewMode, activated, unlocked])
  const selectedCharacter = useMemo(() => {
    if (!activeCharId) return null
    return visibleCharacters.find((c) => c.id === activeCharId) || null
  }, [visibleCharacters, activeCharId])
  const activatedIdSet = useMemo(() => new Set(activated.map((c) => c.id)), [activated])
  const feedStats = useMemo(() => {
    let moments = 0
    let diaries = 0
    let schedules = 0
    for (const it of items) {
      if (it.input_event === 'MOMENT_POST') moments += 1
      else if (it.input_event === 'DIARY_DAILY') diaries += 1
      else if (it.input_event === 'SCHEDULE_TICK') schedules += 1
    }
    return {
      moments,
      diaries,
      schedules,
      total: items.length,
    }
  }, [items])
  const selectedCharacterStats = useMemo(() => {
    if (!selectedCharacter) return null
    const targetId = selectedCharacter.id
    const ownItems = items.filter((it) => String(it.conversations?.character_id || '') === targetId)
    let moment = 0
    let diary = 0
    let schedule = 0
    for (const it of ownItems) {
      if (it.input_event === 'MOMENT_POST') moment += 1
      else if (it.input_event === 'DIARY_DAILY') diary += 1
      else if (it.input_event === 'SCHEDULE_TICK') schedule += 1
    }
    const latest = ownItems[0] || null
    return {
      total: ownItems.length,
      moment,
      diary,
      schedule,
      latestAt: latest?.created_at || '',
      latestContent: String(latest?.content || '').trim(),
    }
  }, [items, selectedCharacter])

  const moveActivated = async (idx: number, direction: 'UP' | 'DOWN') => {
    if (idx < 0 || idx >= activated.length) return
    if (direction === 'UP' && idx === 0) return
    if (direction === 'DOWN' && idx >= activated.length - 1) return
    const target = direction === 'UP' ? idx - 1 : idx + 1
    const a = activated[idx]
    const b = activated[target]
    try {
      const ao = activationOrder(a)
      const bo = activationOrder(b)
      await updateCharacterSettings(a.id, { activated_order: bo || Date.now() })
      await updateCharacterSettings(b.id, { activated_order: ao || Date.now() + 1 })
      setActivated((prev) => prev.slice().sort((x, y) => activationOrder(x) - activationOrder(y)))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const hideCharacter = async (characterId: string) => {
    try {
      await updateCharacterSettings(characterId, { home_hidden: true })
      setActivated((prev) => prev.filter((x) => x.id !== characterId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deactivateCharacter = async (characterId: string) => {
    try {
      await updateCharacterSettings(characterId, { activated: false })
      setActivated((prev) => prev.filter((x) => x.id !== characterId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const eventTitle = (ev: string | null) => {
    if (ev === 'MOMENT_POST') return '朋友圈'
    if (ev === 'DIARY_DAILY') return '日记'
    if (ev === 'SCHEDULE_TICK') return '日程片段'
    return ev || '动态'
  }

  const eventBadgeStyle = (ev: string | null) => {
    if (ev === 'MOMENT_POST') return { borderColor: 'rgba(255,68,132,.45)', color: 'rgba(200,20,84,.98)', background: 'rgba(255,231,242,.92)' }
    if (ev === 'DIARY_DAILY') return { borderColor: 'rgba(20,144,132,.45)', color: 'rgba(20,144,132,.98)', background: 'rgba(236,255,251,.92)' }
    if (ev === 'SCHEDULE_TICK') return { borderColor: 'rgba(84,112,198,.45)', color: 'rgba(72,94,171,.98)', background: 'rgba(233,240,255,.92)' }
    return {}
  }

  return (
    <div className="uiPage">
      <AppShell
        title="首页"
        badge="feed"
        subtitle="已激活角色：朋友圈 / 日记 / 日程片段"
        actions={
          <>
            <button className="uiBtn uiBtnSecondary" onClick={() => setManage((v) => !v)}>
              {manage ? '完成' : '管理队列'}
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canLoad}>
              刷新
            </button>
          </>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">角色生活流</span>
            <h2 className="uiHeroTitle">首页聚合你已解锁角色的动态</h2>
            <p className="uiHeroSub">角色会按设定持续生成朋友圈、日记和日程片段。你可以直接切换角色、过滤动态、跳转到单角色动态中心。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{unlocked.length}</b>
              <span>已解锁角色</span>
            </div>
            <div className="uiKpi">
              <b>{activated.length}</b>
              <span>已激活角色</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.total}</b>
              <span>动态总数</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.moments}</b>
              <span>朋友圈</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.diaries}</b>
              <span>日记</span>
            </div>
            <div className="uiKpi">
              <b>{feedStats.schedules}</b>
              <span>日程片段</span>
            </div>
          </div>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiHomeWorkspace">
            <div className="uiHomeCol">
              {selectedCharacter && selectedCharacterStats && (
                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">当前角色状态</div>
                      <div className="uiPanelSub">{selectedCharacter.name} 的动态活跃情况</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="uiBadge">动态总数: {selectedCharacterStats.total}</span>
                      <span className="uiBadge">朋友圈: {selectedCharacterStats.moment}</span>
                      <span className="uiBadge">日记: {selectedCharacterStats.diary}</span>
                      <span className="uiBadge">日程: {selectedCharacterStats.schedule}</span>
                    </div>
                    <div className="uiHint" style={{ marginTop: 0 }}>
                      最近更新时间：{selectedCharacterStats.latestAt ? new Date(selectedCharacterStats.latestAt).toLocaleString() : '暂无'}
                    </div>
                    {selectedCharacterStats.latestContent ? (
                      <div className="uiHint" style={{ marginTop: 0 }}>
                        最近动态：{selectedCharacterStats.latestContent.slice(0, 90)}
                        {selectedCharacterStats.latestContent.length > 90 ? '...' : ''}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">角色队列</div>
                    <div className="uiPanelSub">{viewMode === 'ACTIVE' ? '当前只显示已激活角色' : '当前显示全部已解锁角色'}</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/square')}>
                      去广场解锁
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                      创建角色
                    </button>
                    <button className={`uiPill ${viewMode === 'ACTIVE' ? 'uiPillActive' : ''}`} onClick={() => setViewMode('ACTIVE')}>
                      仅看已激活
                    </button>
                    <button className={`uiPill ${viewMode === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setViewMode('UNLOCKED')}>
                      全部已解锁
                    </button>
                    <button className={`uiPill ${!activeCharId ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId('')}>
                      全部角色
                    </button>
                  </div>

                  {visibleCharacters.length === 0 && (
                    <div className="uiEmpty" style={{ marginTop: 8 }}>
                      <div className="uiEmptyTitle">{viewMode === 'ACTIVE' ? '还没有激活角色' : '还没有已解锁角色'}</div>
                      <div className="uiEmptyDesc">去广场解锁一个公开角色，它会出现在这里并开始产生动态。</div>
                    </div>
                  )}

                  {visibleCharacters.length > 0 && (
                    <div className="uiRoleRail">
                      {visibleCharacters.slice(0, 40).map((c) => (
                        <button key={c.id} className={`uiRoleRailItem ${activeCharId === c.id ? 'uiRoleRailItemActive' : ''}`} onClick={() => setActiveCharId(c.id)}>
                          <div className="uiRoleRailMedia">
                            {imgById[c.id] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={imgById[c.id]} alt="" />
                            ) : (
                              <span>{c.name.slice(0, 1)}</span>
                            )}
                          </div>
                          <div className="uiRoleRailBody">
                            <div className="uiRoleRailName">{c.name}</div>
                            <div className="uiRoleRailMeta">{activatedIdSet.has(c.id) ? '已激活' : '未激活'}</div>
                          </div>
                          <div className="uiRoleRailActions">
                            <span className="uiBadge">动态</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="uiHomeCol">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">动态流</div>
                    <div className="uiPanelSub">{selectedCharacter ? `${selectedCharacter.name} 的动态` : '全部角色动态'}</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="uiInput"
                      style={{ maxWidth: 320 }}
                      placeholder="搜索动态内容..."
                      value={feedQuery}
                      onChange={(e) => setFeedQuery(e.target.value)}
                    />
                    <button className={`uiPill ${feedTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('ALL')}>
                      全部
                    </button>
                    <button className={`uiPill ${feedTab === 'MOMENT' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('MOMENT')}>
                      朋友圈
                    </button>
                    <button className={`uiPill ${feedTab === 'DIARY' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('DIARY')}>
                      日记
                    </button>
                    <button className={`uiPill ${feedTab === 'SCHEDULE' ? 'uiPillActive' : ''}`} onClick={() => setFeedTab('SCHEDULE')}>
                      日程
                    </button>
                  </div>

                  {filtered.length === 0 && (
                    <div className="uiEmpty" style={{ marginTop: 8 }}>
                      <div className="uiEmptyTitle">还没有动态</div>
                      <div className="uiEmptyDesc">去聊天，或等一会儿让角色自动发生活片段、写日记。</div>
                    </div>
                  )}

                  {filtered.length > 0 && (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {filtered.map((it) => (
                        <div key={it.id} className="uiPanel" style={{ marginTop: 0 }}>
                          <div className="uiPanelHeader">
                            <div>
                              <div className="uiPanelTitle">
                                <span className="uiBadge" style={eventBadgeStyle(it.input_event)}>
                                  {eventTitle(it.input_event)}
                                </span>
                                {(() => {
                                  const cid = String(it.conversations?.character_id || '')
                                  const nm = cid && nameById[cid] ? nameById[cid] : ''
                                  return nm ? ` · ${nm}` : ''
                                })()}
                              </div>
                              <div className="uiPanelSub">{new Date(it.created_at).toLocaleString()}</div>
                            </div>
                            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${String(it.conversations?.character_id || '')}`)}>
                              去聊天
                            </button>
                          </div>
                          <div className="uiForm">
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{it.content}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(feedHasMore || loadingMoreFeed) && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button className="uiBtn uiBtnGhost" onClick={() => void loadMoreFeed()} disabled={loadingMoreFeed}>
                        {loadingMoreFeed ? '加载更多中...' : '加载更多动态'}
                      </button>
                    </div>
                  )}
                  {!feedHasMore && !loadingMoreFeed && items.length > 0 && <div className="uiHint">已加载当前可见的全部动态。</div>}
                </div>
              </div>
            </div>

            <div className="uiHomeCol">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">快捷入口</div>
                    <div className="uiPanelSub">聊天、动态中心与队列管理入口</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/characters')}>
                      管理角色
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
                      去广场
                    </button>
                    {selectedCharacter && (
                      <>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${selectedCharacter.id}`)}>
                          与 {selectedCharacter.name} 聊天
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${selectedCharacter.id}`)}>
                          打开 {selectedCharacter.name} 动态中心
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">激活队列</div>
                    <div className="uiPanelSub">排序影响首页展示顺序；隐藏/取消激活不会删除角色。</div>
                  </div>
                  <button className="uiBtn uiBtnGhost" onClick={() => setManage((v) => !v)}>
                    {manage ? '收起' : '展开管理'}
                  </button>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  {activated.length === 0 && <div className="uiHint">暂无已激活角色。</div>}
                  {activated.length > 0 && !manage && <div className="uiHint">已激活 {activated.length} 个角色，点击“展开管理”进行排序和下线。</div>}
                  {manage &&
                    activated.map((c, idx) => (
                      <div key={c.id} className="uiRow">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {idx + 1}. {c.name}
                          </div>
                          <div className="uiHint" style={{ marginTop: 4 }}>
                            {c.id.slice(0, 8)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="uiBtn uiBtnGhost" disabled={idx === 0} onClick={() => void moveActivated(idx, 'UP')}>
                            上移
                          </button>
                          <button className="uiBtn uiBtnGhost" disabled={idx === activated.length - 1} onClick={() => void moveActivated(idx, 'DOWN')}>
                            下移
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => void hideCharacter(c.id)}>
                            隐藏
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => void deactivateCharacter(c.id)}>
                            取消激活
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
