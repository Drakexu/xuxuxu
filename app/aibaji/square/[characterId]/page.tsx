'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Character = {
  id: string
  name: string
  system_prompt?: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  visibility?: string | null
}

type AssetRow = { kind: string; storage_path: string; created_at?: string | null }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(r: Record<string, unknown>, k: string): string {
  const v = r[k]
  return typeof v === 'string' ? v.trim() : ''
}

function pickAssetPath(rows: AssetRow[]): string {
  const byKind: Record<string, AssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  for (const k of ['cover', 'full_body', 'head']) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

const FAVORITES_KEY = 'aibaji_favorites'

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

function saveFavorites(ids: string[]): void {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

export default function CharacterDetailPage() {
  const params = useParams()
  const router = useRouter()
  const characterId = String(params?.characterId || '')

  const [character, setCharacter] = useState<Character | null>(null)
  const [imgUrl, setImgUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [isFavorited, setIsFavorited] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [alert, setAlert] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (alert) {
      const t = setTimeout(() => setAlert(null), 2500)
      return () => clearTimeout(t)
    }
  }, [alert])

  useEffect(() => {
    const favs = loadFavorites()
    setIsFavorited(favs.includes(characterId))
  }, [characterId])

  useEffect(() => {
    if (!characterId) return
    const run = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('characters')
        .select('id,name,system_prompt,profile,settings,visibility')
        .eq('id', characterId)
        .maybeSingle()
      if (error || !data) { setLoading(false); return }
      setCharacter(data as Character)

      const { data: assets, error: ae } = await supabase
        .from('character_assets')
        .select('kind,storage_path,created_at')
        .eq('character_id', characterId)
        .in('kind', ['cover', 'full_body', 'head'])
        .order('created_at', { ascending: false })
        .limit(20)
      if (!ae && assets) {
        const path = pickAssetPath(assets as AssetRow[])
        if (path) {
          const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
          if (s.data?.signedUrl) setImgUrl(s.data.signedUrl)
        }
      }
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [characterId])

  const toggleFavorite = useCallback(() => {
    const favs = loadFavorites()
    if (isFavorited) {
      saveFavorites(favs.filter((id) => id !== characterId))
      setIsFavorited(false)
      setAlert({ type: 'ok', text: '已取消收藏' })
    } else {
      saveFavorites([...favs.filter((id) => id !== characterId), characterId])
      setIsFavorited(true)
      setAlert({ type: 'ok', text: '已收藏，可在聊天页找到' })
    }
  }, [characterId, isFavorited])

  const startChat = useCallback(async () => {
    if (chatLoading) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) {
      router.push('/login')
      return
    }
    setChatLoading(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/aibaji/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceCharacterId: characterId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.localCharacterId) {
        setAlert({ type: 'err', text: json.error || '启动失败，请重试' })
        return
      }
      router.push(`/aibaji/chat/${json.localCharacterId}`)
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : '网络错误' })
    } finally {
      setChatLoading(false)
    }
  }, [characterId, chatLoading, router])

  if (loading) {
    return <div className="detailLoading">加载中...</div>
  }

  if (!character) {
    return (
      <div className="detailError">
        <div>角色不存在或已被删除</div>
        <button className="detailBackBtn" onClick={() => router.push('/aibaji/square')}>← 回到广场</button>
      </div>
    )
  }

  const p = asRecord(character.profile)
  const gender = getStr(p, 'gender') || getStr(p, 'sex')
  const age = getStr(p, 'age')
  const occupation = getStr(p, 'occupation')
  const org = getStr(p, 'organization')
  const summary = getStr(p, 'summary') || getStr(p, 'introduction') || getStr(p, 'description')
  const personality = getStr(p, 'personality') || getStr(p, 'personality_summary')

  const metaItems = [
    gender && `性别：${gender}`,
    age && `年龄：${age}岁`,
    occupation && `职业：${occupation}`,
    org && `所属：${org}`,
  ].filter(Boolean)

  return (
    <div className="detailPage">
      <button className="detailBackBtn" onClick={() => router.back()}>← 返回</button>

      {alert && (
        <div className={`detailAlert${alert.type === 'err' ? ' detailAlertErr' : ''}`}>
          {alert.text}
        </div>
      )}

      <div className="detailLayout">
        {/* 左侧：图片 */}
        <div className="detailImageWrap">
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="detailImage" src={imgUrl} alt={character.name} />
          ) : (
            <div className="detailImageFallback">
              <span>{character.name?.[0] || '?'}</span>
            </div>
          )}
        </div>

        {/* 右侧：信息 */}
        <div className="detailInfo">
          <h1 className="detailName">{character.name}</h1>

          {metaItems.length > 0 && (
            <div className="detailMeta">
              {metaItems.map((item, i) => (
                <span key={i} className="detailMetaItem">{item}</span>
              ))}
            </div>
          )}

          {summary && <p className="detailSummary">{summary}</p>}
          {personality && <p className="detailPersonality">{personality}</p>}

          <div className="detailActions">
            <button
              className={`detailBtn detailBtnSecondary${isFavorited ? ' detailBtnFavorited' : ''}`}
              onClick={toggleFavorite}
            >
              {isFavorited ? '★ 已收藏' : '☆ 收藏'}
            </button>
            <button
              className="detailBtn detailBtnPrimary"
              onClick={() => { void startChat() }}
              disabled={chatLoading}
            >
              {chatLoading ? '启动中...' : '开始聊天 →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
