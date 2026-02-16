'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
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
  const [unlockedActive, setUnlockedActive] = useState<boolean>(false)
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
      const userId = userData.user?.id
      if (!userId) {
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
        const me = await supabase
          .from('characters')
          .select('id,settings,created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(400)
        if (!me.error) {
          const rows = (me.data ?? []) as Array<{ id: string; settings?: unknown }>
          const found = rows.find((x) => {
            const s = asRecord(x.settings)
            return typeof s.source_character_id === 'string' && s.source_character_id === id
          })
          if (found?.id) {
            setUnlockedCharId(found.id)
            const s = asRecord(found.settings)
            setUnlockedActive(s.activated !== false && s.home_hidden !== true)
          }
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
      settings: {
        ...(item.settings ?? {}),
        source_character_id: item.id,
        unlocked_from_square: true,
        activated: true,
        home_hidden: false,
        activated_at: new Date().toISOString(),
        activated_order: Date.now(),
      },
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
      setUnlockedActive(true)
      setAlert({ type: 'ok', text: '已解锁。' })
      setBusy(false)
      return
    }

    setUnlockedCharId(r1.data.id)
    setUnlockedActive(true)
    setAlert({ type: 'ok', text: '已解锁。' })
    setBusy(false)
  }

  const toggleActivation = async (nextActive: boolean) => {
    if (!unlockedCharId || busy) return
    setBusy(true)
    setAlert(null)
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
        .eq('id', unlockedCharId)
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
        .eq('id', unlockedCharId)
        .eq('user_id', userId)
      if (upd.error) throw new Error(upd.error.message)
      setUnlockedActive(nextActive)
      setAlert({ type: 'ok', text: nextActive ? '已激活到首页队列。' : '已取消激活。' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="uiPage">
      <AppShell
        title="Character"
        badge="square"
        subtitle="查看公开角色，并解锁/激活到你的首页可聊队列。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            返回广场
          </button>
        }
      >
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && item && (
          <div className="uiPanel">
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">{item.name}</div>
                <div className="uiPanelSub">公开角色{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {unlockedCharId ? (
                  <>
                    <button className="uiBtn uiBtnPrimary" onClick={() => router.push(`/chat/${unlockedCharId}`)}>
                      发起对话
                    </button>
                    <button className="uiBtn uiBtnSecondary" disabled={busy} onClick={() => toggleActivation(!unlockedActive)}>
                      {unlockedActive ? '取消激活' : '激活到首页'}
                    </button>
                  </>
                ) : (
                  <button className="uiBtn uiBtnPrimary" disabled={!canUnlock} onClick={unlock}>
                    {busy ? '解锁中...' : '解锁'}
                  </button>
                )}
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

              {(() => {
                const p = asRecord(item.profile)
                const s = asRecord(item.settings)
                const age = typeof p.age === 'string' ? p.age.trim() : ''
                const occupation = typeof p.occupation === 'string' ? p.occupation.trim() : ''
                const org = typeof p.organization === 'string' ? p.organization.trim() : ''
                const teen = !!s.teen_mode || s.age_mode === 'teen'
                const romance = typeof s.romance_mode === 'string' ? s.romance_mode : ''
                const authorNote = (() => {
                  const cf = asRecord(s.creation_form)
                  const pub = asRecord(cf.publish)
                  return typeof pub.author_note === 'string' ? pub.author_note.trim() : ''
                })()

                const meta = [age ? `${age}岁` : '', occupation, org].filter(Boolean).join(' · ')
                return (
                  <>
                    {meta && <div className="uiHint">{meta}</div>}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className="uiBadge">{teen ? 'teen' : 'adult'}</span>
                      <span className="uiBadge">{romance || 'ROMANCE_ON'}</span>
                      {unlockedCharId ? <span className="uiBadge">已激活</span> : null}
                    </div>

                    {authorNote && (
                      <div className="uiPanel" style={{ marginTop: 12 }}>
                        <div className="uiPanelHeader">
                          <div>
                            <div className="uiPanelTitle">作者说</div>
                            <div className="uiPanelSub">角色详情说明</div>
                          </div>
                        </div>
                        <div className="uiForm">
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{authorNote}</div>
                        </div>
                      </div>
                    )}

                    <div className="uiHint" style={{ marginTop: 12 }}>
                      System Prompt（仅展示前 400 字）：
                    </div>
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.6,
                        border: '1px solid rgba(0,0,0,.08)',
                        borderRadius: 14,
                        padding: 12,
                        background: '#fff',
                      }}
                    >
                      {(item.system_prompt || '').slice(0, 400)}
                      {(item.system_prompt || '').length > 400 ? '…' : ''}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
