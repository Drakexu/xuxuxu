'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Character = {
  id: string
  name: string
  visibility?: 'private' | 'public' | string | null
  settings?: Record<string, unknown>
  created_at?: string
}

type Alert = { type: 'ok' | 'err'; text: string } | null

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isFromSquare(c: Character): boolean {
  const s = asRecord(c.settings)
  return typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0
}

export default function CharactersPage() {
  const router = useRouter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState('')
  const [publishingId, setPublishingId] = useState('')
  const [alert, setAlert] = useState<Alert>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    if (alert) {
      const t = setTimeout(() => setAlert(null), 2500)
      return () => clearTimeout(t)
    }
  }, [alert])

  const load = async () => {
    setLoading(true)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) {
      setIsLoggedIn(false)
      setLoading(false)
      return
    }
    setIsLoggedIn(true)
    const { data, error } = await supabase
      .from('characters')
      .select('id,name,visibility,settings,created_at')
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false })
      .limit(60)
    if (!error && data) {
      // Show only user-created characters (not from square)
      setCharacters((data as Character[]).filter((c) => !isFromSquare(c)))
    }
    setLoading(false)
  }

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  const togglePublish = async (c: Character) => {
    if (publishingId) return
    setPublishingId(c.id)
    try {
      const nextVisibility = c.visibility === 'public' ? 'private' : 'public'
      const { error } = await supabase
        .from('characters')
        .update({ visibility: nextVisibility })
        .eq('id', c.id)
      if (error) { setAlert({ type: 'err', text: error.message }); return }
      setCharacters((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, visibility: nextVisibility } : x)),
      )
      setAlert({ type: 'ok', text: nextVisibility === 'public' ? '已发布到广场' : '已设为私密' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : '操作失败' })
    } finally {
      setPublishingId('')
    }
  }

  const deleteCharacter = async (c: Character) => {
    if (deletingId) return
    if (!window.confirm(`确认删除「${c.name}」？此操作不可撤销。`)) return
    setDeletingId(c.id)
    try {
      const { error } = await supabase.from('characters').delete().eq('id', c.id)
      if (error) { setAlert({ type: 'err', text: error.message }); return }
      setCharacters((prev) => prev.filter((x) => x.id !== c.id))
      setAlert({ type: 'ok', text: '已删除' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : '删除失败' })
    } finally {
      setDeletingId('')
    }
  }

  if (!isLoggedIn && !loading) {
    return (
      <div className="charactersPage">
        <div className="charactersEmpty">
          <div className="charactersEmptyTitle">请先登录</div>
          <button className="newCharBtn" onClick={() => router.push('/login')}>去登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="charactersPage">
      {alert && (
        <div className={`charactersAlert${alert.type === 'err' ? ' charactersAlertErr' : ''}`}>
          {alert.text}
        </div>
      )}

      <div className="charactersTopBar">
        <h2 className="charactersTitle">捏崽</h2>
        <button className="newCharBtn" onClick={() => router.push('/aibaji/characters/new')}>
          + 创建新角色
        </button>
      </div>

      {loading && <div className="charactersLoading">加载中...</div>}

      {!loading && characters.length === 0 && (
        <div className="charactersEmpty">
          <div className="charactersEmptyTitle">还没有创建过角色</div>
          <div className="charactersEmptyHint">创建一个属于你的 AI 角色，还可以发布到广场</div>
          <button className="newCharBtn" onClick={() => router.push('/aibaji/characters/new')}>
            + 创建新角色
          </button>
        </div>
      )}

      {!loading && characters.length > 0 && (
        <div className="charactersGrid">
          {characters.map((c) => (
            <div key={c.id} className="characterCard">
              <div className="characterCardTop">
                <div className="characterCardName">{c.name}</div>
                <span className={`characterVisiBadge${c.visibility === 'public' ? ' characterVisiBadgePublic' : ''}`}>
                  {c.visibility === 'public' ? '公开' : '私密'}
                </span>
              </div>
              <div className="characterCardActions">
                <button
                  className="charActionBtn charActionBtnPublish"
                  disabled={publishingId === c.id}
                  onClick={() => { void togglePublish(c) }}
                >
                  {publishingId === c.id ? '处理中...' : c.visibility === 'public' ? '取消发布' : '发布'}
                </button>
                <button
                  className="charActionBtn"
                  onClick={() => router.push(`/aibaji/characters/${c.id}/edit`)}
                >
                  编辑
                </button>
                <button
                  className="charActionBtn charActionBtnDelete"
                  disabled={deletingId === c.id}
                  onClick={() => { void deleteCharacter(c) }}
                >
                  {deletingId === c.id ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
