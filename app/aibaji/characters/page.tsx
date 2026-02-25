'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { PlusCircle, Globe, Lock, Pencil, Trash2, Wand2 } from 'lucide-react'

type Character = {
  id: string
  name: string
  visibility?: 'private' | 'public' | string | null
  settings?: Record<string, unknown>
  created_at?: string
}

type AssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type Alert = { type: 'ok' | 'err'; text: string } | null

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isFromSquare(c: Character): boolean {
  const s = asRecord(c.settings)
  return typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0
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

export default function CharactersPage() {
  const router = useRouter()
  const [characters, setCharacters] = useState<Character[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
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
      const chars = (data as Character[]).filter((c) => !isFromSquare(c))
      setCharacters(chars)

      // Fetch character images
      const ids = chars.map((c) => c.id)
      if (ids.length) {
        const { data: assets, error: ae } = await supabase
          .from('character_assets')
          .select('character_id,kind,storage_path,created_at')
          .in('character_id', ids)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(300)
        if (!ae && assets) {
          const grouped: Record<string, AssetRow[]> = {}
          for (const row of assets as AssetRow[]) {
            if (!row.character_id) continue
            if (!grouped[row.character_id]) grouped[row.character_id] = []
            grouped[row.character_id].push(row)
          }
          const entries = Object.entries(grouped)
            .map(([cid, rs]) => [cid, pickAssetPath(rs)] as const)
            .filter(([, p]) => !!p)
          const signed = await Promise.all(
            entries.map(async ([cid, path]) => {
              const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
              return [cid, s.data?.signedUrl || ''] as const
            }),
          )
          const map: Record<string, string> = {}
          for (const [cid, url] of signed) if (url) map[cid] = url
          setImgById(map)
        }
      }
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

  /* ── Not Logged In ── */
  if (!isLoggedIn && !loading) {
    return (
      <div className="flex-1 bg-zinc-950 flex flex-col items-center justify-center gap-6 py-24 px-6 pb-[72px] md:pb-24">
        <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center">
          <Wand2 className="w-8 h-8 text-zinc-500" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-xl font-bold text-zinc-300">请先登录</p>
          <p className="text-sm text-zinc-500 leading-relaxed">登录后即可创建你的专属 AI 角色</p>
        </div>
        <button
          onClick={() => router.push('/login')}
          className="px-8 py-3 rounded-2xl bg-pink-600 text-white text-xs font-black uppercase tracking-widest hover:bg-pink-500 transition-colors shadow-lg shadow-pink-900/20"
        >
          去登录
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-950 pb-[72px] md:pb-8">
      {/* Alert Toast */}
      {alert && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg border transition-all max-w-[320px] backdrop-blur-xl ${
            alert.type === 'ok'
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          }`}
        >
          {alert.text}
        </div>
      )}

      {/* Header */}
      <div className="px-5 md:px-8 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">我的角色</h1>
            <p className="text-sm text-zinc-400 mt-1">创建并管理你的 AI 角色</p>
          </div>
          <button
            onClick={() => router.push('/aibaji/characters/new')}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-pink-600 text-white font-bold hover:bg-pink-500 transition-all active:scale-95 shadow-lg shadow-pink-900/20"
          >
            <PlusCircle className="w-5 h-5" />
            <span className="text-sm">创建</span>
          </button>
        </div>
      </div>

      {/* Character List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 px-4 md:px-8 pb-8">
        {/* Loading Skeletons */}
        {loading && (
          <div className="contents">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-[420px] rounded-[2rem] bg-zinc-900 animate-pulse shadow-2xl" />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && characters.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-5 py-16 border-2 border-dashed border-zinc-800/50 rounded-[2rem] bg-zinc-900/20">
            <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center">
              <Wand2 className="w-8 h-8 text-zinc-500" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-bold text-zinc-300">还没有创建过角色</p>
              <p className="text-sm text-zinc-500">创建一个专属 AI 角色，还可以发布到广场</p>
            </div>
            <button
              onClick={() => router.push('/aibaji/characters/new')}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-pink-600 text-white font-black uppercase tracking-widest hover:bg-pink-500 transition-all active:scale-95 shadow-lg shadow-pink-900/20"
            >
              <PlusCircle className="w-5 h-5" />
              <span className="text-xs">创建新角色</span>
            </button>
          </div>
        )}

        {/* Character Cards */}
        {!loading && characters.map((c) => {
          const imgUrl = imgById[c.id]
          return (
            <div
              key={c.id}
              className="h-[420px] rounded-[2rem] bg-zinc-900 overflow-hidden relative group shadow-2xl"
            >
              {/* Full-bleed image */}
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={c.name}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <Wand2 className="w-16 h-16 text-zinc-800" />
                </div>
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90" />

              {/* Status badge - top left */}
              <div className="absolute top-4 left-4 z-10">
                {c.visibility === 'public' ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                    <Globe className="w-3.5 h-3.5" />
                    <span>公开</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border bg-zinc-800/50 text-zinc-300 border-zinc-700/50">
                    <Lock className="w-3.5 h-3.5" />
                    <span>私密</span>
                  </div>
                )}
              </div>

              {/* Bottom content */}
              <div className="absolute bottom-0 left-0 right-0 p-5 z-10 flex flex-col gap-3">
                {/* Name */}
                <h2 className="text-2xl font-black text-white tracking-tight drop-shadow-lg">
                  {c.name}
                </h2>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    disabled={publishingId === c.id}
                    onClick={() => { void togglePublish(c) }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 text-white text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                  >
                    {c.visibility === 'public' ? <Lock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                    {publishingId === c.id ? '处理中' : c.visibility === 'public' ? '取消发布' : '发布'}
                  </button>
                  <button
                    onClick={() => router.push(`/aibaji/characters/${c.id}/edit`)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 text-white text-sm font-bold transition-all active:scale-95"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    编辑
                  </button>
                  <button
                    disabled={deletingId === c.id}
                    onClick={() => { void deleteCharacter(c) }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deletingId === c.id ? '删除中' : '删除'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
