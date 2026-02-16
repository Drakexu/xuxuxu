'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type NavItem = { href: string; label: string }

export default function AppShell(props: {
  title: string
  badge?: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname() || ''
  const [email, setEmail] = useState('')

  const nav: NavItem[] = useMemo(
    () => [
      { href: '/home', label: 'Home' },
      { href: '/square', label: 'Discover' },
      { href: '/characters', label: 'My Characters' },
      { href: '/characters/new', label: 'Create' },
    ],
    [],
  )

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      setEmail(data.user?.email || '')
    })().catch(() => {})
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  return (
    <div className="uiShell">
      <aside className="uiSidebar" aria-label="Navigation">
        <div className="uiSidebarTop" onClick={() => router.push('/home')} role="button" tabIndex={0}>
          <div className="uiBrand">XuxuXu</div>
          <div className="uiBrandSub">AI characters</div>
        </div>

        <nav className="uiNav">
          {nav.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/')
            return (
              <button key={it.href} className={`uiNavItem ${active ? 'uiNavItemActive' : ''}`} onClick={() => router.push(it.href)}>
                {it.label}
              </button>
            )
          })}
        </nav>

        <div className="uiSidebarBottom">
          <div className="uiSidebarMeta" title={email}>
            {email || ' '}
          </div>
          <button className="uiNavItem" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <div className="uiContent">
        <header className="uiHeader">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">{props.title}</h1>
              {props.badge ? <span className="uiBadge">{props.badge}</span> : null}
            </div>
            {props.subtitle ? <p className="uiSubtitle">{props.subtitle}</p> : null}
          </div>
          {props.actions ? <div className="uiActions">{props.actions}</div> : null}
        </header>

        <main className="uiMain">{props.children}</main>
      </div>
    </div>
  )
}

