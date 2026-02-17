'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ensureLatestConversationForCharacter } from '@/lib/conversationClient'
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
type SquareSort = 'RECOMMENDED' | 'NEWEST' | 'UNLOCKED_FIRST' | 'ACTIVE_FIRST' | 'NAME'

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

function isMissingFeedReactionsTableError(msg: string) {
  const s = String(msg || '').toLowerCase()
  return s.includes('feed_reactions') && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
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
  const [sortBy, setSortBy] = useState<SquareSort>('RECOMMENDED')
  const [items, setItems] = useState<PubCharacter[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [unlockedInfoBySourceId, setUnlockedInfoBySourceId] = useState<Record<string, { localId: string; active: boolean }>>({})
  const [reactionScoreBySourceId, setReactionScoreBySourceId] = useState<Record<string, number>>({})
  const [audienceAffinity, setAudienceAffinity] = useState<Record<AudienceTab, number>>({ ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 })
  const [hasPreferenceSignal, setHasPreferenceSignal] = useState(false)
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
    setReactionScoreBySourceId({})
    setAudienceAffinity({ ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 })
    setHasPreferenceSignal(false)

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
    const itemById: Record<string, PubCharacter> = {}
    for (const it of nextItems) {
      if (it.id) itemById[it.id] = it
    }

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
          const localToSource: Record<string, string> = {}
          for (const row of (mine.data ?? []) as Array<{ id: string; settings?: unknown }>) {
            const s = asRecord(row.settings)
            const src = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
            if (!src) continue
            map[src] = { localId: row.id, active: isActivatedBySettings(row.settings) }
            localToSource[row.id] = src
          }
          setUnlockedInfoBySourceId(map)

          try {
            const rr = await supabase
              .from('feed_reactions')
              .select('character_id,liked,saved')
              .eq('user_id', userId)
              .order('updated_at', { ascending: false })
              .limit(1200)

            if (!rr.error) {
              const scoreBySourceId: Record<string, number> = {}
              for (const row of rr.data ?? []) {
                const r = asRecord(row)
                const localCharId = String(r.character_id || '').trim()
                const sourceId = localToSource[localCharId] || ''
                if (!sourceId) continue
                const w = (r.saved === true ? 2 : 0) + (r.liked === true ? 1 : 0)
                if (w <= 0) continue
                scoreBySourceId[sourceId] = Number(scoreBySourceId[sourceId] || 0) + w
              }

              const nextAffinity: Record<AudienceTab, number> = { ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 }
              for (const [sourceId, score] of Object.entries(scoreBySourceId)) {
                const it = itemById[sourceId]
                if (!it) continue
                const a = getAudienceTab(it)
                if (a !== 'ALL') nextAffinity[a] = Number(nextAffinity[a] || 0) + score
              }

              setReactionScoreBySourceId(scoreBySourceId)
              setAudienceAffinity(nextAffinity)
              setHasPreferenceSignal(Object.keys(scoreBySourceId).length > 0)
            } else if (!isMissingFeedReactionsTableError(rr.error.message || '')) {
              throw new Error(rr.error.message)
            }
          } catch {
            // ignore
          }
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

  const unlockCharacterFromCard = async (source: PubCharacter, options?: { startChat?: boolean }) => {
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

      let localId = ''
      const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
      if (r1.error) {
        const msg = r1.error.message || ''
        const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
        if (!looksLikeLegacy) throw new Error(msg)
        const r2 = await supabase.from('characters').insert({ user_id: userId, name: source.name, system_prompt: source.system_prompt }).select('id').single()
        if (r2.error || !r2.data?.id) throw new Error(r2.error?.message || 'unlock failed')
        localId = String(r2.data.id)
        setUnlockedInfoBySourceId((prev) => ({ ...prev, [source.id]: { localId: r2.data.id, active: true } }))
      } else {
        localId = String(r1.data.id)
        setUnlockedInfoBySourceId((prev) => ({ ...prev, [source.id]: { localId, active: true } }))
      }

      try {
        if (localId) {
          await ensureLatestConversationForCharacter({
            userId,
            characterId: localId,
            title: source.name || '对话',
          })
        }
      } catch {
        // Best-effort: unlock should not fail if conversation bootstrap fails.
      }

      setAlert({ type: 'ok', text: options?.startChat ? '已解锁并激活，正在跳转聊天。' : '已解锁并激活到首页队列。' })
      if (options?.startChat && localId) {
        router.push(`/chat/${localId}`)
      }
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
      const reaction = Number(reactionScoreBySourceId[c.id] || 0)
      const audience = getAudienceTab(c)
      const affinity = audience === 'ALL' ? 0 : Number(audienceAffinity[audience] || 0)
      const rec = reaction * 3 + affinity
      return { active, unlocked, ts, name, rec }
    }
    arr.sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      if (sortBy === 'RECOMMENDED') {
        if (sb.rec !== sa.rec) return sb.rec - sa.rec
        if (sb.active !== sa.active) return sb.active - sa.active
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        return sb.ts - sa.ts
      }
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
  }, [items, unlockedInfoBySourceId, reactionScoreBySourceId, audienceAffinity, filter, query, sortBy, audienceTab])

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

  const renderCard = (c: PubCharacter, featured = false) => {
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
    const recScore = Number(reactionScoreBySourceId[c.id] || 0)

    return (
      <div key={c.id} className="uiCard" style={{ cursor: 'pointer', borderColor: featured ? 'rgba(249,217,142,.32)' : undefined }} onClick={() => router.push(`/square/${c.id}`)}>
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
          {featured ? (
            <span className="uiBadge" style={{ borderColor: 'rgba(249,217,142,.44)', color: 'rgba(249,217,142,.98)', background: 'rgba(77,29,40,.72)' }}>
              精选
            </span>
          ) : null}
          <span className="uiBadge">公开</span>
          <span className="uiBadge">{ageMode}</span>
          <span className="uiBadge">{audienceLabel(audience)}</span>
          <span className="uiBadge">{romanceLabel}</span>
          {recScore > 0 ? <span className="uiBadge">偏好命中 {recScore}</span> : null}
          <span
            className="uiBadge"
            style={{
              borderColor: info ? 'rgba(249,217,142,.44)' : 'rgba(255,255,255,.22)',
              color: info ? 'rgba(249,217,142,.98)' : 'rgba(255,255,255,.72)',
              background: info ? 'rgba(77,29,40,.7)' : 'rgba(54,54,54,.5)',
            }}
          >
            {info ? '已解锁' : '未解锁'}
          </span>
          {info?.active ? (
            <span className="uiBadge" style={{ borderColor: 'rgba(185,25,35,.45)', color: 'rgba(255,208,208,.94)', background: 'rgba(77,29,40,.58)' }}>
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
                void unlockCharacterFromCard(c, { startChat: true })
              }}
            >
              {!isLoggedIn ? '登录后解锁' : unlockingId === c.id ? '解锁中...' : '解锁并开聊'}
            </button>
            {isLoggedIn ? (
              <button
                className="uiBtn uiBtnGhost"
                disabled={unlockingId === c.id}
                onClick={(e) => {
                  e.stopPropagation()
                  void unlockCharacterFromCard(c)
                }}
              >
                仅解锁
              </button>
            ) : null}
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
  }

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
          <div className="uiSquareWorkspace">
            <aside className="uiSquareSidebar">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">筛选器</div>
                    <div className="uiPanelSub">按状态、频道和关键词筛选公开角色</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="uiBadge">总计: {stats.total}</span>
                    <span className="uiBadge">未解锁: {stats.locked}</span>
                    <span className="uiBadge">已解锁: {stats.unlocked}</span>
                    <span className="uiBadge">已激活: {stats.active}</span>
                  </div>
                  <input
                    className="uiInput"
                    placeholder="搜索角色名/职业/组织..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                  </div>
                  <select className="uiInput" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                    <option value="RECOMMENDED">排序：为你推荐</option>
                    <option value="UNLOCKED_FIRST">排序：已解锁优先</option>
                    <option value="ACTIVE_FIRST">排序：已激活优先</option>
                    <option value="NEWEST">排序：最新发布</option>
                    <option value="NAME">排序：角色名</option>
                  </select>
                  <div className="uiHint">
                    {hasPreferenceSignal
                      ? '推荐排序已根据你的点赞/收藏学习偏好。'
                      : '推荐排序会随着你的点赞/收藏逐步学习偏好。'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${audienceTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('ALL')}>
                      全部频道
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

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">操作入口</div>
                    <div className="uiPanelSub">解锁后可进入首页与聊天</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/home')}>
                    打开首页
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
                    管理我的角色
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                    创建新角色
                  </button>
                  {!isLoggedIn ? (
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/login')}>
                      登录后可解锁
                    </button>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="uiSquareMain">
              {filteredItems.length === 0 && (
                <div className="uiEmpty">
                  <div className="uiEmptyTitle">没有匹配结果</div>
                  <div className="uiEmptyDesc">试试清空搜索词，或切换筛选条件。</div>
                </div>
              )}

              {spotlightItems.length > 0 && (
                <section>
                  <div className="uiSectionHead">
                    <h3 className="uiSectionTitle">精选角色</h3>
                    <span className="uiHint">基于当前筛选结果展示前 3 个</span>
                  </div>
                  <div className="uiGrid">
                    {spotlightItems.map((c) => renderCard(c, true))}
                  </div>
                </section>
              )}

              {gridItems.length > 0 && (
                <section>
                  <div className="uiSectionHead">
                    <h3 className="uiSectionTitle">全部结果</h3>
                    <span className="uiHint">共 {filteredItems.length} 个角色</span>
                  </div>
                  <div className="uiGrid">
                    {gridItems.map((c) => renderCard(c))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
