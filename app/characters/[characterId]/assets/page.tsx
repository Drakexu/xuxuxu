'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AppShell from '@/app/_components/AppShell'
import { supabase } from '@/lib/supabaseClient'

type CharacterRow = { id: string; name: string; visibility?: string | null; created_at?: string | null }
type ConversationRow = { id: string; created_at?: string | null; title?: string | null }
type CharacterAssetRow = { id?: string; kind: string; storage_path: string; created_at?: string | null; meta?: unknown }

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
  const o = typeof it?.outfit === 'string' ? it.outfit.trim() : ''
  return o
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
  const [title, setTitle] = useState('')

  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [conversationId, setConversationId] = useState<string>('')

  const [details, setDetails] = useState<Details | null>(null)
  const [savingOutfit, setSavingOutfit] = useState(false)
  const [manualOutfit, setManualOutfit] = useState('')

  const [assets, setAssets] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [coverUrl, setCoverUrl] = useState('')

  const canSaveOutfit = useMemo(() => !!conversationId && !savingOutfit, [conversationId, savingOutfit])

  const loadDetails = async (convId: string) => {
    try {
      const r = await supabase.from('conversation_states').select('state').eq('conversation_id', convId).maybeSingle()
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
    if (!conversationId) return
    if (!outfit.trim()) return
    if (savingOutfit) return

    setSavingOutfit(true)
    setError('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      if (!token) throw new Error('登录态失效，请重新登录。')

      const resp = await fetch('/api/state/wardrobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId, currentOutfit: outfit, confirmed: true }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        throw new Error(t || `请求失败：${resp.status}`)
      }

      // Refresh snapshot to reflect the new outfit + any concurrent patches.
      await loadDetails(conversationId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setSavingOutfit(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      setError('')

      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const ch = await supabase
        .from('characters')
        .select('id,name,visibility,created_at')
        .eq('id', characterId)
        .eq('user_id', userId)
        .maybeSingle()
      if (ch.error || !ch.data) {
        setError('角色不存在或无权限。')
        setLoading(false)
        return
      }
      setTitle((ch.data as CharacterRow).name || 'Assets')

      // Conversations picker (latest first).
      try {
        const rr = await supabase
          .from('conversations')
          .select('id,created_at,title')
          .eq('character_id', characterId)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(12)
        if (!rr.error) {
          const rows = (rr.data ?? []) as ConversationRow[]
          setConversations(rows)
          if (rows[0]?.id) setConversationId(rows[0].id)
        }
      } catch {
        // ignore
      }

      // Asset gallery.
      try {
        const ar = await supabase
          .from('character_assets')
          .select('id,kind,storage_path,created_at,meta')
          .eq('character_id', characterId)
          .order('created_at', { ascending: false })
          .limit(80)

        if (!ar.error) {
          const rows = (ar.data ?? []) as CharacterAssetRow[]
          const toSign = rows.map((r) => r.storage_path).filter(Boolean)
          const signed = await Promise.all(
            toSign.map(async (p) => {
              const s = await supabase.storage.from('character-assets').createSignedUrl(p, 60 * 60)
              return [p, s.data?.signedUrl || ''] as const
            }),
          )

          const map: Record<string, string> = {}
          for (const [p, u] of signed) if (u) map[p] = u

          const list = rows
            .map((r) => ({ kind: r.kind, path: r.storage_path, url: map[r.storage_path] || '' }))
            .filter((x) => !!x.url)

          setAssets(list)

          const coverPath = pickAssetPath(rows)
          if (coverPath && map[coverPath]) setCoverUrl(map[coverPath])
        }
      } catch {
        // ignore
      }

      setLoading(false)
    }

    init().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    })
  }, [router, characterId])

  useEffect(() => {
    if (!conversationId) return
    loadDetails(conversationId).catch(() => {})
  }, [conversationId])

  useEffect(() => {
    setManualOutfit(details?.currentOutfit || '')
  }, [details?.currentOutfit])

  return (
    <div className="uiPage">
      <AppShell
        title={title || 'Assets'}
        badge="wardrobe"
        subtitle="衣柜 / 资产 / 账本（从 conversation_states 读取）"
        actions={
          <>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${characterId}`)}>
              回到聊天
            </button>
          </>
        }
      >
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">Conversation</div>
                  <div className="uiPanelSub">选择要操作的会话（换装会写回该会话的 state）</div>
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
                  <div className="uiPanelTitle">Wardrobe</div>
                  <div className="uiPanelSub">{details?.currentOutfit ? `当前：${details.currentOutfit}` : '当前：未记录'}</div>
                </div>
              </div>

              {!details && <div className="uiForm">暂无数据（可能还没跑 PatchScribe，或未创建 conversation_states 表）。</div>}

              {details && (
                <div className="uiForm">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {(details.wardrobeItems || []).slice(0, 40).map((it, idx) => {
                      const name = stableName(it) || (typeof it === 'string' ? it : '')
                      const active = !!name && name === details.currentOutfit
                      return (
                        <button
                          key={`${name || 'item'}:${idx}`}
                          className={`uiPill ${active ? 'uiPillActive' : ''}`}
                          disabled={!canSaveOutfit || !name}
                          onClick={() => setOutfit(name)}
                          title={name}
                        >
                          {name || 'unknown'}
                        </button>
                      )
                    })}
                  </div>

                  {details.wardrobeItems.length === 0 && <div className="uiHint">衣柜 items 为空：等 PatchScribe 抽取到服装/穿搭后会出现在这里。</div>}

                  <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                    <input
                      className="uiInput"
                      placeholder="手动设置 current_outfit（例：白衬衫+浅色牛仔裤）"
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
                </div>
              )}
            </div>

            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">Ledger Snapshot</div>
                  <div className="uiPanelSub">NPC / 物品 / 高光事件 / 事件日志（展示用）</div>
                </div>
              </div>
              {!details && <div className="uiForm">暂无数据。</div>}
              {details && (
                <div className="uiForm" style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <div className="uiSectionTitle">Inventory</div>
                    <div className="uiHint">{details.inventory.length ? details.inventory.map((x) => `${x.name}${typeof x.count === 'number' ? `×${x.count}` : ''}`).join(' · ') : '空'}</div>
                  </div>
                  <div>
                    <div className="uiSectionTitle">NPC</div>
                    <div className="uiHint">{details.npcs.length ? details.npcs.join(' · ') : '空'}</div>
                  </div>
                  <div>
                    <div className="uiSectionTitle">Highlights</div>
                    <div className="uiHint">{details.highlights.length ? details.highlights.map((x) => x.item).filter(Boolean).join(' · ') : '空'}</div>
                  </div>
                  <div>
                    <div className="uiSectionTitle">Event Log</div>
                    <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                      {(details.eventLog || []).slice(-18).reverse().map((x, idx) => (
                        <div key={`${idx}:${x}`} className="uiChip">
                          {x}
                        </div>
                      ))}
                      {details.eventLog.length === 0 && <div className="uiHint">空</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="uiPanel">
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">Assets</div>
                  <div className="uiPanelSub">角色图片资产（cover/head/full_body/wardrobe）</div>
                </div>
              </div>

              <div className="uiForm">
                <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 12 }}>
                  <div className="uiCard" style={{ margin: 0 }}>
                    <div className="uiCardMedia" style={{ height: 220 }}>
                      {coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl} alt="" />
                      ) : (
                        <div className="uiCardMediaFallback">No cover</div>
                      )}
                    </div>
                    <div className="uiCardTitle">Preview</div>
                    <div className="uiCardMeta">cover / full body / head</div>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="uiHint">已载入 {assets.length} 张（签名 URL 有效期 1h）</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                      {assets.slice(0, 8).map((a, idx) => (
                        <button
                          key={`${a.kind}:${idx}`}
                          className="uiCard"
                          style={{ padding: 10, cursor: 'pointer' }}
                          onClick={() => setCoverUrl(a.url)}
                          title={a.kind}
                        >
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
                </div>

                {assets.length === 0 && <div className="uiHint">暂无 assets：需要先在角色创建/编辑流程里上传，或往 `character_assets` 表插入记录。</div>}
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
