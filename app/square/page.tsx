'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

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
type AudienceTab = 'ALL' | 'MALE' | 'FEMALE' | 'TEEN'

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isActivatedBySettings(settings: unknown) {
  const s = asRecord(settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

function getStr(r: Record<string, unknown>, k: string) {
  const v = r[k]
  return typeof v === 'string' ? v : ''
}

function normalizeUnlockedSettings(sourceSettings: unknown, sourceId: string) {
  const src = asRecord(sourceSettings)
  const teen = src.teen_mode === true || src.age_mode === 'teen'
  return {
    ...(teen ? { ...src, teen_mode: true, age_mode: 'teen', romance_mode: 'ROMANCE_OFF' } : src),
    source_character_id: sourceId,
    unlocked_from_square: true,
    activated: true,
    home_hidden: false,
    activated_at: new Date().toISOString(),
    activated_order: Date.now(),
  }
}

function getAudienceTab(c: PubCharacter): AudienceTab {
  const p = asRecord(c.profile)
  const s = asRecord(c.settings)
  if (s.age_mode === 'teen' || s.teen_mode === true) return 'TEEN'

  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const hints = [
    s.target_gender,
    s.audience_gender,
    publish.target_gender,
    p.target_gender,
    p.audience_gender,
  ]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')

  if (!hints) return 'ALL'
  if (hints.includes('female') || hints.includes('girl') || hints.includes('女生') || hints.includes('女') || hints.includes('f')) return 'FEMALE'
  if (hints.includes('male') || hints.includes('boy') || hints.includes('男生') || hints.includes('男') || hints.includes('m')) return 'MALE'
  return 'ALL'
}

function audienceLabel(audienceTab: AudienceTab) {
  if (audienceTab === 'MALE') return '男频'
  if (audienceTab === 'FEMALE') return '女频'
  if (audienceTab === 'TEEN') return '青少年'
  return '全部'
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
  const [togglingId, setTogglingId] = useState('')
  const [unlockingId, setUnlockingId] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'LOCKED' | 'UNLOCKED' | 'ACTIVE'>('ALL')
  const [audienceTab, setAudienceTab] = useState<AudienceTab>('ALL')
  const [sortBy, setSortBy] = useState<'NEWEST' | 'UNLOCKED_FIRST' | 'ACTIVE_FIRST' | 'NAME'>('UNLOCKED_FIRST')
  const [items, setItems] = useState<PubCharacter[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [unlockedInfoBySourceId, setUnlockedInfoBySourceId] = useState<Record<string, { localId: string; active: boolean }>>({})
  const [alert, setAlert] = useState<Alert>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

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
    setUnlockedInfoBySourceId({})

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    setIsLoggedIn(!!userId)

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

    // Best-effort: show "已解锁" badges by checking user's copied characters.
    if (userId) {
      try {
        const mine = await supabase
          .from('characters')
          .select('id,settings')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(600)
        if (!mine.error) {
          const map: Record<string, { localId: string; active: boolean }> = {}
          for (const row of (mine.data ?? []) as Array<{ id: string; settings?: unknown }>) {
            const s = asRecord(row.settings)
            const src = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
            if (src) map[src] = { localId: row.id, active: isActivatedBySettings(row.settings) }
          }
          setUnlockedInfoBySourceId(map)
        }
      } catch {
        // ignore
      }
    }

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

  const toggleActivation = async (sourceCharacterId: string, nextActive: boolean) => {
    const info = unlockedInfoBySourceId[sourceCharacterId]
    if (!info?.localId || togglingId) return
    setTogglingId(info.localId)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .select('settings')
        .eq('id', info.localId)
        .eq('user_id', userId)
        .maybeSingle()
      if (r.error) throw new Error(r.error.message)

      const s = asRecord(r.data?.settings)
      const nextSettings = {
        ...s,
        activated: nextActive,
        home_hidden: nextActive ? false : s.home_hidden,
        activated_at: nextActive ? new Date().toISOString() : s.activated_at,
        activated_order: nextActive ? Date.now() : s.activated_order,
      }

      const upd = await supabase
        .from('characters')
        .update({ settings: nextSettings })
        .eq('id', info.localId)
        .eq('user_id', userId)
      if (upd.error) throw new Error(upd.error.message)

      setUnlockedInfoBySourceId((prev) => ({
        ...prev,
        [sourceCharacterId]: {
          ...info,
          active: nextActive,
        },
      }))
      setAlert({ type: 'ok', text: nextActive ? '已激活到首页队列。' : '已取消激活。' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTogglingId('')
    }
  }

  const unlockCharacterFromCard = async (source: PubCharacter) => {
    if (!source?.id || unlockingId) return
    setUnlockingId(source.id)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.push('/login')
        return
      }

      const payloadV2 = {
        user_id: userId,
        name: source.name,
        system_prompt: source.system_prompt,
        visibility: 'private' as const,
        profile: source.profile ?? {},
        settings: normalizeUnlockedSettings(source.settings, source.id),
      }

      const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
      if (r1.error) {
        const msg = r1.error.message || ''
        const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
        if (!looksLikeLegacy) throw new Error(msg)
        const r2 = await supabase.from('characters').insert({ user_id: userId, name: source.name, system_prompt: source.system_prompt }).select('id').single()
        if (r2.error || !r2.data?.id) throw new Error(r2.error?.message || 'unlock failed')
        setUnlockedInfoBySourceId((prev) => ({ ...prev, [source.id]: { localId: r2.data.id, active: true } }))
      } else {
        setUnlockedInfoBySourceId((prev) => ({ ...prev, [source.id]: { localId: String(r1.data.id), active: true } }))
      }

      setAlert({ type: 'ok', text: '已解锁并激活到首页队列。' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? `解锁失败：${e.message}` : String(e) })
    } finally {
      setUnlockingId('')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arr = items.filter((c) => {
      const info = unlockedInfoBySourceId[c.id]
      const unlocked = !!info
      const active = !!info?.active
      const audience = getAudienceTab(c)

      if (filter === 'LOCKED' && unlocked) return false
      if (filter === 'UNLOCKED' && !unlocked) return false
      if (filter === 'ACTIVE' && !active) return false
      if (audienceTab !== 'ALL' && audience !== audienceTab) return false

      if (!q) return true
      const p = asRecord(c.profile)
      const hay = [
        c.name || '',
        getStr(p, 'occupation'),
        getStr(p, 'organization'),
        getStr(p, 'summary'),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    const score = (c: PubCharacter) => {
      const info = unlockedInfoBySourceId[c.id]
      const active = info?.active ? 1 : 0
      const unlocked = info ? 1 : 0
      const ts = c.created_at ? Date.parse(c.created_at) : 0
      const name = (c.name || '').toLowerCase()
      return { active, unlocked, ts, name }
    }
    arr.sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      if (sortBy === 'ACTIVE_FIRST') {
        if (sb.active !== sa.active) return sb.active - sa.active
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        return sb.ts - sa.ts
      }
      if (sortBy === 'UNLOCKED_FIRST') {
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        if (sb.active !== sa.active) return sb.active - sa.active
        return sb.ts - sa.ts
      }
      if (sortBy === 'NAME') return sa.name.localeCompare(sb.name, 'zh-Hans-CN')
      return sb.ts - sa.ts
    })
    return arr
  }, [items, unlockedInfoBySourceId, filter, query, sortBy, audienceTab])

  const stats = useMemo(() => {
    let unlocked = 0
    let active = 0
    let male = 0
    let female = 0
    let teen = 0
    for (const it of items) {
      const info = unlockedInfoBySourceId[it.id]
      if (info) unlocked += 1
      if (info?.active) active += 1
      const audience = getAudienceTab(it)
      if (audience === 'MALE') male += 1
      else if (audience === 'FEMALE') female += 1
      else if (audience === 'TEEN') teen += 1
    }
    return {
      total: items.length,
      unlocked,
      active,
      locked: Math.max(0, items.length - unlocked),
      male,
      female,
      teen,
    }
  }, [items, unlockedInfoBySourceId])
  const spotlightItems = useMemo(() => filteredItems.slice(0, 3), [filteredItems])
  const gridItems = useMemo(() => filteredItems.slice(3), [filteredItems])

  return (
    <div className="uiPage">
      <AppShell
        title="广场"
        badge="public"
        subtitle="浏览公开角色并解锁到你的可聊天队列，支持男频/女频/青少年频道筛选。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canRefresh}>
            刷新
          </button>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">角色发现</span>
            <h2 className="uiHeroTitle">广场用于解锁公开角色并激活到首页</h2>
            <p className="uiHeroSub">解锁后的角色会进入你的可聊天队列，并可随时激活/取消激活，决定是否出现在首页动态流。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{stats.total}</b>
              <span>公开角色</span>
            </div>
            <div className="uiKpi">
              <b>{stats.locked}</b>
              <span>未解锁</span>
            </div>
            <div className="uiKpi">
              <b>{stats.unlocked}</b>
              <span>已解锁</span>
            </div>
            <div className="uiKpi">
              <b>{stats.active}</b>
              <span>已激活</span>
            </div>
            <div className="uiKpi">
              <b>{stats.male}</b>
              <span>男频</span>
            </div>
            <div className="uiKpi">
              <b>{stats.female}</b>
              <span>女频</span>
            </div>
            <div className="uiKpi">
              <b>{stats.teen}</b>
              <span>青少年</span>
            </div>
          </div>
        </section>

        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}

        {loading && <div className="uiSkeleton">加载中...</div>}
        {!loading && !isLoggedIn && (
          <div className="uiAlert uiAlertOk">当前为游客浏览模式。登录后可解锁角色并激活到首页。</div>
        )}

        {!loading && (
          <div className="uiPanel" style={{ marginTop: 0 }}>
            <div className="uiForm" style={{ paddingTop: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span className="uiBadge">总计: {stats.total}</span>
                <span className="uiBadge">未解锁: {stats.locked}</span>
                <span className="uiBadge">已解锁: {stats.unlocked}</span>
                <span className="uiBadge">已激活: {stats.active}</span>
                <span className="uiBadge">男频: {stats.male}</span>
                <span className="uiBadge">女频: {stats.female}</span>
                <span className="uiBadge">青少年: {stats.teen}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="uiInput"
                  style={{ maxWidth: 420 }}
                  placeholder="搜索角色名/职业/组织..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className={`uiPill ${filter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setFilter('ALL')}>
                  全部
                </button>
                <button className={`uiPill ${filter === 'LOCKED' ? 'uiPillActive' : ''}`} onClick={() => setFilter('LOCKED')}>
                  未解锁
                </button>
                <button className={`uiPill ${filter === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setFilter('UNLOCKED')}>
                  已解锁
                </button>
                <button className={`uiPill ${filter === 'ACTIVE' ? 'uiPillActive' : ''}`} onClick={() => setFilter('ACTIVE')}>
                  已激活
                </button>
                <select className="uiInput" style={{ width: 170, padding: '8px 10px' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="UNLOCKED_FIRST">排序：已解锁优先</option>
                  <option value="ACTIVE_FIRST">排序：已激活优先</option>
                  <option value="NEWEST">排序：最新发布</option>
                  <option value="NAME">排序：角色名</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="uiHint" style={{ marginTop: 0 }}>
                  频道:
                </span>
                <button className={`uiPill ${audienceTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('ALL')}>
                  全部
                </button>
                <button className={`uiPill ${audienceTab === 'MALE' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('MALE')}>
                  男频
                </button>
                <button className={`uiPill ${audienceTab === 'FEMALE' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('FEMALE')}>
                  女频
                </button>
                <button className={`uiPill ${audienceTab === 'TEEN' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('TEEN')}>
                  青少年
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && filteredItems.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">没有匹配结果</div>
            <div className="uiEmptyDesc">试试清空搜索词，或切换筛选条件。</div>
          </div>
        )}

        {!loading && spotlightItems.length > 0 && (
          <section>
            <div className="uiSectionHead">
              <h3 className="uiSectionTitle">精选角色</h3>
              <span className="uiHint">基于当前筛选结果展示前 3 个</span>
            </div>
            <div className="uiGrid">
              {spotlightItems.map((c) => {
                const p = asRecord(c.profile)
                const s = asRecord(c.settings)
                const age = getStr(p, 'age').trim()
                const occupation = getStr(p, 'occupation').trim()
                const org = getStr(p, 'organization').trim()
                const meta = [age ? `${age}岁` : '', occupation, org].filter(Boolean).join(' · ')
                const ageMode = s.age_mode === 'teen' || s.teen_mode === true ? '未成年模式' : '成人模式'
                const romance = typeof s.romance_mode === 'string' ? s.romance_mode : ''
                const romanceLabel = ageMode === '未成年模式' ? '恋爱关闭' : romance === 'ROMANCE_OFF' ? '恋爱关闭' : '恋爱开启'
                const audience = getAudienceTab(c)
                const info = unlockedInfoBySourceId[c.id]

                return (
                  <div key={c.id} className="uiCard" style={{ cursor: 'pointer' }} onClick={() => router.push(`/square/${c.id}`)}>
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
                      {meta || '公开角色'}
                      {info ? ` · 已解锁${info.active ? ' · 已激活' : ''}` : ''}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="uiBadge">公开</span>
                      <span className="uiBadge">{ageMode}</span>
                      <span className="uiBadge">{audienceLabel(audience)}</span>
                      <span className="uiBadge">{romanceLabel}</span>
                      <span className="uiBadge" style={{ borderColor: info ? 'rgba(31,141,82,.45)' : 'rgba(0,0,0,.18)', color: info ? 'rgba(31,141,82,1)' : 'rgba(0,0,0,.62)', background: info ? 'rgba(31,141,82,.10)' : 'rgba(0,0,0,.03)' }}>
                        {info ? '已解锁' : '未解锁'}
                      </span>
                      {info?.active ? (
                        <span className="uiBadge" style={{ borderColor: 'rgba(20,144,132,.48)', color: 'rgba(20,144,132,.98)', background: 'rgba(20,144,132,.10)' }}>
                          已激活
                        </span>
                      ) : null}
                    </div>

                    {info && (
                      <div className="uiCardActions">
                        <button
                          className="uiBtn uiBtnPrimary"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/chat/${info.localId}`)
                          }}
                        >
                          对话
                        </button>
                        <button
                          className="uiBtn uiBtnGhost"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/home/${info.localId}`)
                          }}
                        >
                          动态中心
                        </button>
                        <button
                          className="uiBtn uiBtnGhost"
                          disabled={togglingId === info.localId}
                          onClick={(e) => {
                            e.stopPropagation()
                            void toggleActivation(c.id, !info.active)
                          }}
                        >
                          {togglingId === info.localId ? '处理中...' : info.active ? '取消激活' : '激活到首页'}
                        </button>
                        <button
                          className="uiBtn uiBtnGhost"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/square/${c.id}`)
                          }}
                        >
                          详情
                        </button>
                      </div>
                    )}
                    {!info && (
                      <div className="uiCardActions">
                        <button
                          className="uiBtn uiBtnPrimary"
                          disabled={unlockingId === c.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!isLoggedIn) {
                              router.push('/login')
                              return
                            }
                            void unlockCharacterFromCard(c)
                          }}
                        >
                          {!isLoggedIn ? '登录后解锁' : unlockingId === c.id ? '解锁中...' : '一键解锁'}
                        </button>
                        <button
                          className="uiBtn uiBtnGhost"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/square/${c.id}`)
                          }}
                        >
                          详情
                        </button>
                        {!isLoggedIn ? (
                          <button
                            className="uiBtn uiBtnGhost"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push('/login')
                            }}
                          >
                            去登录
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {!loading && gridItems.length > 0 && (
          <section>
            <div className="uiSectionHead">
              <h3 className="uiSectionTitle">全部结果</h3>
              <span className="uiHint">共 {filteredItems.length} 个角色</span>
            </div>
            <div className="uiGrid">
              {gridItems.map((c) => {
              const p = asRecord(c.profile)
              const s = asRecord(c.settings)
              const age = getStr(p, 'age').trim()
              const occupation = getStr(p, 'occupation').trim()
              const org = getStr(p, 'organization').trim()
              const meta = [age ? `${age}岁` : '', occupation, org].filter(Boolean).join(' · ')
              const ageMode = s.age_mode === 'teen' || s.teen_mode === true ? '未成年模式' : '成人模式'
              const romance = typeof s.romance_mode === 'string' ? s.romance_mode : ''
              const romanceLabel = ageMode === '未成年模式' ? '恋爱关闭' : romance === 'ROMANCE_OFF' ? '恋爱关闭' : '恋爱开启'
              const audience = getAudienceTab(c)
              const info = unlockedInfoBySourceId[c.id]

              return (
                <div key={c.id} className="uiCard" style={{ cursor: 'pointer' }} onClick={() => router.push(`/square/${c.id}`)}>
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
                    {meta || '公开角色'}
                    {info ? ` · 已解锁${info.active ? ' · 已激活' : ''}` : ''}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="uiBadge">公开</span>
                    <span className="uiBadge">{ageMode}</span>
                    <span className="uiBadge">{audienceLabel(audience)}</span>
                    <span className="uiBadge">{romanceLabel}</span>
                    <span className="uiBadge" style={{ borderColor: info ? 'rgba(31,141,82,.45)' : 'rgba(0,0,0,.18)', color: info ? 'rgba(31,141,82,1)' : 'rgba(0,0,0,.62)', background: info ? 'rgba(31,141,82,.10)' : 'rgba(0,0,0,.03)' }}>
                      {info ? '已解锁' : '未解锁'}
                    </span>
                    {info?.active ? (
                      <span className="uiBadge" style={{ borderColor: 'rgba(20,144,132,.48)', color: 'rgba(20,144,132,.98)', background: 'rgba(20,144,132,.10)' }}>
                        已激活
                      </span>
                    ) : null}
                  </div>

                  {info && (
                    <div className="uiCardActions">
                      <button
                        className="uiBtn uiBtnPrimary"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/chat/${info.localId}`)
                        }}
                      >
                        对话
                      </button>
                      <button
                        className="uiBtn uiBtnGhost"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/home/${info.localId}`)
                        }}
                      >
                        动态中心
                      </button>
                      <button
                        className="uiBtn uiBtnGhost"
                        disabled={togglingId === info.localId}
                        onClick={(e) => {
                          e.stopPropagation()
                          void toggleActivation(c.id, !info.active)
                        }}
                      >
                        {togglingId === info.localId ? '处理中...' : info.active ? '取消激活' : '激活到首页'}
                      </button>
                      <button
                        className="uiBtn uiBtnGhost"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/square/${c.id}`)
                        }}
                      >
                        详情
                      </button>
                    </div>
                  )}
                  {!info && (
                    <div className="uiCardActions">
                      <button
                        className="uiBtn uiBtnPrimary"
                        disabled={unlockingId === c.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!isLoggedIn) {
                            router.push('/login')
                            return
                          }
                          void unlockCharacterFromCard(c)
                        }}
                      >
                        {!isLoggedIn ? '登录后解锁' : unlockingId === c.id ? '解锁中...' : '一键解锁'}
                      </button>
                      <button
                        className="uiBtn uiBtnGhost"
                        onClick={(e) => {
                          e.stopPropagation()
                          router.push(`/square/${c.id}`)
                        }}
                      >
                        详情
                      </button>
                      {!isLoggedIn ? (
                        <button
                          className="uiBtn uiBtnGhost"
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push('/login')
                          }}
                        >
                          去登录
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )
              })}
            </div>
          </section>
        )}
      </AppShell>
    </div>
  )
}
