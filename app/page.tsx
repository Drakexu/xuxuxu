'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type PubCharacter = {
  id: string
  name: string
  profile?: Record<string, unknown>
}

type CharacterAssetRow = { character_id?: string; kind: string; storage_path: string; created_at?: string | null }

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

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [featured, setFeatured] = useState<PubCharacter[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [loadingFeatured, setLoadingFeatured] = useState(false)

  useEffect(() => {
    const checkSession = async () => {
      setLoadingFeatured(true)
      const { data } = await supabase.auth.getUser()
      if (data.user) {
        router.replace('/home')
        return
      }
      setChecking(false)

      const r1 = await supabase
        .from('characters')
        .select('id,name,profile')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(12)
      if (!r1.error) {
        const rows = (r1.data ?? []) as PubCharacter[]
        setFeatured(rows)
        try {
          const ids = rows.map((x) => x.id).filter(Boolean)
          if (ids.length) {
            const assets = await supabase
              .from('character_assets')
              .select('character_id,kind,storage_path,created_at')
              .in('character_id', ids)
              .in('kind', ['cover', 'full_body', 'head'])
              .order('created_at', { ascending: false })
              .limit(300)
            if (!assets.error) {
              const grouped: Record<string, CharacterAssetRow[]> = {}
              for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
                const cid = String(row.character_id || '').trim()
                if (!cid) continue
                if (!grouped[cid]) grouped[cid] = []
                grouped[cid].push(row)
              }
              const entries = Object.entries(grouped)
                .map(([characterId, rows2]) => [characterId, pickAssetPath(rows2)] as const)
                .filter(([, path]) => !!path)

              if (entries.length) {
                const signed = await Promise.all(
                  entries.map(async ([characterId, path]) => {
                    const s = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
                    return [characterId, s.data?.signedUrl || ''] as const
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
          // ignore featured media failures
        }
      }
      setLoadingFeatured(false)
    }

    checkSession().catch(() => {
      setChecking(false)
      setLoadingFeatured(false)
    })
  }, [router])

  return (
    <div className="uiLanding">
      <section className="uiLandingHero">
        <span className="uiBadge">XuxuXu Web Beta</span>
        <h1 className="uiLandingTitle">在 Web 上复刻爱巴基（语音除外）</h1>
        <p className="uiLandingSub">你可以管理已解锁角色、浏览广场公开角色、创建自己的角色设定，并持续查看角色自动生成的朋友圈、日记和日程片段。</p>
        <div className="uiActions">
          <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/login')}>
            登录开始
          </button>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            先看广场
          </button>
        </div>
        {checking ? <div className="uiSkeleton">正在检查登录态...</div> : null}
      </section>

      <section className="uiLandingGrid">
        <div className="uiLandingItem">
          <b>首页</b>
          已激活角色的朋友圈、日记、日程片段聚合流，可直接跳转到聊天和单角色动态中心。
        </div>
        <div className="uiLandingItem">
          <b>广场</b>
          浏览公开角色详情，解锁到自己的可聊天队列，再按需激活到首页。
        </div>
        <div className="uiLandingItem">
          <b>创建角色</b>
          管理你创建过的角色卡片，继续编辑设定、维护衣柜/资产，并发布到广场。
        </div>
      </section>

      <section className="uiPanel" style={{ marginTop: 0 }}>
        <div className="uiPanelHeader">
          <div>
            <div className="uiPanelTitle">广场热门角色</div>
            <div className="uiPanelSub">登录前也可先浏览公开角色，选中后再解锁。</div>
          </div>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            查看全部
          </button>
        </div>
        <div className="uiForm">
          {(checking || loadingFeatured) && <div className="uiSkeleton">加载角色中...</div>}
          {!checking && !loadingFeatured && featured.length === 0 && <div className="uiHint">暂无公开角色</div>}
          {!checking && !loadingFeatured && featured.length > 0 && (
            <div className="uiGrid">
              {featured.slice(0, 8).map((c) => {
                const p = asRecord(c.profile)
                const meta = [String(p.occupation || '').trim(), String(p.organization || '').trim()].filter(Boolean).join(' · ')
                return (
                  <button key={c.id} className="uiCard" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => router.push(`/square/${c.id}`)}>
                    <div className="uiCardMedia">
                      {imgById[c.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgById[c.id]} alt="" />
                      ) : (
                        <div className="uiCardMediaFallback">暂无图片</div>
                      )}
                    </div>
                    <div className="uiCardTitle">{c.name}</div>
                    <div className="uiCardMeta">{meta || '公开角色'}</div>
                    <div className="uiCardActions">
                      <span className="uiBadge">公开</span>
                      <span className="uiBadge">详情</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
