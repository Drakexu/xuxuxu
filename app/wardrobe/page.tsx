'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'
import { buildVisualPresets, type VisualPreset } from '@/lib/presentation/visualPresets'

type Character = { id: string; name: string; created_at?: string | null; settings?: unknown }
type Asset = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
type Conv = { id: string; character_id?: string | null; created_at?: string | null }
type ConvState = { conversation_id: string; state?: unknown; updated_at?: string | null }

type Digest = {
  conversationId: string
  outfit: string
  wardrobe: string[]
  inventoryCount: number
  npcCount: number
  highlightsCount: number
  completeness: number
  updatedAt: string
}

type Stage = { coverUrl?: string; roleUrl?: string; coverPath?: string; rolePath?: string }
type Option = { path: string; kind: string; url: string }

type Preview = {
  bgPath: string
  bgUrl: string
  rolePath: string
  roleUrl: string
  scale: number
  y: number
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function isUnlocked(c: Character) {
  const s = asRecord(c.settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim()) || s.unlocked_from_square === true
}

function names(v: unknown) {
  const out: string[] = []
  for (const x of asArray(v)) {
    if (typeof x === 'string') {
      const t = x.trim()
      if (t) out.push(t)
      continue
    }
    const r = asRecord(x)
    const t = String(r.outfit || r.name || r.title || '').trim()
    if (t) out.push(t)
  }
  return Array.from(new Set(out))
}

function relTime(iso: string) {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return 'No update'
  const m = Math.floor((Date.now() - ts) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isBg(a: Asset) {
  const p = a.storage_path.toLowerCase()
  return a.kind === 'cover' || /bg|background|scene|street|city|room|night|day/.test(p)
}

function isRole(a: Asset) {
  const p = a.storage_path.toLowerCase()
  return a.kind === 'full_body' || a.kind === 'head' || /body|head|portrait|avatar|role|character/.test(p)
}

function shortPath(path: string) {
  const s = String(path || '').split('/').pop() || ''
  return s.length > 20 ? `${s.slice(0, 10)}...${s.slice(-7)}` : s
}

export default function WardrobePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [characters, setCharacters] = useState<Character[]>([])
  const [digestById, setDigestById] = useState<Record<string, Digest>>({})
  const [stageById, setStageById] = useState<Record<string, Stage>>({})
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [savingOutfitId, setSavingOutfitId] = useState('')
  const [bgOptions, setBgOptions] = useState<Option[]>([])
  const [roleOptions, setRoleOptions] = useState<Option[]>([])
  const [presets, setPresets] = useState<VisualPreset[]>([])
  const [preview, setPreview] = useState<Preview>({ bgPath: '', bgUrl: '', rolePath: '', roleUrl: '', scale: 108, y: 0 })

  const selected = useMemo(() => characters.find((c) => c.id === selectedId) || null, [characters, selectedId])

  const stats = useMemo(() => {
    let unlocked = 0
    let complete = 0
    for (const c of characters) {
      if (isUnlocked(c)) unlocked += 1
      if ((digestById[c.id]?.completeness || 0) >= 4) complete += 1
    }
    return { total: characters.length, unlocked, complete }
  }, [characters, digestById])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return characters.filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
  }, [characters, query])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const chars = await supabase.from('characters').select('id,name,created_at,settings').eq('user_id', userId).order('created_at', { ascending: false }).limit(400)
    if (chars.error) {
      setError(chars.error.message || 'Failed to load characters')
      setLoading(false)
      return
    }

    const rows = (chars.data ?? []) as Character[]
    setCharacters(rows)
    setSelectedId((prev) => (prev && rows.some((x) => x.id === prev) ? prev : rows[0]?.id || ''))

    const ids = rows.map((x) => x.id)
    const assetsRes = await supabase
      .from('character_assets')
      .select('character_id,kind,storage_path,created_at')
      .in('character_id', ids)
      .in('kind', ['cover', 'full_body', 'head'])
      .order('created_at', { ascending: false })
      .limit(1500)

    if (!assetsRes.error) {
      const grouped: Record<string, Asset[]> = {}
      for (const a of (assetsRes.data ?? []) as Asset[]) {
        if (!grouped[a.character_id]) grouped[a.character_id] = []
        grouped[a.character_id].push(a)
      }
      const jobs: Array<Promise<[string, 'cover' | 'role', string, string]>> = []
      for (const [id, arr] of Object.entries(grouped)) {
        const cover = arr.find((x) => x.kind === 'cover')?.storage_path || ''
        const role = arr.find((x) => x.kind === 'full_body')?.storage_path || arr.find((x) => x.kind === 'head')?.storage_path || ''
        if (cover) {
          jobs.push(
            supabase.storage
              .from('character-assets')
              .createSignedUrl(cover, 3600)
              .then((r) => [id, 'cover', cover, r.data?.signedUrl || ''] as [string, 'cover', string, string]),
          )
        }
        if (role) {
          jobs.push(
            supabase.storage
              .from('character-assets')
              .createSignedUrl(role, 3600)
              .then((r) => [id, 'role', role, r.data?.signedUrl || ''] as [string, 'role', string, string]),
          )
        }
      }
      const signed = await Promise.all(jobs)
      const next: Record<string, Stage> = {}
      for (const [id, kind, path, url] of signed) {
        if (!url) continue
        if (!next[id]) next[id] = {}
        if (kind === 'cover') {
          next[id].coverPath = path
          next[id].coverUrl = url
        } else {
          next[id].rolePath = path
          next[id].roleUrl = url
        }
      }
      setStageById(next)
    }

    const convs = await supabase
      .from('conversations')
      .select('id,character_id,created_at')
      .eq('user_id', userId)
      .in('character_id', ids)
      .order('created_at', { ascending: false })
      .limit(1600)

    const latestByChar: Record<string, Conv> = {}
    if (!convs.error) {
      for (const c of (convs.data ?? []) as Conv[]) {
        const cid = String(c.character_id || '')
        if (!cid || latestByChar[cid]) continue
        latestByChar[cid] = c
      }
    }

    const convIds = Object.values(latestByChar)
      .map((x) => String(x.id || ''))
      .filter(Boolean)

    const states = await supabase
      .from('conversation_states')
      .select('conversation_id,state,updated_at')
      .eq('user_id', userId)
      .in('conversation_id', convIds)
      .limit(1600)

    const byConvId: Record<string, ConvState> = {}
    if (!states.error) {
      for (const s of (states.data ?? []) as ConvState[]) {
        byConvId[String(s.conversation_id || '')] = s
      }
    }

    const nextDigest: Record<string, Digest> = {}
    for (const c of rows) {
      const conv = latestByChar[c.id]
      const convId = String(conv?.id || '')
      const st = asRecord(byConvId[convId]?.state)
      const ledger = asRecord(st.ledger)
      const memory = asRecord(st.memory)
      const wardrobe = asRecord(ledger.wardrobe)
      const outfit = String(wardrobe.current_outfit || '').trim()
      const wardrobeItems = names(wardrobe.items)
      const inventoryCount = asArray(ledger.inventory).length
      const npcCount = asArray(ledger.npc_database).length
      const highlightsCount = asArray(memory.highlights).length
      const completeness = [!!outfit, inventoryCount > 0, npcCount > 0, highlightsCount > 0].filter(Boolean).length
      nextDigest[c.id] = {
        conversationId: convId,
        outfit,
        wardrobe: wardrobeItems,
        inventoryCount,
        npcCount,
        highlightsCount,
        completeness,
        updatedAt: String(byConvId[convId]?.updated_at || conv?.created_at || ''),
      }
    }
    setDigestById(nextDigest)
    setLoading(false)
  }, [router])

  const quickSetOutfit = useCallback(
    async (characterId: string, outfit: string) => {
      const convId = String(digestById[characterId]?.conversationId || '')
      if (!convId || !outfit || savingOutfitId) return
      setSavingOutfitId(characterId)
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (!token) throw new Error('Session expired')
        const resp = await fetch('/api/state/wardrobe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ conversationId: convId, currentOutfit: outfit, confirmed: true }),
        })
        if (!resp.ok) throw new Error(`Request failed (${resp.status})`)
        setDigestById((prev) => {
          const d = prev[characterId]
          if (!d) return prev
          return { ...prev, [characterId]: { ...d, outfit, updatedAt: new Date().toISOString() } }
        })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSavingOutfitId('')
      }
    },
    [digestById, savingOutfitId],
  )

  const loadStageForSelected = useCallback(async () => {
    if (!selectedId) return
    const res = await supabase
      .from('character_assets')
      .select('character_id,kind,storage_path,created_at')
      .eq('character_id', selectedId)
      .in('kind', ['cover', 'full_body', 'head'])
      .order('created_at', { ascending: false })
      .limit(120)

    if (res.error) return
    const uniq = Array.from(new Map(((res.data ?? []) as Asset[]).map((x) => [x.storage_path, x])).values())
    const sign = await Promise.all(
      uniq.map(async (a) => {
        const s = await supabase.storage.from('character-assets').createSignedUrl(a.storage_path, 3600)
        return { a, url: s.data?.signedUrl || '' }
      }),
    )

    const bgs: Option[] = []
    const roles: Option[] = []
    for (const x of sign) {
      if (!x.url) continue
      if (isBg(x.a)) bgs.push({ kind: x.a.kind, path: x.a.storage_path, url: x.url })
      if (isRole(x.a)) roles.push({ kind: x.a.kind, path: x.a.storage_path, url: x.url })
    }
    setBgOptions(bgs.slice(0, 16))
    setRoleOptions(roles.slice(0, 16))

    const ps = buildVisualPresets({
      backgrounds: bgs.map((x) => ({ path: x.path, kind: x.kind })),
      roleAssets: roles.map((x) => ({ path: x.path, kind: x.kind })),
      wardrobeItems: digestById[selectedId]?.wardrobe || [],
    })
    setPresets(ps.slice(0, 8))

    const current = stageById[selectedId] || {}
    setPreview({
      bgPath: current.coverPath || bgs[0]?.path || '',
      bgUrl: current.coverUrl || bgs[0]?.url || '',
      rolePath: current.rolePath || roles[0]?.path || '',
      roleUrl: current.roleUrl || roles[0]?.url || '',
      scale: 108,
      y: 0,
    })
  }, [digestById, selectedId, stageById])
  const applyPreset = useCallback(
    async (p: VisualPreset) => {
      setPreview((prev) => ({
        ...prev,
        bgPath: p.bgPath || prev.bgPath,
        bgUrl: bgOptions.find((x) => x.path === p.bgPath)?.url || prev.bgUrl,
        rolePath: p.rolePath || prev.rolePath,
        roleUrl: roleOptions.find((x) => x.path === p.rolePath)?.url || prev.roleUrl,
        scale: p.scale || prev.scale,
        y: p.y || 0,
      }))
      if (selectedId && p.outfit && p.outfit !== (digestById[selectedId]?.outfit || '')) {
        await quickSetOutfit(selectedId, p.outfit)
      }
    },
    [bgOptions, digestById, quickSetOutfit, roleOptions, selectedId],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    void loadStageForSelected()
  }, [selectedId, loadStageForSelected])

  return (
    <div className="uiPage">
      <AppShell
        title="Wardrobe Studio"
        badge="wardrobe"
        subtitle="Outfit + static visual layer operations across all characters."
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">Asset Hub</span>
            <h2 className="uiHeroTitle">Compose static scenes and keep ledger clean</h2>
            <p className="uiHeroSub">Select a character card, switch layers, apply presets, and sync outfit state with one click.</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{stats.total}</b>
              <span>Total</span>
            </div>
            <div className="uiKpi">
              <b>{stats.unlocked}</b>
              <span>Unlocked</span>
            </div>
            <div className="uiKpi">
              <b>{stats.complete}</b>
              <span>Complete</span>
            </div>
          </div>
        </section>

        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">Loading...</div>}

        {!loading && (
          <div className="uiWardrobeWorkspace">
            <aside className="uiWardrobeSidebar">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">Search</div>
                    <div className="uiPanelSub">Pick a character to enter stage composer</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <input className="uiInput" placeholder="Search by name..." value={query} onChange={(e) => setQuery(e.target.value)} />
                  <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/characters')}>
                    Character Manager
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
                    Open Square
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/home')}>
                    Open Home
                  </button>
                </div>
              </div>
            </aside>

            <div className="uiWardrobeMain">
              {selected ? (
                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">Stage Composer: {selected.name}</div>
                      <div className="uiPanelSub">Background + role layers + preset outfit sync</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    <div
                      style={{
                        position: 'relative',
                        height: 300,
                        borderRadius: 14,
                        overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,.14)',
                        background: 'linear-gradient(180deg, rgba(19,19,19,.95), rgba(58,21,30,.92))',
                      }}
                    >
                      {preview.bgUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={preview.bgUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.86 }} />
                      ) : null}
                      {preview.roleUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview.roleUrl}
                          alt=""
                          style={{
                            position: 'absolute',
                            left: '50%',
                            bottom: 0,
                            height: '92%',
                            width: 'auto',
                            transform: `translateX(-50%) translateY(${preview.y}px) scale(${preview.scale / 100})`,
                            transformOrigin: 'center bottom',
                            filter: 'drop-shadow(0 16px 28px rgba(0,0,0,.5))',
                          }}
                        />
                      ) : null}
                      {!preview.bgUrl && !preview.roleUrl ? <div className="uiCardMediaFallback">No stage assets</div> : null}
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="uiBadge">Outfit: {digestById[selected.id]?.outfit || 'not set'}</span>
                      <span className="uiBadge">Wardrobe: {digestById[selected.id]?.wardrobe.length || 0}</span>
                      <span className="uiBadge">Ledger: {digestById[selected.id]?.completeness || 0}/4</span>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="uiHint">Presets</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {presets.map((p) => (
                          <button key={p.id} className="uiPill" onClick={() => void applyPreset(p)} title={`${p.label}${p.outfit ? ` / ${p.outfit}` : ''}`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="uiHint">Backgrounds</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {bgOptions.map((a) => (
                          <button key={a.path} className={`uiPill ${a.path === preview.bgPath ? 'uiPillActive' : ''}`} onClick={() => setPreview((v) => ({ ...v, bgPath: a.path, bgUrl: a.url }))}>
                            {shortPath(a.path)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="uiHint">Role Layers</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {roleOptions.map((a) => (
                          <button key={a.path} className={`uiPill ${a.path === preview.rolePath ? 'uiPillActive' : ''}`} onClick={() => setPreview((v) => ({ ...v, rolePath: a.path, roleUrl: a.url }))}>
                            {shortPath(a.path)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label className="uiHint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        Scale
                        <input type="range" min={80} max={140} value={preview.scale} onChange={(e) => setPreview((v) => ({ ...v, scale: Number(e.target.value) }))} />
                        {preview.scale}%
                      </label>
                      <label className="uiHint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        Y
                        <input type="range" min={-20} max={24} value={preview.y} onChange={(e) => setPreview((v) => ({ ...v, y: Number(e.target.value) }))} />
                        {preview.y}
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="uiGrid" style={{ marginTop: 0 }}>
                {filtered.map((c) => {
                  const d = digestById[c.id]
                  const s = stageById[c.id] || {}
                  const selectedCard = c.id === selectedId
                  return (
                    <div key={c.id} className="uiCard" style={{ marginTop: 0, borderColor: selectedCard ? 'rgba(249,217,142,.42)' : undefined }}>
                      <button type="button" onClick={() => setSelectedId(c.id)} style={{ all: 'unset', cursor: 'pointer', display: 'block' }}>
                        <div className="uiWardrobeCardStage">
                          {s.coverUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="uiWardrobeStageBg" src={s.coverUrl} alt="" />
                          ) : null}
                          {s.roleUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="uiWardrobeStageRole" src={s.roleUrl} alt="" />
                          ) : null}
                          {!s.coverUrl && !s.roleUrl ? <div className="uiCardMediaFallback">No stage assets</div> : null}
                        </div>
                      </button>

                      <div className="uiCardTitle">{c.name}</div>
                      <div className="uiCardMeta">{isUnlocked(c) ? 'Unlocked' : 'Created'} · {d?.updatedAt ? relTime(d.updatedAt) : 'No update'}</div>

                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span className="uiBadge">Ledger {d?.completeness || 0}/4</span>
                        <span className="uiBadge">Outfit {d?.outfit || '-'}</span>
                        <span className="uiBadge">NPC {d?.npcCount || 0}</span>
                        <span className="uiBadge">Highlights {d?.highlightsCount || 0}</span>
                      </div>

                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(d?.wardrobe || []).slice(0, 6).map((w) => (
                          <button key={`${c.id}:${w}`} className={`uiPill ${w === d?.outfit ? 'uiPillActive' : ''}`} disabled={savingOutfitId === c.id} onClick={() => void quickSetOutfit(c.id, w)}>
                            {w}
                          </button>
                        ))}
                      </div>

                      <div className="uiCardActions">
                        <button className="uiBtn uiBtnPrimary" onClick={() => router.push(`/chat/${c.id}`)}>Chat</button>
                        <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/characters/${c.id}/assets`)}>Assets</button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${c.id}`)}>Home</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}

