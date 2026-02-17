'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type PublicRole = {
  id: string
  name: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
}

type CharacterAssetRow = {
  character_id?: string
  kind: string
  storage_path: string
  created_at?: string | null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
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

function unlockPrice(settings: unknown) {
  const s = asRecord(settings)
  const own = Number(s.unlock_price_coins)
  if (Number.isFinite(own) && own > 0) return Math.max(0, Math.min(Math.floor(own), 200000))
  const cf = asRecord(s.creation_form)
  const pub = asRecord(cf.publish)
  const nested = Number(pub.unlock_price_coins)
  if (Number.isFinite(nested) && nested > 0) return Math.max(0, Math.min(Math.floor(nested), 200000))
  return 0
}

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [featured, setFeatured] = useState<PublicRole[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})

  const stats = useMemo(() => {
    let paid = 0
    let free = 0
    for (const r of featured) {
      if (unlockPrice(r.settings) > 0) paid += 1
      else free += 1
    }
    return { total: featured.length, paid, free }
  }, [featured])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const user = await supabase.auth.getUser()
      if (user.data.user?.id) {
        router.replace('/home')
        return
      }
      setChecking(false)

      const roles = await supabase
        .from('characters')
        .select('id,name,profile,settings')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(16)
      const rows = (roles.data ?? []) as PublicRole[]
      setFeatured(rows)

      const ids = rows.map((x) => x.id).filter(Boolean)
      if (!ids.length) {
        setLoading(false)
        return
      }
      const assets = await supabase
        .from('character_assets')
        .select('character_id,kind,storage_path,created_at')
        .in('character_id', ids)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(320)
      if (!assets.error) {
        const grouped: Record<string, CharacterAssetRow[]> = {}
        for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
          const cid = String(row.character_id || '').trim()
          if (!cid) continue
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(row)
        }
        const entries = Object.entries(grouped)
          .map(([characterId, rs]) => [characterId, pickAssetPath(rs)] as const)
          .filter(([, path]) => !!path)
        const signed = await Promise.all(
          entries.map(async ([characterId, path]) => {
            const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
            return [characterId, s.data?.signedUrl || ''] as const
          }),
        )
        const nextMap: Record<string, string> = {}
        for (const [characterId, url] of signed) if (url) nextMap[characterId] = url
        setImgById(nextMap)
      }
      setLoading(false)
    }

    run().catch(() => {
      setChecking(false)
      setLoading(false)
    })
  }, [router])

  return (
    <div className="uiLanding">
      <section className="uiLandingHero">
        <span className="uiBadge">AibaJi Web</span>
        <h1 className="uiLandingTitle">Web Replica Roadmap: Home / Square / Creator / Wardrobe / Wallet</h1>
        <p className="uiLandingSub">This build focuses on role life simulation, public role unlock loop, creator publishing, static layer dressing, and wallet economy.</p>
        <div className="uiActions">
          <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/login')}>
            Login
          </button>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            Browse Square
          </button>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
            Create Role
          </button>
        </div>
        {checking ? <div className="uiSkeleton">Checking session...</div> : null}
      </section>

      <section className="uiLandingGrid">
        <div className="uiLandingItem"><b>Home</b>Activated roles generate moment/diary/schedule feed continuously.</div>
        <div className="uiLandingItem"><b>Square</b>Public role discovery, social feedback, paid unlock, and activation queue.</div>
        <div className="uiLandingItem"><b>Create</b>Role studio for prompt, assets, publish config, and creator metrics.</div>
        <div className="uiLandingItem"><b>Wardrobe</b>Static stage composer with layer switching and outfit sync.</div>
        <div className="uiLandingItem"><b>Wallet</b>Coins, unlock receipts, and creator revenue share history.</div>
      </section>

      <section className="uiPanel" style={{ marginTop: 0 }}>
        <div className="uiPanelHeader">
          <div>
            <div className="uiPanelTitle">Featured Public Roles</div>
            <div className="uiPanelSub">
              total {stats.total} · free {stats.free} · paid {stats.paid}
            </div>
          </div>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            View All
          </button>
        </div>
        <div className="uiForm">
          {(checking || loading) && <div className="uiSkeleton">Loading roles...</div>}
          {!checking && !loading && featured.length === 0 && <div className="uiHint">No public roles yet.</div>}
          {!checking && !loading && featured.length > 0 && (
            <div className="uiGrid">
              {featured.slice(0, 10).map((c) => (
                <button key={c.id} className="uiCard" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => router.push(`/square/${c.id}`)}>
                  <div className="uiCardMedia">
                    {imgById[c.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgById[c.id]} alt="" />
                    ) : (
                      <div className="uiCardMediaFallback">No image</div>
                    )}
                  </div>
                  <div className="uiCardTitle">{c.name}</div>
                  <div className="uiCardMeta">{unlockPrice(c.settings) > 0 ? `${unlockPrice(c.settings)} coins` : 'Free unlock'}</div>
                  <div className="uiCardActions">
                    <span className="uiBadge">Public</span>
                    <span className="uiBadge">Detail</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
