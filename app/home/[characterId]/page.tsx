'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

type FeedItem = {
  id: string
  created_at: string
  input_event: string | null
  content: string
  conversation_id: string
}

type FeedTab = 'ALL' | 'MOMENT' | 'DIARY' | 'SCHEDULE'
type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type ConversationRow = { id: string; created_at?: string | null; state?: unknown }

type LedgerSnapshot = {
  outfit: string
  inventory: Array<{ name: string; count?: number }>
  npcs: string[]
  highlights: string[]
  events: string[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
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

function eventTitle(ev: string | null) {
  if (ev === 'MOMENT_POST') return '朋友圈'
  if (ev === 'DIARY_DAILY') return '日记'
  if (ev === 'SCHEDULE_TICK') return '日程片段'
  return ev || '动态'
}

function eventBadgeStyle(ev: string | null) {
  if (ev === 'MOMENT_POST') return { borderColor: 'rgba(255,68,132,.45)', color: 'rgba(200,20,84,.98)', background: 'rgba(255,231,242,.92)' }
  if (ev === 'DIARY_DAILY') return { borderColor: 'rgba(20,144,132,.45)', color: 'rgba(20,144,132,.98)', background: 'rgba(236,255,251,.92)' }
  if (ev === 'SCHEDULE_TICK') return { borderColor: 'rgba(84,112,198,.45)', color: 'rgba(72,94,171,.98)', background: 'rgba(233,240,255,.92)' }
  return {}
}

export default function CharacterHomePage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [feedTab, setFeedTab] = useState<FeedTab>('ALL')
  const [feedQuery, setFeedQuery] = useState('')
  const [items, setItems] = useState<FeedItem[]>([])
  const [coverUrl, setCoverUrl] = useState('')
  const [assetUrls, setAssetUrls] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null)
  const [latestConversationId, setLatestConversationId] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    setAssetUrls([])
    setCoverUrl('')
    setSnapshot(null)
    setItems([])

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const c = await supabase.from('characters').select('id,name').eq('id', characterId).eq('user_id', userId).maybeSingle()
    if (c.error || !c.data) {
      setError('角色不存在或无权限')
      setLoading(false)
      return
    }
    setTitle((c.data as { name?: string }).name || '角色')

    const rFeed = await supabase
      .from('messages')
      .select('id,created_at,input_event,content,conversation_id')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .in('input_event', ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK'])
      .order('created_at', { ascending: false })
      .limit(120)
    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
    } else {
      setItems((rFeed.data ?? []) as FeedItem[])
    }

    const rConv = await supabase
      .from('conversations')
      .select('id,created_at')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const convId = (rConv.data as ConversationRow | null)?.id || ''
    setLatestConversationId(convId)
    if (convId) {
      const st = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', userId).maybeSingle()
      if (!st.error && st.data?.state) {
        const root = asRecord(st.data.state)
        const ledger = asRecord(root.ledger)
        const wardrobe = asRecord(ledger.wardrobe)
        const memory = asRecord(root.memory)

        const inv = asArray(ledger.inventory)
          .slice(0, 20)
          .map((x) => {
            const r = asRecord(x)
            const name = String(r.name ?? r.item ?? '').trim()
            const countRaw = Number(r.count ?? r.qty)
            return { name, count: Number.isFinite(countRaw) ? countRaw : undefined }
          })
          .filter((x) => !!x.name)

        const npcs = asArray(ledger.npc_database)
          .slice(0, 24)
          .map((x) => {
            const r = asRecord(x)
            return String(r.name ?? r.npc ?? '').trim()
          })
          .filter(Boolean)

        const events = asArray(ledger.event_log)
          .slice(-20)
          .map((x) => {
            if (typeof x === 'string') return x.trim()
            const r = asRecord(x)
            return String(r.content ?? '').trim()
          })
          .filter(Boolean)

        const highlights = asArray(memory.highlights)
          .slice(-16)
          .map((x) => {
            const r = asRecord(x)
            return String(r.item ?? r.text ?? '').trim()
          })
          .filter(Boolean)

        setSnapshot({
          outfit: String(wardrobe.current_outfit ?? '').trim(),
          inventory: inv,
          npcs,
          highlights,
          events,
        })
      }
    }

    try {
      const assets = await supabase
        .from('character_assets')
        .select('character_id,kind,storage_path,created_at')
        .eq('character_id', characterId)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(36)

      if (!assets.error && (assets.data ?? []).length) {
        const rows = (assets.data ?? []) as CharacterAssetRow[]
        const uniquePaths = new Set<string>()
        const picks = rows
          .filter((r) => !!r.storage_path)
          .filter((r) => {
            if (uniquePaths.has(r.storage_path)) return false
            uniquePaths.add(r.storage_path)
            return true
          })
          .slice(0, 10)

        const signed = await Promise.all(
          picks.map(async (r) => {
            const s = await supabase.storage.from('character-assets').createSignedUrl(r.storage_path, 60 * 60)
            return { kind: r.kind, path: r.storage_path, url: s.data?.signedUrl || '' }
          }),
        )

        const filtered = signed.filter((x) => !!x.url)
        setAssetUrls(filtered)
        const coverPath = pickAssetPath(rows)
        const coverPick = filtered.find((x) => x.path === coverPath) || filtered[0]
        if (coverPick?.url) setCoverUrl(coverPick.url)
      }
    } catch {
      // ignore assets
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, characterId])

  const filtered = useMemo(() => {
    let next = items
    if (feedTab === 'MOMENT') next = next.filter((x) => x.input_event === 'MOMENT_POST')
    else if (feedTab === 'DIARY') next = next.filter((x) => x.input_event === 'DIARY_DAILY')
    else if (feedTab === 'SCHEDULE') next = next.filter((x) => x.input_event === 'SCHEDULE_TICK')
    const q = feedQuery.trim().toLowerCase()
    if (q) next = next.filter((x) => (x.content || '').toLowerCase().includes(q))
    return next
  }, [items, feedTab, feedQuery])

  const stats = useMemo(() => {
    const moment = items.filter((x) => x.input_event === 'MOMENT_POST').length
    const diary = items.filter((x) => x.input_event === 'DIARY_DAILY').length
    const schedule = items.filter((x) => x.input_event === 'SCHEDULE_TICK').length
    return { moment, diary, schedule, total: items.length }
  }, [items])

  const ledgerHealth = useMemo(() => {
    if (!snapshot) {
      return [
        { key: 'wardrobe', label: '服装', ok: false },
        { key: 'inventory', label: '物品', ok: false },
        { key: 'npc', label: 'NPC', ok: false },
        { key: 'highlights', label: '高光事件', ok: false },
        { key: 'events', label: '事件日志', ok: false },
      ]
    }
    return [
      { key: 'wardrobe', label: '服装', ok: !!snapshot.outfit },
      { key: 'inventory', label: '物品', ok: snapshot.inventory.length > 0 },
      { key: 'npc', label: 'NPC', ok: snapshot.npcs.length > 0 },
      { key: 'highlights', label: '高光事件', ok: snapshot.highlights.length > 0 },
      { key: 'events', label: '事件日志', ok: snapshot.events.length > 0 },
    ]
  }, [snapshot])
  const ledgerHealthSummary = useMemo(() => {
    const ok = ledgerHealth.filter((x) => x.ok).length
    return { ok, total: ledgerHealth.length }
  }, [ledgerHealth])

  return (
    <div className="uiPage">
      <AppShell
        title={title ? `${title} · 动态中心` : '角色动态中心'}
        badge="life"
        subtitle="角色朋友圈 / 日记 / 日程片段 + 账本快照 + 视觉资产"
        actions={
          <>
            <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/chat/${characterId}`)}>
              聊天
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/${characterId}/assets`)}>
              资产页
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={loading}>
              刷新
            </button>
          </>
        }
      >
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div style={{ display: 'grid', gap: 14 }}>
            <section className="uiHero">
              <div>
                <span className="uiBadge">角色专属视图</span>
                <h2 className="uiHeroTitle">{title || '该角色'}的生活与记忆控制台</h2>
                <p className="uiHeroSub">这里聚合这名角色的朋友圈、日记、日程片段，并展示账本快照和资产预览，便于检查角色是否持续“活着”。</p>
              </div>
              <div className="uiKpiGrid">
                <div className="uiKpi">
                  <b>{stats.total}</b>
                  <span>动态总数</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.moment}</b>
                  <span>朋友圈</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.diary}</b>
                  <span>日记</span>
                </div>
                <div className="uiKpi">
                  <b>{stats.schedule}</b>
                  <span>日程片段</span>
                </div>
                <div className="uiKpi">
                  <b>
                    {ledgerHealthSummary.ok}/{ledgerHealthSummary.total}
                  </b>
                  <span>账本完整度</span>
                </div>
                <div className="uiKpi">
                  <b>{assetUrls.length}</b>
                  <span>可预览资产</span>
                </div>
              </div>
            </section>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">动态流</div>
                  <div className="uiPanelSub">按类型查看角色自动发布内容</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="uiInput"
                    style={{ maxWidth: 360 }}
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
                  <div className="uiEmpty" style={{ marginTop: 0 }}>
                    <div className="uiEmptyTitle">暂无动态</div>
                    <div className="uiEmptyDesc">可以先聊天，或等待定时任务产生日程和日记。</div>
                  </div>
                )}

                {filtered.map((it) => (
                  <div key={it.id} className="uiPanel" style={{ marginTop: 0 }}>
                    <div className="uiPanelHeader">
                      <div>
                        <div className="uiPanelTitle">
                          <span className="uiBadge" style={eventBadgeStyle(it.input_event)}>
                            {eventTitle(it.input_event)}
                          </span>
                        </div>
                        <div className="uiPanelSub">{new Date(it.created_at).toLocaleString()}</div>
                      </div>
                      <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${characterId}`)}>
                        去聊天
                      </button>
                    </div>
                    <div className="uiForm">
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{it.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">账本完整性</div>
                  <div className="uiPanelSub">检查 NPC / 物品 / 服装 / 高光事件 / 日志 是否已进入快照</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ledgerHealth.map((h) => (
                    <span key={h.key} className="uiBadge" style={{ background: h.ok ? 'rgba(31,141,82,.12)' : 'rgba(179,42,42,.12)', borderColor: h.ok ? 'rgba(31,141,82,.4)' : 'rgba(179,42,42,.35)' }}>
                      {h.label}: {h.ok ? '完整' : '缺失'}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">衣柜与账本快照</div>
                  <div className="uiPanelSub">来自最近会话状态（conversation_states）</div>
                </div>
                <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/${characterId}/assets`)}>
                  打开完整资产页
                </button>
              </div>
              <div className="uiForm">
                {!latestConversationId && <div className="uiHint">还没有会话记录，先去聊一轮。</div>}
                {latestConversationId && !snapshot && <div className="uiHint">有会话但暂无状态快照（可能 patch 尚未落库）。</div>}
                {snapshot && (
                  <>
                    <div className="uiHint">当前穿搭：{snapshot.outfit || '(none)'}</div>
                    <div className="uiHint">
                      物品：{snapshot.inventory.length ? snapshot.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `x${x.count}` : ''}`).join(' | ') : '(empty)'}
                    </div>
                    <div className="uiHint">NPC：{snapshot.npcs.length ? snapshot.npcs.join(' | ') : '(empty)'}</div>
                    <div className="uiHint">高光事件：{snapshot.highlights.length ? snapshot.highlights.join(' | ') : '(empty)'}</div>
                    <div className="uiHint">事件日志：{snapshot.events.length ? snapshot.events.join(' | ') : '(empty)'}</div>
                  </>
                )}
              </div>
            </div>

            <div className="uiPanel" style={{ marginTop: 0 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">视觉资产</div>
                  <div className="uiPanelSub">cover / full_body / head 预览</div>
                </div>
              </div>
              <div className="uiForm">
                <div className="uiSplit">
                  <div className="uiCard" style={{ margin: 0 }}>
                    <div className="uiCardMedia" style={{ height: 220 }}>
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" />
                      ) : (
                        <div className="uiCardMediaFallback">暂无图片</div>
                      )}
                    </div>
                    <div className="uiCardTitle">预览</div>
                    <div className="uiCardMeta">点击缩略图切换</div>
                  </div>
                  <div className="uiThumbGrid">
                    {assetUrls.slice(0, 8).map((a, idx) => (
                      <button key={`${a.kind}:${idx}`} className="uiCard" style={{ margin: 0, padding: 10, cursor: 'pointer' }} onClick={() => setCoverUrl(a.url)}>
                        <div className="uiCardMedia" style={{ height: 84 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt="" />
                        </div>
                        <div className="uiCardMeta" style={{ marginTop: 8 }}>
                          {a.kind}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                {assetUrls.length === 0 && <div className="uiHint">暂无可预览资产。</div>}
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
