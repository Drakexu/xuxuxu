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

  const [activated, setActivated] = useState<CharacterRow[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [activeCharId, setActiveCharId] = useState<string>('') // '' => all
  const [feedTab, setFeedTab] = useState<FeedTab>('ALL')
  const [items, setItems] = useState<FeedItem[]>([])

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
    if (rChars.error) {
      setError(rChars.error.message || '加载角色失败')
      setActivated([])
    } else {
      const rows = (rChars.data ?? []) as CharacterRow[]
      const nextActivated = rows.filter(isActivatedCharacter).sort((a, b) => activationOrder(a) - activationOrder(b))
      setActivated(nextActivated)
      activatedIds = new Set(nextActivated.map((c) => c.id))
      setActiveCharId((prev) => (prev && !activatedIds.has(prev) ? '' : prev))

      // Best-effort media for activated characters (cover/full_body/head).
      try {
        const ids = nextActivated.map((c) => c.id).filter(Boolean)
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
      .limit(80)

    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
      setItems([])
    } else {
      const raw = (rFeed.data ?? []) as FeedItem[]
      setItems(raw.filter((it) => activatedIds.has(String(it.conversations?.character_id || ''))))
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const filtered = useMemo(() => {
    let next = items
    if (activeCharId) next = next.filter((it) => String(it.conversations?.character_id || '') === activeCharId)
    if (feedTab === 'MOMENT') next = next.filter((it) => it.input_event === 'MOMENT_POST')
    if (feedTab === 'DIARY') next = next.filter((it) => it.input_event === 'DIARY_DAILY')
    if (feedTab === 'SCHEDULE') next = next.filter((it) => it.input_event === 'SCHEDULE_TICK')
    return next
  }, [items, activeCharId, feedTab])

  const nameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of activated) m[c.id] = c.name
    return m
  }, [activated])

  const eventTitle = (ev: string | null) => {
    if (ev === 'MOMENT_POST') return '朋友圈'
    if (ev === 'DIARY_DAILY') return '日记'
    if (ev === 'SCHEDULE_TICK') return '日程片段'
    return ev || 'FEED'
  }

  return (
    <div className="uiPage">
      <AppShell
        title="Home"
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
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && activated.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">还没有激活角色</div>
            <div className="uiEmptyDesc">去广场解锁一个公开角色，它会出现在这里并开始产生动态。</div>
          </div>
        )}

        {!loading && manage && activated.length > 0 && (
          <div className="uiPanel" style={{ marginTop: 0 }}>
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">激活队列</div>
                <div className="uiPanelSub">排序影响首页展示顺序；隐藏/取消激活不会删除角色。</div>
              </div>
            </div>
            <div className="uiForm" style={{ paddingTop: 14 }}>
              {activated.map((c, idx) => (
                <div key={c.id} className="uiRow">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    <div style={{ width: 22, textAlign: 'center', color: 'rgba(0,0,0,.55)', fontSize: 12 }}>{idx + 1}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div className="uiHint" style={{ marginTop: 4 }}>
                        {c.id.slice(0, 8)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      className="uiBtn uiBtnGhost"
                      disabled={idx === 0}
                      onClick={async () => {
                        if (idx === 0) return
                        const a = activated[idx - 1]
                        const b = activated[idx]
                        try {
                          const ao = activationOrder(a)
                          const bo = activationOrder(b)
                          await updateCharacterSettings(a.id, { activated_order: bo || Date.now() })
                          await updateCharacterSettings(b.id, { activated_order: ao || Date.now() + 1 })
                          setActivated((prev) => prev.slice().sort((x, y) => activationOrder(x) - activationOrder(y)))
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      }}
                    >
                      上移
                    </button>
                    <button
                      className="uiBtn uiBtnGhost"
                      disabled={idx === activated.length - 1}
                      onClick={async () => {
                        if (idx >= activated.length - 1) return
                        const a = activated[idx]
                        const b = activated[idx + 1]
                        try {
                          const ao = activationOrder(a)
                          const bo = activationOrder(b)
                          await updateCharacterSettings(a.id, { activated_order: bo || Date.now() })
                          await updateCharacterSettings(b.id, { activated_order: ao || Date.now() + 1 })
                          setActivated((prev) => prev.slice().sort((x, y) => activationOrder(x) - activationOrder(y)))
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      }}
                    >
                      下移
                    </button>
                    <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/chat/${c.id}`)}>
                      聊天
                    </button>
                    <button
                      className="uiBtn uiBtnGhost"
                      onClick={async () => {
                        try {
                          await updateCharacterSettings(c.id, { home_hidden: true })
                          setActivated((prev) => prev.filter((x) => x.id !== c.id))
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      }}
                      title="从首页隐藏（仍保留在我的角色里）"
                    >
                      隐藏
                    </button>
                    <button
                      className="uiBtn uiBtnGhost"
                      onClick={async () => {
                        try {
                          await updateCharacterSettings(c.id, { activated: false })
                          setActivated((prev) => prev.filter((x) => x.id !== c.id))
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e))
                        }
                      }}
                      title="取消激活（移出可聊天队列）"
                    >
                      取消激活
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && activated.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {activated.slice(0, 12).map((c) => (
                <div
                  key={c.id}
                  className="uiCard"
                  style={{ minWidth: 220, cursor: 'pointer' }}
                  onClick={() => router.push(`/chat/${c.id}`)}
                >
                  <div className="uiCardMedia" style={{ height: 132 }}>
                    {imgById[c.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgById[c.id]} alt="" />
                    ) : (
                      <div className="uiCardMediaFallback">No image</div>
                    )}
                  </div>
                  <div className="uiCardTitle">{c.name}</div>
                  <div className="uiCardMeta">Tap to chat</div>
                  {manage && (
                    <div className="uiCardActions">
                      <button className="uiBtn uiBtnSecondary" onClick={(e) => { e.stopPropagation(); router.push(`/chat/${c.id}`) }}>
                        聊天
                      </button>
                      <button
                        className="uiBtn uiBtnGhost"
                        onClick={async (e) => {
                          e.stopPropagation()
                          try {
                            await updateCharacterSettings(c.id, { home_hidden: true })
                            setActivated((prev) => prev.filter((x) => x.id !== c.id))
                          } catch (err: unknown) {
                            setError(err instanceof Error ? err.message : String(err))
                          }
                        }}
                      >
                        隐藏
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={`uiPill ${!activeCharId ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId('')}>
                全部
              </button>
              {activated.slice(0, 24).map((c) => (
                <button key={c.id} className={`uiPill ${activeCharId === c.id ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">还没有动态</div>
            <div className="uiEmptyDesc">去聊天，或等一会儿让角色自动发生活片段，写日记。</div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
            {filtered.map((it) => (
              <div key={it.id} className="uiPanel">
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">
                      {eventTitle(it.input_event)}
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
      </AppShell>
    </div>
  )
}
