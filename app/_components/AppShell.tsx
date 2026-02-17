'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type NavItem = { href: string; label: string; desc?: string }

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

  const primaryNav: NavItem[] = useMemo(
    () => [
      { href: '/home', label: '首页', desc: '已激活角色与动态流' },
      { href: '/square', label: '广场', desc: '公开角色发现与解锁' },
      { href: '/wallet', label: '钱包', desc: '星币余额与解锁流水' },
      { href: '/wardrobe', label: '衣柜资产', desc: '跨角色穿搭与资产聚合' },
      { href: '/characters', label: '创建角色', desc: '角色工作台与资产管理' },
    ],
    [],
  )

  const secondaryNav: NavItem[] = useMemo(
    () => [
      { href: '/characters/new', label: '新建角色' },
      { href: '/characters', label: '角色工作台' },
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
        <div
          className="uiSidebarTop"
          onClick={() => router.push('/home')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') router.push('/home')
          }}
          role="button"
          tabIndex={0}
        >
          <div className="uiBrand">XuxuXu</div>
          <div className="uiBrandSub">AibaJi Web Lab</div>
          <div className="uiBrandHint">复刻爱巴基核心体验（语音除外）</div>
        </div>

        <nav className="uiNav">
          <div className="uiNavGroupTitle">主入口</div>
          {primaryNav.map((it) => {
            const active = pathname === it.href || pathname.startsWith(it.href + '/')
            return (
              <button key={it.href} className={`uiNavItem ${active ? 'uiNavItemActive' : ''}`} onClick={() => router.push(it.href)}>
                <span>{it.label}</span>
                {it.desc ? <small>{it.desc}</small> : null}
              </button>
            )
          })}

          <div className="uiNavGroupTitle">创作</div>
          {secondaryNav.map((it, idx) => {
            const active = pathname === it.href
            return (
              <button key={`${it.href}-${idx}`} className={`uiNavItem uiNavItemSub ${active ? 'uiNavItemActive' : ''}`} onClick={() => router.push(it.href)}>
                <span>{it.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="uiSidebarBottom">
          <div className="uiSidebarMeta" title={email}>
            {email || '未登录邮箱'}
          </div>
          <button className="uiNavItem" onClick={logout}>
            退出登录
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

      <nav className="uiMobileDock" aria-label="Primary Navigation">
        {primaryNav.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/')
          return (
            <button key={it.href} className={`uiMobileDockItem ${active ? 'uiMobileDockItemActive' : ''}`} onClick={() => router.push(it.href)}>
              {it.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
