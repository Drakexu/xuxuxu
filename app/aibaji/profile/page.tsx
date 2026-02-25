'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { User, LogOut, MessageCircle, Wand2, Heart, ChevronRight } from 'lucide-react'

type Stats = {
  myCharCount: number
  publicCharCount: number
  conversationCount: number
  favoriteCount: number
}

const FAVORITES_KEY = 'aibaji_favorites'

function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

export default function ProfilePage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats>({ myCharCount: 0, publicCharCount: 0, conversationCount: 0, favoriteCount: 0 })
  const [alert, setAlert] = useState<string | null>(null)

  useEffect(() => {
    if (alert) {
      const t = setTimeout(() => setAlert(null), 2500)
      return () => clearTimeout(t)
    }
  }, [alert])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) {
        setIsLoggedIn(false)
        setLoading(false)
        return
      }
      setIsLoggedIn(true)
      setEmail(userData.user.email || '')
      const userId = userData.user.id

      // Fetch stats
      const [charsRes, convsRes] = await Promise.all([
        supabase
          .from('characters')
          .select('id,visibility,settings', { count: 'exact', head: false })
          .eq('user_id', userId)
          .limit(200),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
      ])

      let myCharCount = 0
      let publicCharCount = 0
      if (charsRes.data) {
        for (const c of charsRes.data) {
          const s = c.settings && typeof c.settings === 'object' && !Array.isArray(c.settings) ? c.settings as Record<string, unknown> : {}
          const isLocal = typeof s.source_character_id === 'string' && (s.source_character_id as string).length > 0
          if (!isLocal) {
            myCharCount++
            if (c.visibility === 'public') publicCharCount++
          }
        }
      }

      const favoriteCount = loadFavoriteIds().length
      const conversationCount = convsRes.count ?? 0

      setStats({ myCharCount, publicCharCount, conversationCount, favoriteCount })
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setAlert('已退出登录')
    router.push('/login')
  }

  if (!isLoggedIn && !loading) {
    return (
      <div className="flex-1 bg-zinc-950 flex flex-col items-center justify-center gap-6 py-24 px-6 pb-[72px] md:pb-24">
        <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center">
          <User className="w-8 h-8 text-zinc-500" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-xl font-bold text-zinc-300">请先登录</p>
          <p className="text-sm text-zinc-500 leading-relaxed">登录后查看你的资料和统计</p>
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
      {/* Alert */}
      {alert && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg border backdrop-blur-xl bg-zinc-900/80 text-white border-zinc-700/50">
          {alert}
        </div>
      )}

      {/* Profile header */}
      <div className="px-6 md:px-8 pt-8 pb-6">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-2xl">
            <User className="w-8 h-8 text-zinc-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-white truncate">
              {email || '用户'}
            </h1>
            <p className="text-xs text-zinc-500 mt-1">爱巴基用户</p>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="px-4 md:px-8 mb-6">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-zinc-900 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800/50 text-center">
              <div className="text-3xl font-black text-white">{stats.myCharCount}</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">创建角色</div>
            </div>
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800/50 text-center">
              <div className="text-3xl font-black text-emerald-400">{stats.publicCharCount}</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">公开角色</div>
            </div>
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800/50 text-center">
              <div className="text-3xl font-black text-white">{stats.conversationCount}</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">对话次数</div>
            </div>
            <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800/50 text-center">
              <div className="text-3xl font-black text-pink-400">{stats.favoriteCount}</div>
              <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">收藏角色</div>
            </div>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="px-4 md:px-8 space-y-2">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-2 mb-3">快捷导航</h3>

        <button
          onClick={() => router.push('/aibaji/characters')}
          className="w-full flex items-center gap-4 px-5 py-4 bg-zinc-900 border border-zinc-800/50 rounded-2xl hover:border-zinc-700/50 transition-all active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-pink-400" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold text-white">我的角色</div>
            <div className="text-[11px] text-zinc-500">管理和编辑你创建的角色</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-600" />
        </button>

        <button
          onClick={() => router.push('/aibaji/chat')}
          className="w-full flex items-center gap-4 px-5 py-4 bg-zinc-900 border border-zinc-800/50 rounded-2xl hover:border-zinc-700/50 transition-all active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold text-white">聊天记录</div>
            <div className="text-[11px] text-zinc-500">查看你的所有对话</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-600" />
        </button>

        <button
          onClick={() => router.push('/aibaji/square')}
          className="w-full flex items-center gap-4 px-5 py-4 bg-zinc-900 border border-zinc-800/50 rounded-2xl hover:border-zinc-700/50 transition-all active:scale-[0.98]"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Heart className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold text-white">广场收藏</div>
            <div className="text-[11px] text-zinc-500">浏览广场上的公开角色</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-600" />
        </button>
      </div>

      {/* Logout */}
      {isLoggedIn && (
        <div className="px-4 md:px-8 mt-8 pb-8">
          <button
            onClick={() => { void handleLogout() }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border border-red-500/20 text-red-400 text-sm font-bold hover:bg-red-500/10 transition-all"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
