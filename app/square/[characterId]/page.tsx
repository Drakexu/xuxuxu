'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type PubCharacter = {
  id: string
  name: string
  system_prompt: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  visibility?: string | null
  created_at?: string
}

type CharacterAssetRow = { kind: string; storage_path: string; created_at?: string | null }

type Alert = { type: 'ok' | 'err'; text: string } | null

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

export default function SquareDetailPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const id = params.characterId

  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [item, setItem] = useState<PubCharacter | null>(null)
  const [unlockedCharId, setUnlockedCharId] = useState<string>('') // user's local character id
  const [imgUrl, setImgUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const canUnlock = useMemo(() => !!item && !busy && !unlockedCharId, [item, busy, unlockedCharId])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setAlert(null)
      setItem(null)
      setUnlockedCharId('')
      setImgUrl('')

      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.replace('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .select('id,name,system_prompt,profile,settings,visibility,created_at')
        .eq('id', id)
        .maybeSingle()

      if (r.error || !r.data) {
        setAlert({ type: 'err', text: r.error?.message || '角色不存在' })
        setLoading(false)
        return
      }

      const c = r.data as PubCharacter
      if (c.visibility !== 'public') {
        setAlert({ type: 'err', text: '该角色不是公开角色，无法在广场查看。' })
        setLoading(false)
        return
      }

      setItem(c)

      // Already unlocked?
      try {
        const me = await supabase.from('characters').select('id,settings,created_at').order('created_at', { ascending: false }).limit(300)
        if (!me.error) {
          const rows = (me.data ?? []) as Array<{ id: string; settings?: unknown }>
          const found = rows.find((x) => {
            const s = asRecord(x.settings)
            return typeof s.source_character_id === 'string' && s.source_character_id === id
          })
          if (found?.id) setUnlockedCharId(found.id)
        }
      } catch {
        // ignore
      }

      // Media
      try {
        const assets = await supabase
          .from('character_assets')
          .select('kind,storage_path,created_at')
          .eq('character_id', id)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(20)

        if (!assets.error && (assets.data ?? []).length) {
          const path = pickAssetPath((assets.data ?? []) as CharacterAssetRow[])
          if (path) {
            const signed = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
            if (!signed.error && signed.data?.signedUrl) setImgUrl(signed.data.signedUrl)
          }
        }
      } catch {
        // ignore
      }

      setLoading(false)
    }

    load()
  }, [id, router])

  const unlock = async () => {
    if (!item || busy) return
    setBusy(true)
    setAlert(null)

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      router.replace('/login')
      return
    }

    const payloadV2: {
      user_id: string
      name: string
      system_prompt: string
      visibility: 'private'
      profile: Record<string, unknown>
      settings: Record<string, unknown>
    } = {
      user_id: userId,
      name: item.name,
      system_prompt: item.system_prompt,
      visibility: 'private',
      profile: item.profile ?? {},
      settings: { ...(item.settings ?? {}), source_character_id: item.id, unlocked_from_square: true },
    }

    const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `解锁失败：${msg}` })
        setBusy(false)
        return
      }

      const r2 = await supabase.from('characters').insert({ user_id: userId, name: item.name, system_prompt: item.system_prompt }).select('id').single()
      if (r2.error || !r2.data?.id) {
        setAlert({ type: 'err', text: `解锁失败：${r2.error?.message || 'unknown error'}` })
        setBusy(false)
        return
      }

      setUnlockedCharId(r2.data.id)
      setAlert({ type: 'ok', text: '已解锁。' })
      setBusy(false)
      return
    }

    setUnlockedCharId(r1.data.id)
    setAlert({ type: 'ok', text: '已解锁。' })
    setBusy(false)
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">角色详情</h1>
              <span className="uiBadge">square</span>
            </div>
            <p className="uiSubtitle">查看公开角色并解锁到你的账号。</p>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              返回广场
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && item && (
          <div className="uiPanel">
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">{item.name}</div>
                <div className="uiPanelSub">公开角色</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {unlockedCharId ? (
                  <button className="uiBtn uiBtnPrimary" onClick={() => router.push(`/chat/${unlockedCharId}`)}>
                    发起对话
                  </button>
                ) : (
                  <button className="uiBtn uiBtnPrimary" disabled={!canUnlock} onClick={unlock}>
                    {busy ? '解锁中...' : '解锁'}
                  </button>
                )}
                <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/home')}>
                  首页
                </button>
              </div>
            </div>

            <div className="uiForm">
              <div className="uiCardMedia" style={{ borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(0,0,0,.08)' }}>
                {imgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgUrl} alt="" />
                ) : (
                  <div className="uiCardMediaFallback">No image</div>
                )}
              </div>

              <div className="uiHint" style={{ marginTop: 12 }}>
                System Prompt（仅展示前 400 字）：
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, border: '1px solid rgba(0,0,0,.08)', borderRadius: 14, padding: 12, background: '#fff' }}>
                {(item.system_prompt || '').slice(0, 400)}
                {(item.system_prompt || '').length > 400 ? '…' : ''}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

