'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AppShell from '@/app/_components/AppShell'
import { supabase } from '@/lib/supabaseClient'

type ConversationRow = { id: string; created_at?: string | null; title?: string | null }
type CharacterAssetRow = { kind: string; storage_path: string; created_at?: string | null }
type WardrobeItem = { outfit?: string; tags?: string[]; notes?: string } | string

type Details = {
  currentOutfit: string
  wardrobeItems: WardrobeItem[]
  inventory: Array<{ name: string; count?: number }>
  npcs: string[]
  highlights: Array<{ day_start?: string; item?: string }>
  eventLog: string[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function stableName(it: WardrobeItem) {
  if (typeof it === 'string') return it.trim()
  return typeof it?.outfit === 'string' ? it.outfit.trim() : ''
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

export default function CharacterAssetsPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params.characterId

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [userId, setUserId] = useState('')
  const [title, setTitle] = useState('')

  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [conversationId, setConversationId] = useState('')

  const [details, setDetails] = useState<Details | null>(null)
  const [savingOutfit, setSavingOutfit] = useState(false)
  const [manualOutfit, setManualOutfit] = useState('')

  const [assets, setAssets] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [coverUrl, setCoverUrl] = useState('')

  const canSaveOutfit = useMemo(() => !!conversationId && !savingOutfit, [conversationId, savingOutfit])
  const detailHealth = useMemo(() => {
    if (!details) {
      return [
        { key: 'wardrobe', label: '服装', ok: false },
        { key: 'inventory', label: '物品', ok: false },
        { key: 'npc', label: 'NPC', ok: false },
        { key: 'highlights', label: '高光事件', ok: false },
      ]
    }
    return [
      { key: 'wardrobe', label: '服装', ok: !!details.currentOutfit },
      { key: 'inventory', label: '物品', ok: details.inventory.length > 0 },
      { key: 'npc', label: 'NPC', ok: details.npcs.length > 0 },
      { key: 'highlights', label: '高光事件', ok: details.highlights.length > 0 },
    ]
  }, [details])

  const loadDetails = async (uid: string, convId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).eq('user_id', uid).maybeSingle()
      if (r.error || !r.data?.state) {
        setDetails(null)
        return
      }

      const st = asRecord(r.data.state)
      const ledger = asRecord(st.ledger)
      const wardrobe = asRecord(ledger.wardrobe)

      const currentOutfit = typeof wardrobe.current_outfit === 'string' ? wardrobe.current_outfit : ''
      const wardrobeItems = asArray(wardrobe.items) as WardrobeItem[]
      const inventory = (asArray(ledger.inventory) as Array<Record<string, unknown>>)
        .map((x) => ({ name: String(x.name ?? x.item ?? '').trim(), count: typeof x.count === 'number' ? x.count : undefined }))
        .filter((x) => !!x.name)

      const npcs = (asArray(ledger.npc_database) as Array<Record<string, unknown>>)
        .map((x) => String(x.name ?? x.npc ?? '').trim())
        .filter(Boolean)

      const mem = asRecord(st.memory)
      const highlights = (asArray(mem.highlights) as Array<Record<string, unknown>>)
        .map((x) => ({ day_start: typeof x.day_start === 'string' ? x.day_start : undefined, item: typeof x.item === 'string' ? x.item : undefined }))
        .filter((x) => !!x.item)

      const eventLog = (asArray(ledger.event_log) as unknown[]).map((x) => String(x)).filter(Boolean)

      setDetails({ currentOutfit, wardrobeItems, inventory, npcs, highlights, eventLog })
    } catch {
      setDetails(null)
    }
  }

  const setOutfit = async (outfit: string) => {
    if (!conversationId || !userId || savingOutfit) return
    const next = outfit.trim()
    if (!next) return

    setSavingOutfit(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录状态失效，请重新登录。')

      const resp = await fetch('/api/state/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, currentOutfit: next, confirmed: true }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        throw new Error(t || `请求失败: ${resp.status}`)
      }

      await loadDetails(userId, conversationId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingOutfit(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError('')

      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) {
        router.replace('/login')
        return
      }
      setUserId(uid)

      const ch = await supabase.from('characters').select('id,name').eq('id', characterId).eq('user_id', uid).maybeSingle()
      if (ch.error || !ch.data) {
        setError('角色不存在或无权限。')
        setLoading(false)
        return
      }
      setTitle((ch.data as { name?: string }).name || '角色资产')

      const rr = await supabase
        .from('conversations')
        .select('id,created_at,title')
        .eq('character_id', characterId)
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(12)
      if (!rr.error) {
        const rows = (rr.data ?? []) as ConversationRow[]
        setConversations(rows)
        if (rows[0]?.id) setConversationId(rows[0].id)
      }

      const ar = await supabase
        .from('character_assets')
        .select('kind,storage_path,created_at')
        .eq('character_id', characterId)
        .order('created_at', { ascending: false })
        .limit(80)

      if (!ar.error) {
        const rows = (ar.data ?? []) as CharacterAssetRow[]
        const signed = await Promise.all(
          rows
            .filter((x) => !!x.storage_path)
            .map(async (x) => {
              const s = await supabase.storage.from('character-assets').createSignedUrl(x.storage_path, 60 * 60)
              return { kind: x.kind, path: x.storage_path, url: s.data?.signedUrl || '' }
            }),
        )
        const list = signed.filter((x) => !!x.url)
        setAssets(list)
        const coverPath = pickAssetPath(rows)
        const cover = list.find((x) => x.path === coverPath) || list[0]
        if (cover?.url) setCoverUrl(cover.url)
      }

      setLoading(false)
    }

    init().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    })
  }, [router, characterId])

  useEffect(() => {
    if (!conversationId || !userId) return
    loadDetails(userId, conversationId).catch(() => {})
  }, [conversationId, userId])

  useEffect(() => {
    setManualOutfit(details?.currentOutfit || '')
  }, [details?.currentOutfit])

  return (
    <div className="uiPage">
      <AppShell
        title={title || '角色资产'}
        badge="wardrobe"
        subtitle="衣柜 / 资产 / 账本快照（基于 conversation_states）"
        actions={
          <>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${characterId}`)}>
              回到对话
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${characterId}`)}>
              动态中心
            </button>
          </>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">资产控制台</span>
            <h2 className="uiHeroTitle">角色外观与记忆账本维护</h2>
            <p className="uiHeroSub">你可以在这里切换会话快照、管理当前穿搭、检查账本完整性，并浏览角色视觉资产。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{conversations.length}</b>
              <span>可选会话</span>
            </div>
            <div className="uiKpi">
              <b>{assets.length}</b>
              <span>已签名资产</span>
            </div>
            <div className="uiKpi">
              <b>{details?.wardrobeItems.length || 0}</b>
              <span>衣柜条目</span>
            </div>
            <div className="uiKpi">
              <b>{details?.inventory.length || 0}</b>
              <span>物品条目</span>
            </div>
            <div className="uiKpi">
              <b>{details?.npcs.length || 0}</b>
              <span>NPC 条目</span>
            </div>
            <div className="uiKpi">
              <b>{details?.eventLog.length || 0}</b>
              <span>事件日志</span>
            </div>
          </div>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">会话快照</div>
                  <div className="uiPanelSub">选择要读取和操作的会话状态</div>
                </div>
              </div>
              <div className="uiForm">
                <select className="uiInput" value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title ? `${c.title} · ` : ''}
                      {c.created_at ? new Date(c.created_at).toLocaleString() : c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">衣柜与穿搭</div>
                  <div className="uiPanelSub">{details?.currentOutfit ? `当前穿搭：${details.currentOutfit}` : '当前穿搭：未记录'}</div>
                </div>
              </div>
              <div className="uiForm">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detailHealth.map((h) => (
                    <span key={h.key} className="uiBadge" style={{ background: h.ok ? 'rgba(31,141,82,.12)' : 'rgba(179,42,42,.12)', borderColor: h.ok ? 'rgba(31,141,82,.4)' : 'rgba(179,42,42,.35)' }}>
                      {h.label}: {h.ok ? '完整' : '缺失'}
                    </span>
                  ))}
                </div>

                {!details && <div className="uiHint">暂无状态快照，先在对话页进行一轮互动。</div>}

                {details && (
                  <>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {(details.wardrobeItems || []).slice(0, 40).map((it, idx) => {
                        const name = stableName(it)
                        const active = !!name && name === details.currentOutfit
                        return (
                          <button key={`${name || 'item'}:${idx}`} className={`uiPill ${active ? 'uiPillActive' : ''}`} disabled={!canSaveOutfit || !name} onClick={() => setOutfit(name)} title={name}>
                            {name || 'unknown'}
                          </button>
                        )
                      })}
                    </div>

                    {details.wardrobeItems.length === 0 && <div className="uiHint">衣柜条目为空，等状态补丁写入后会显示在这里。</div>}

                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        className="uiInput"
                        placeholder="手动设置 current_outfit"
                        value={manualOutfit}
                        onChange={(e) => setManualOutfit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          const v = manualOutfit.trim()
                          if (v) setOutfit(v)
                        }}
                      />
                      <button
                        className="uiBtn uiBtnPrimary"
                        disabled={!canSaveOutfit}
                        onClick={() => {
                          const v = manualOutfit.trim()
                          if (v) setOutfit(v)
                        }}
                      >
                        {savingOutfit ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">账本快照</div>
                  <div className="uiPanelSub">NPC / 物品 / 高光事件 / 事件日志</div>
                </div>
              </div>
              <div className="uiForm" style={{ display: 'grid', gap: 12 }}>
                <div className="uiHint">物品：{details?.inventory.length ? details.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `x${x.count}` : ''}`).join(' | ') : '(empty)'}</div>
                <div className="uiHint">NPC：{details?.npcs.length ? details.npcs.join(' | ') : '(empty)'}</div>
                <div className="uiHint">高光事件：{details?.highlights.length ? details.highlights.map((x) => x.item).filter(Boolean).join(' | ') : '(empty)'}</div>
                <div className="uiHint">事件日志：{details?.eventLog.length ? details.eventLog.slice(-18).join(' | ') : '(empty)'}</div>
              </div>
            </div>

            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">视觉资产</div>
                  <div className="uiPanelSub">cover / full_body / head 等类型预览</div>
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
                        <div className="uiCardMediaFallback">暂无预览图</div>
                      )}
                    </div>
                    <div className="uiCardTitle">主预览</div>
                    <div className="uiCardMeta">点击右侧缩略图切换</div>
                  </div>

                  <div className="uiThumbGrid">
                    {assets.slice(0, 8).map((a, idx) => (
                      <button key={`${a.kind}:${idx}`} className="uiCard" style={{ padding: 10, cursor: 'pointer' }} onClick={() => setCoverUrl(a.url)} title={a.kind}>
                        <div className="uiCardMedia" style={{ height: 86 }}>
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

                {assets.length === 0 && <div className="uiHint">暂无资产，先在角色编辑流程上传图片。</div>}
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
