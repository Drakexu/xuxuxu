'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

type CharacterRow = { id: string; name: string; created_at?: string | null; settings?: unknown }
type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type ConversationRow = { id: string; character_id?: string | null; created_at?: string | null }
type ConversationStateRow = { conversation_id: string; state?: unknown; updated_at?: string | null }

type Scope = 'ALL' | 'UNLOCKED' | 'CREATED'
type SortMode = 'UPDATED' | 'COMPLETE' | 'NAME'
type HealthFilter = 'ALL' | 'COMPLETE' | 'MISSING_OUTFIT' | 'MISSING_ASSETS' | 'MISSING_NPC' | 'MISSING_HIGHLIGHTS'

type WardrobeDigest = {
  conversationId: string
  outfit: string
  wardrobePreview: string[]
  wardrobeCount: number
  inventoryCount: number
  npcCount: number
  highlightsCount: number
  eventCount: number
  completeness: number
  updatedAt: string
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function isUnlockedFromSquare(c: CharacterRow) {
  const s = asRecord(c.settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0) || s.unlocked_from_square === true
}

function pickByKind(rows: CharacterAssetRow[], kind: string) {
  return rows.find((r) => r.kind === kind)?.storage_path || ''
}

function wardrobeNames(v: unknown) {
  const src = asArray(v)
  const out: string[] = []
  for (const it of src) {
    if (typeof it === 'string') {
      const n = it.trim()
      if (n) out.push(n)
      continue
    }
    const r = asRecord(it)
    const n = String(r.outfit || r.name || r.title || '').trim()
    if (n) out.push(n)
  }
  return Array.from(new Set(out))
}

function relativeTimeLabel(iso: string) {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return '暂无更新'
  const delta = Date.now() - ts
  if (delta < 0) return '刚刚'
  const mins = Math.floor(delta / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export default function WardrobePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [characters, setCharacters] = useState<CharacterRow[]>([])
  const [digestById, setDigestById] = useState<Record<string, WardrobeDigest>>({})
  const [stageById, setStageById] = useState<Record<string, { cover?: string; role?: string }>>({})

  const [scope, setScope] = useState<Scope>('ALL')
  const [sortMode, setSortMode] = useState<SortMode>('UPDATED')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('ALL')
  const [query, setQuery] = useState('')
  const [savingOutfitCharacterId, setSavingOutfitCharacterId] = useState('')

  const stats = useMemo(() => {
    let unlocked = 0
    let created = 0
    let withOutfit = 0
    let withWardrobe = 0
    let complete = 0
    let withAssets = 0
    let missingOutfit = 0
    let missingNpc = 0
    let missingHighlights = 0
    let missingAssets = 0

    for (const c of characters) {
      if (isUnlockedFromSquare(c)) unlocked += 1
      else created += 1
      const d = digestById[c.id]
      if (d?.outfit) withOutfit += 1
      else missingOutfit += 1
      if ((d?.wardrobeCount || 0) > 0) withWardrobe += 1
      if ((d?.npcCount || 0) <= 0) missingNpc += 1
      if ((d?.highlightsCount || 0) <= 0) missingHighlights += 1
      if ((d?.completeness || 0) >= 4) complete += 1
      const s = stageById[c.id]
      if (s?.cover || s?.role) withAssets += 1
      else missingAssets += 1
    }

    return {
      total: characters.length,
      unlocked,
      created,
      withOutfit,
      withWardrobe,
      complete,
      withAssets,
      missingOutfit,
      missingNpc,
      missingHighlights,
      missingAssets,
    }
  }, [characters, digestById, stageById])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arr = characters.filter((c) => {
      const d = digestById[c.id]
      const stage = stageById[c.id] || {}
      const unlocked = isUnlockedFromSquare(c)
      if (scope === 'UNLOCKED' && !unlocked) return false
      if (scope === 'CREATED' && unlocked) return false
      if (healthFilter === 'COMPLETE' && Number(d?.completeness || 0) < 4) return false
      if (healthFilter === 'MISSING_OUTFIT' && !!String(d?.outfit || '').trim()) return false
      if (healthFilter === 'MISSING_ASSETS' && !!(stage.cover || stage.role)) return false
      if (healthFilter === 'MISSING_NPC' && Number(d?.npcCount || 0) > 0) return false
      if (healthFilter === 'MISSING_HIGHLIGHTS' && Number(d?.highlightsCount || 0) > 0) return false
      if (!q) return true
      return String(c.name || '').toLowerCase().includes(q)
    })

    const ts = (iso?: string | null) => Date.parse(String(iso || '')) || 0
    arr.sort((a, b) => {
      const da = digestById[a.id]
      const db = digestById[b.id]
      if (sortMode === 'COMPLETE') {
        const ca = Number(da?.completeness || 0)
        const cb = Number(db?.completeness || 0)
        if (cb !== ca) return cb - ca
      }
      if (sortMode === 'NAME') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
      const ta = ts(da?.updatedAt || a.created_at)
      const tb = ts(db?.updatedAt || b.created_at)
      if (tb !== ta) return tb - ta
      if (sortMode === 'UPDATED') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN')
      return Number(db?.completeness || 0) - Number(da?.completeness || 0)
    })

    return arr
  }, [characters, digestById, stageById, healthFilter, query, scope, sortMode])

  const load = async () => {
    setLoading(true)
    setError('')
    setDigestById({})
    setStageById({})

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
      .limit(500)

    if (rChars.error) {
      setError(rChars.error.message || '加载角色失败')
      setCharacters([])
      setLoading(false)
      return
    }

    const rows = (rChars.data ?? []) as CharacterRow[]
    setCharacters(rows)
    const ids = rows.map((x) => x.id).filter(Boolean)

    try {
      if (ids.length) {
        const assets = await supabase
          .from('character_assets')
          .select('character_id,kind,storage_path,created_at')
          .in('character_id', ids)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(1500)

        if (!assets.error) {
          const grouped: Record<string, CharacterAssetRow[]> = {}
          for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
            if (!row.character_id) continue
            if (!grouped[row.character_id]) grouped[row.character_id] = []
            grouped[row.character_id].push(row)
          }

          const signJobs: Array<Promise<[string, 'cover' | 'role', string]>> = []
          for (const [characterId, rs] of Object.entries(grouped)) {
            const coverPath = pickByKind(rs, 'cover')
            const rolePath = pickByKind(rs, 'full_body') || pickByKind(rs, 'head')
            if (coverPath) {
              signJobs.push(
                supabase.storage
                  .from('character-assets')
                  .createSignedUrl(coverPath, 60 * 60)
                  .then((x) => [characterId, 'cover', x.data?.signedUrl || ''] as [string, 'cover', string]),
              )
            }
            if (rolePath) {
              signJobs.push(
                supabase.storage
                  .from('character-assets')
                  .createSignedUrl(rolePath, 60 * 60)
                  .then((x) => [characterId, 'role', x.data?.signedUrl || ''] as [string, 'role', string]),
              )
            }
          }

          const signed = await Promise.all(signJobs)
          const nextStage: Record<string, { cover?: string; role?: string }> = {}
          for (const [characterId, kind, url] of signed) {
            if (!url) continue
            if (!nextStage[characterId]) nextStage[characterId] = {}
            if (kind === 'cover') nextStage[characterId].cover = url
            else nextStage[characterId].role = url
          }
          setStageById(nextStage)
        }
      }
    } catch {
      // ignore optional media failures
    }

    try {
      const latestConversationByCharacter: Record<string, ConversationRow> = {}
      if (ids.length) {
        const convs = await supabase
          .from('conversations')
          .select('id,character_id,created_at')
          .eq('user_id', userId)
          .in('character_id', ids)
          .order('created_at', { ascending: false })
          .limit(1600)

        if (!convs.error) {
          for (const row of (convs.data ?? []) as ConversationRow[]) {
            const cid = String(row.character_id || '').trim()
            if (!cid || latestConversationByCharacter[cid]) continue
            latestConversationByCharacter[cid] = row
          }
        }
      }

      const convIds = Object.values(latestConversationByCharacter)
        .map((x) => String(x.id || '').trim())
        .filter(Boolean)

      const stateByConversationId: Record<string, ConversationStateRow> = {}
      if (convIds.length) {
        const states = await supabase
          .from('conversation_states')
          .select('conversation_id,state,updated_at')
          .eq('user_id', userId)
          .in('conversation_id', convIds)
          .limit(1600)

        if (!states.error) {
          for (const row of (states.data ?? []) as ConversationStateRow[]) {
            const convId = String(row.conversation_id || '').trim()
            if (!convId) continue
            stateByConversationId[convId] = row
          }
        }
      }

      const nextDigest: Record<string, WardrobeDigest> = {}
      for (const c of rows) {
        const conv = latestConversationByCharacter[c.id]
        const convId = String(conv?.id || '').trim()
        const st = asRecord(stateByConversationId[convId]?.state)
        const ledger = asRecord(st.ledger)
        const memory = asRecord(st.memory)
        const wardrobe = asRecord(ledger.wardrobe)

        const outfit = String(wardrobe.current_outfit || '').trim()
        const wardrobePreview = wardrobeNames(wardrobe.items)
        const wardrobeCount = wardrobePreview.length
        const inventoryCount = asArray(ledger.inventory).length
        const npcCount = asArray(ledger.npc_database).length
        const highlightsCount = asArray(memory.highlights).length
        const eventCount = asArray(ledger.event_log).length
        const completeness = [!!outfit, inventoryCount > 0, npcCount > 0, highlightsCount > 0].filter(Boolean).length
        const updatedAt = String(stateByConversationId[convId]?.updated_at || conv?.created_at || '')

        nextDigest[c.id] = {
          conversationId: convId,
          outfit,
          wardrobePreview,
          wardrobeCount,
          inventoryCount,
          npcCount,
          highlightsCount,
          eventCount,
          completeness,
          updatedAt,
        }
      }
      setDigestById(nextDigest)
    } catch {
      // ignore optional digest failures
    }

    setLoading(false)
  }

  const quickSetOutfit = async (characterId: string, outfit: string) => {
    const nextOutfit = String(outfit || '').trim()
    if (!characterId || !nextOutfit) return
    if (savingOutfitCharacterId) return

    const digest = digestById[characterId]
    const conversationId = String(digest?.conversationId || '').trim()
    if (!conversationId) {
      router.push(`/chat/${characterId}`)
      return
    }

    setSavingOutfitCharacterId(characterId)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) throw new Error('登录状态失效，请重新登录。')

      const resp = await fetch('/api/state/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, currentOutfit: nextOutfit, confirmed: true }),
      })
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
        throw new Error(String(data.error || `请求失败(${resp.status})`))
      }

      setDigestById((prev) => {
        const curr = prev[characterId]
        if (!curr) return prev
        const completeness = [true, curr.inventoryCount > 0, curr.npcCount > 0, curr.highlightsCount > 0].filter(Boolean).length
        return {
          ...prev,
          [characterId]: {
            ...curr,
            outfit: nextOutfit,
            updatedAt: new Date().toISOString(),
            completeness,
          },
        }
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingOutfitCharacterId('')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  return (
    <div className="uiPage">
      <AppShell
        title="衣柜资产"
        badge="wardrobe"
        subtitle="跨角色查看服装、资产图层和账本完整度"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">Asset Hub</span>
            <h2 className="uiHeroTitle">统一管理角色穿搭与资产状态</h2>
            <p className="uiHeroSub">这里聚合所有角色的当前穿搭、衣柜条目和账本状态，你可以快速跳转到聊天、单角色资产页和动态中心。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{stats.total}</b>
              <span>角色总数</span>
            </div>
            <div className="uiKpi">
              <b>{stats.unlocked}</b>
              <span>已解锁</span>
            </div>
            <div className="uiKpi">
              <b>{stats.created}</b>
              <span>我的创作</span>
            </div>
            <div className="uiKpi">
              <b>{stats.withAssets}</b>
              <span>有图层资产</span>
            </div>
            <div className="uiKpi">
              <b>{stats.withOutfit}</b>
              <span>有当前穿搭</span>
            </div>
            <div className="uiKpi">
              <b>{stats.withWardrobe}</b>
              <span>有衣柜条目</span>
            </div>
            <div className="uiKpi">
              <b>{stats.complete}</b>
              <span>账本完整角色</span>
            </div>
          </div>
        </section>

        <section className="uiWardrobeGapBoard">
          <button className={`uiWardrobeGapCard ${healthFilter === 'MISSING_OUTFIT' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('MISSING_OUTFIT')}>
            <b>{stats.missingOutfit}</b>
            <span>缺少当前穿搭</span>
          </button>
          <button className={`uiWardrobeGapCard ${healthFilter === 'MISSING_ASSETS' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('MISSING_ASSETS')}>
            <b>{stats.missingAssets}</b>
            <span>缺少图层资产</span>
          </button>
          <button className={`uiWardrobeGapCard ${healthFilter === 'MISSING_NPC' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('MISSING_NPC')}>
            <b>{stats.missingNpc}</b>
            <span>缺少 NPC</span>
          </button>
          <button className={`uiWardrobeGapCard ${healthFilter === 'MISSING_HIGHLIGHTS' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('MISSING_HIGHLIGHTS')}>
            <b>{stats.missingHighlights}</b>
            <span>缺少高光</span>
          </button>
          <button className={`uiWardrobeGapCard ${healthFilter === 'COMPLETE' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('COMPLETE')}>
            <b>{stats.complete}</b>
            <span>账本完整</span>
          </button>
          <button className={`uiWardrobeGapCard ${healthFilter === 'ALL' ? 'uiWardrobeGapCardActive' : ''}`} onClick={() => setHealthFilter('ALL')}>
            <b>{stats.total}</b>
            <span>全部角色</span>
          </button>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiWardrobeWorkspace">
            <aside className="uiWardrobeSidebar">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">筛选与排序</div>
                    <div className="uiPanelSub">聚焦不同来源角色与资产状态</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <input className="uiInput" placeholder="搜索角色名..." value={query} onChange={(e) => setQuery(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${scope === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setScope('ALL')}>
                      全部
                    </button>
                    <button className={`uiPill ${scope === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setScope('UNLOCKED')}>
                      已解锁
                    </button>
                    <button className={`uiPill ${scope === 'CREATED' ? 'uiPillActive' : ''}`} onClick={() => setScope('CREATED')}>
                      我的创作
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${healthFilter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setHealthFilter('ALL')}>
                      账本：全部
                    </button>
                    <button className={`uiPill ${healthFilter === 'COMPLETE' ? 'uiPillActive' : ''}`} onClick={() => setHealthFilter('COMPLETE')}>
                      账本：完整
                    </button>
                    <button className={`uiPill ${healthFilter === 'MISSING_OUTFIT' ? 'uiPillActive' : ''}`} onClick={() => setHealthFilter('MISSING_OUTFIT')}>
                      缺穿搭
                    </button>
                    <button className={`uiPill ${healthFilter === 'MISSING_ASSETS' ? 'uiPillActive' : ''}`} onClick={() => setHealthFilter('MISSING_ASSETS')}>
                      缺资产
                    </button>
                  </div>
                  <select className="uiInput" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                    <option value="UPDATED">排序：最近更新</option>
                    <option value="COMPLETE">排序：账本完整度</option>
                    <option value="NAME">排序：角色名</option>
                  </select>
                </div>
              </div>

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">快捷入口</div>
                    <div className="uiPanelSub">进入角色管理、创建和广场</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/characters')}>
                    管理角色
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                    创建角色
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
                    去广场
                  </button>
                </div>
              </div>
            </aside>

            <div className="uiWardrobeMain">
              {filtered.length === 0 && (
                <div className="uiEmpty" style={{ marginTop: 0 }}>
                  <div className="uiEmptyTitle">没有匹配角色</div>
                  <div className="uiEmptyDesc">试试清空关键词或切换筛选条件。</div>
                </div>
              )}

              {filtered.length > 0 && (
                <div className="uiGrid" style={{ marginTop: 0 }}>
                  {filtered.map((c) => {
                    const d = digestById[c.id]
                    const stage = stageById[c.id] || {}
                    const unlocked = isUnlockedFromSquare(c)
                    const completeness = Number(d?.completeness || 0)
                    return (
                      <div key={c.id} className="uiCard" style={{ marginTop: 0 }}>
                        <div className="uiWardrobeCardStage">
                          {stage.cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="uiWardrobeStageBg" src={stage.cover} alt="" />
                          ) : null}
                          {stage.role ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="uiWardrobeStageRole" src={stage.role} alt="" />
                          ) : null}
                          {!stage.cover && !stage.role ? <div className="uiCardMediaFallback">暂无图层资产</div> : null}
                        </div>

                        <div className="uiCardTitle">{c.name}</div>
                        <div className="uiCardMeta">
                          {unlocked ? '已解锁角色' : '我的创作'} · {d?.updatedAt ? `最近更新 ${relativeTimeLabel(d.updatedAt)}` : '暂无状态'}
                        </div>

                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span className={`uiBadge ${completeness >= 4 ? 'uiBadgeHealthOk' : 'uiBadgeHealthWarn'}`}>账本 {completeness}/4</span>
                          <span className="uiBadge">穿搭 {d?.outfit ? '已设置' : '未设置'}</span>
                          <span className="uiBadge">衣柜 {d?.wardrobeCount || 0}</span>
                          <span className="uiBadge">物品 {d?.inventoryCount || 0}</span>
                          <span className="uiBadge">NPC {d?.npcCount || 0}</span>
                          <span className="uiBadge">高光 {d?.highlightsCount || 0}</span>
                        </div>

                        <div className="uiHint" style={{ marginTop: 8 }}>
                          当前穿搭：{d?.outfit || '未记录'}
                        </div>

                        {(d?.wardrobePreview || []).length > 0 && (
                          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {d?.wardrobePreview.slice(0, 8).map((name) => (
                              <button
                                key={`${c.id}:${name}`}
                                className={`uiPill ${name === d?.outfit ? 'uiPillActive' : ''}`}
                                disabled={savingOutfitCharacterId === c.id}
                                onClick={() => void quickSetOutfit(c.id, name)}
                                title="快速设为当前穿搭"
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="uiCardActions">
                          <button className="uiBtn uiBtnPrimary" onClick={() => router.push(`/chat/${c.id}`)}>
                            聊天
                          </button>
                          <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/characters/${c.id}/assets`)}>
                            资产页
                          </button>
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${c.id}`)}>
                            动态中心
                          </button>
                          {!d?.outfit && d?.wardrobePreview?.[0] ? (
                            <button className="uiBtn uiBtnGhost" disabled={savingOutfitCharacterId === c.id} onClick={() => void quickSetOutfit(c.id, d.wardrobePreview[0])}>
                              {savingOutfitCharacterId === c.id ? '修复中...' : '一键修复穿搭'}
                            </button>
                          ) : null}
                        </div>
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
