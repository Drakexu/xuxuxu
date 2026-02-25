'use client'

import { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Compass, MessageCircle, PlusCircle, Heart, ArrowLeft } from 'lucide-react'

const TABS = [
  { href: '/aibaji/square', label: '发现', icon: Compass },
  { href: '/aibaji/chat', label: '聊天', icon: MessageCircle },
  { href: '/aibaji/characters', label: '捏崽', icon: PlusCircle },
]

export default function AibajiLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() || ''

  return (
    <div
      className="bg-zinc-950 text-white flex selection:bg-pink-500 selection:text-white"
      style={{ minHeight: '100dvh' }}
    >
      {/* ── Desktop Sidebar ─────────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col w-64 shrink-0 border-r border-zinc-800/50 bg-zinc-950/50 backdrop-blur-xl z-20"
        style={{ position: 'sticky', top: 0, height: '100dvh' }}
      >
        {/* Brand */}
        <div className="px-6 pt-8 pb-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center shadow-[0_0_12px_rgba(236,72,153,0.2)]">
            <Heart className="w-5 h-5 fill-pink-500 text-pink-500" />
          </div>
          <span className="text-xl font-black tracking-tight">爱巴基</span>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-3 space-y-1">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
            const Icon = tab.icon
            return (
              <button
                key={tab.href}
                onClick={() => router.push(tab.href)}
                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-2xl transition-all text-left ${
                  active
                    ? 'bg-pink-500/10 text-pink-400 shadow-[inset_0_0_1px_rgba(236,72,153,0.2)]'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/40'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${active ? 'fill-pink-500/15' : ''}`} strokeWidth={active ? 2.5 : 1.75} />
                <span className="font-bold text-sm tracking-wide">{tab.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Back to Lab */}
        <div className="p-4">
          <button
            onClick={() => router.push('/')}
            className="w-full group flex items-center justify-center gap-2 text-zinc-600 hover:text-zinc-300 transition-colors font-black uppercase tracking-widest text-[10px] py-4 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/30"
          >
            <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-1" />
            Back to Lab
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 md:h-screen md:overflow-hidden">
        {/* Mobile-only header */}
        <header className="md:hidden sticky top-0 z-20 shrink-0 flex items-center justify-between px-4 py-3 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/50">
          <button
            onClick={() => router.push('/')}
            className="text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors"
          >
            ← xuxuxu
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md bg-pink-500/20 border border-pink-500/30 flex items-center justify-center">
              <Heart className="w-3 h-3 fill-pink-500 text-pink-500" />
            </div>
            <span className="text-sm font-black tracking-tight">爱巴基</span>
          </div>
          <div className="w-16" />
        </header>

        {/* Page content — each page manages its own scroll */}
        <div className="flex-1 flex flex-col min-h-0">
          {children}
        </div>
      </div>

      {/* ── Mobile-only bottom nav ──────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50"
        style={{ height: '72px' }}
        aria-label="主导航"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
          const Icon = tab.icon
          return (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className="relative flex-1 flex flex-col items-center justify-center gap-1"
            >
              {active && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-gradient-to-r from-pink-500 to-purple-500 shadow-[0_0_6px_rgba(236,72,153,0.5)]" />
              )}
              <Icon
                className={`w-[18px] h-[18px] ${active ? 'fill-pink-500/10' : ''}`}
                style={{ color: active ? '#ec4899' : '#52525b' }}
                strokeWidth={active ? 2.5 : 1.75}
              />
              <span
                className="text-[9px] font-black uppercase tracking-wider"
                style={{ color: active ? '#ec4899' : '#52525b' }}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
