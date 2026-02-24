'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Plus, Wand2, Globe, Lock, Pencil, Trash2 } from 'lucide-react'

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
      <div className="flex flex-col items-center justify-center gap-5 py-24 px-6">
        <div className="w-16 h-16 rounded-[1.5rem] bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
          <Wand2 className="w-7 h-7 text-zinc-500" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-sm font-black uppercase tracking-tight text-white">请先登录</p>
          <p className="text-[11px] text-zinc-500 leading-relaxed">登录后即可创建你的专属 AI 角色</p>
        </div>
        <button
          onClick={() => router.push('/login')}
          className="px-8 py-3 rounded-2xl text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{ background: 'linear-gradient(to right, #ec4899, #a855f7)', boxShadow: '0 0 20px rgba(236,72,153,0.3)' }}
        >
          去登录
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Alert Toast */}
      {alert && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg border max-w-[320px]"
          style={
            alert.type === 'ok'
              ? { background: 'rgba(236,72,153,0.15)', color: '#ec4899', borderColor: 'rgba(236,72,153,0.3)', backdropFilter: 'blur(12px)' }
              : { background: 'rgba(239,68,68,0.15)', color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)', backdropFilter: 'blur(12px)' }
          }
        >
          {alert.text}
        </div>
      )}

      {/* Banner */}
      <div className="px-5 pt-8 pb-6 relative overflow-hidden border-b border-zinc-800/50">
        <div className="absolute top-0 right-0 w-48 h-48 bg-pink-500/10 blur-[60px] rounded-full pointer-events-none" />
        <div className="flex items-start justify-between relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
              <span className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-500">
                My Characters
              </span>
            </div>
            <h1 className="text-5xl font-black tracking-tighter text-white leading-none mb-2">捏崽</h1>
            <p className="text-xs font-medium text-zinc-500">创建并管理你的 AI 角色</p>
          </div>
          <button
            onClick={() => router.push('/aibaji/characters/new')}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-white text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 mt-1"
            style={{ background: 'linear-gradient(to right, #ec4899, #a855f7)', boxShadow: '0 0 16px rgba(236,72,153,0.3)' }}
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={3} />
            创建
          </button>
        </div>
      </div>

      {/* Character List */}
      <div className="flex flex-col gap-2.5 px-4 pt-4 pb-4">
        {loading && (
          <div className="flex flex-col gap-2.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col gap-3 px-4 py-4 bg-zinc-900 border border-zinc-800/50 rounded-2xl animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="h-4 bg-zinc-800 rounded-full w-1/3" />
                  <div className="h-5 bg-zinc-800 rounded-full w-12" />
                </div>
                <div className="flex gap-2">
                  <div className="h-8 bg-zinc-800 rounded-xl flex-1" />
                  <div className="h-8 bg-zinc-800 rounded-xl flex-1" />
                  <div className="h-8 bg-zinc-800 rounded-xl flex-1" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && characters.length === 0 && (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-[1.25rem] bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
              <Wand2 className="w-6 h-6 text-pink-500 opacity-50" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-black uppercase tracking-widest text-zinc-500">还没有创建过角色</p>
              <p className="text-[11px] text-zinc-600">创建一个专属 AI 角色，还可以发布到广场</p>
            </div>
            <button
              onClick={() => router.push('/aibaji/characters/new')}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-white text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              style={{ background: 'linear-gradient(to right, #ec4899, #a855f7)' }}
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={3} />
              创建新角色
            </button>
          </div>
        )}

        {!loading && characters.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-3 px-4 py-4 bg-zinc-900 border border-zinc-800/50 rounded-2xl"
          >
            {/* Card Header */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black text-white truncate">{c.name}</span>
              <div
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider flex-shrink-0 border"
                style={
                  c.visibility === 'public'
                    ? { background: 'rgba(236,72,153,0.1)', color: '#ec4899', borderColor: 'rgba(236,72,153,0.2)' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#52525b', borderColor: 'rgba(63,63,70,0.5)' }
                }
              >
                {c.visibility === 'public'
                  ? <Globe className="w-2.5 h-2.5" />
                  : <Lock className="w-2.5 h-2.5" />
                }
                <span>{c.visibility === 'public' ? '公开' : '私密'}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                disabled={publishingId === c.id}
                onClick={() => { void togglePublish(c) }}
                className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-50 border"
                style={{ background: 'rgba(236,72,153,0.08)', color: '#ec4899', borderColor: 'rgba(236,72,153,0.2)' }}
              >
                {publishingId === c.id ? '处理中' : c.visibility === 'public' ? '取消发布' : '发布'}
              </button>
              <button
                onClick={() => router.push(`/aibaji/characters/${c.id}/edit`)}
                className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700/50 hover:bg-zinc-700 active:scale-95 transition-all flex items-center justify-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                编辑
              </button>
              <button
                disabled={deletingId === c.id}
                onClick={() => { void deleteCharacter(c) }}
                className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                {deletingId === c.id ? '删除中' : '删除'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
