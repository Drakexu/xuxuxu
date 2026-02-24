'use client'

import { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Compass, MessageCircle, Wand2, Heart } from 'lucide-react'

const TABS = [
  { href: '/aibaji/square', label: '广场', icon: Compass },
  { href: '/aibaji/chat', label: '聊天', icon: MessageCircle },
  { href: '/aibaji/characters', label: '捏崽', icon: Wand2 },
]

export default function AibajiLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() || ''

  return (
    <div
      className="flex flex-col bg-zinc-950 max-w-[480px] mx-auto relative"
      style={{ minHeight: '100dvh' }}
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/50">
        <button
          onClick={() => router.push('/')}
          className="w-16 text-left text-[9px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors"
        >
          ← xuxuxu
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-pink-500/20 border border-pink-500/30 flex items-center justify-center">
            <Heart className="w-3 h-3 fill-pink-500 text-pink-500" />
          </div>
          <span className="text-sm font-black tracking-tight text-white">爱巴基</span>
        </div>
        <div className="w-16" />
      </header>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: '72px' }}>
        {children}
      </div>

      {/* Bottom Navigation */}
      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-30 flex bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50"
        aria-label="主导航"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
          const Icon = tab.icon
          return (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href)}
              className="relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-4"
            >
              {active && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-gradient-to-r from-pink-500 to-purple-500 shadow-[0_0_6px_rgba(236,72,153,0.5)]" />
              )}
              <Icon
                className="w-[18px] h-[18px] transition-colors"
                style={{ color: active ? '#ec4899' : '#52525b' }}
                strokeWidth={active ? 2.5 : 1.75}
              />
              <span
                className="text-[9px] font-black uppercase tracking-wider transition-colors"
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
