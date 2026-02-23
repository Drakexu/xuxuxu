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
      className="flex flex-col bg-[#FBFBFA] max-w-[480px] mx-auto relative"
      style={{ minHeight: '100dvh' }}
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur-xl border-b border-zinc-100">
        <button
          onClick={() => router.push('/')}
          className="w-16 text-left text-[9px] font-black uppercase tracking-[0.3em] text-zinc-400 hover:text-zinc-900 transition-colors"
        >
          ← xuxuxu
        </button>
        <div className="flex items-center gap-1.5">
          <Heart className="w-3.5 h-3.5 fill-[#EC4899] text-[#EC4899]" />
          <span className="text-sm font-black tracking-tight text-zinc-900">爱巴基</span>
        </div>
        <div className="w-16" />
      </header>

      {/* Page Content */}
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: '72px' }}>
        {children}
      </div>

      {/* Bottom Navigation */}
      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-30 flex bg-white/95 backdrop-blur-xl border-t border-zinc-100"
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
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-[#EC4899]" />
              )}
              <Icon
                className="w-[18px] h-[18px] transition-colors"
                style={{ color: active ? '#EC4899' : '#A1A1AA' }}
                strokeWidth={active ? 2.5 : 1.75}
              />
              <span
                className="text-[9px] font-black uppercase tracking-wider transition-colors"
                style={{ color: active ? '#EC4899' : '#A1A1AA' }}
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
