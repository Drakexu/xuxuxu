'use client'

import { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const TABS = [
  { href: '/aibaji/square', label: '广场' },
  { href: '/aibaji/chat', label: '聊天' },
  { href: '/aibaji/characters', label: '捏崽' },
]

export default function AibajiLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() || ''

  return (
    <div className="aibajiRoot">
      <div className="aibajiTopBar">
        <button className="aibajiBackBtn" onClick={() => router.push('/')}>← xuxuxu</button>
        <span className="aibajiAppName">爱巴基</span>
        <div style={{ width: 72 }} />
      </div>

      <div className="aibajiContent">
        {children}
      </div>

      <nav className="aibajiBottomNav" aria-label="主导航">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <button
              key={tab.href}
              className={`aibajiNavTab${active ? ' aibajiNavTabActive' : ''}`}
              onClick={() => router.push(tab.href)}
            >
              <span className="aibajiNavLabel">{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
