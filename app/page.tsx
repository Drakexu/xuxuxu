'use client'

import { useRouter } from 'next/navigation'

const works = [
  {
    id: 'aibaji',
    title: '爱巴基',
    subtitle: 'AI 角色聊天小站',
    description: '在广场发现各种 AI 角色，收藏喜欢的，和它们聊天并保存记忆，还可以捏自己的崽放到广场。',
    href: '/aibaji/square',
    status: 'live' as const,
    tags: ['AI', '聊天', '角色扮演'],
  },
  {
    id: 'soon1',
    title: '未知作品',
    subtitle: '正在孵化中',
    description: '下一个小作品还在想法阶段，敬请期待。',
    href: null,
    status: 'soon' as const,
    tags: [],
  },
  {
    id: 'soon2',
    title: '未知作品',
    subtitle: '正在孵化中',
    description: '下一个小作品还在想法阶段，敬请期待。',
    href: null,
    status: 'soon' as const,
    tags: [],
  },
]

export default function PortfolioPage() {
  const router = useRouter()
  return (
    <div className="portfolioRoot">
      <header className="portfolioHeader">
        <div className="portfolioLogo">xuxuxu</div>
        <p className="portfolioTagline">一些好玩的小作品</p>
      </header>

      <main className="portfolioGrid">
        {works.map((work) => (
          <div
            key={work.id}
            className={`portfolioCard${work.status === 'soon' ? ' portfolioCardSoon' : ''}`}
            onClick={() => { if (work.href) router.push(work.href) }}
            role={work.href ? 'button' : undefined}
            tabIndex={work.href ? 0 : undefined}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && work.href) router.push(work.href) }}
          >
            <div className="portfolioCardInner">
              <div className="portfolioCardTop">
                <div className="portfolioCardTitle">{work.title}</div>
                {work.status === 'live' && <span className="portfolioLiveBadge">在线</span>}
                {work.status === 'soon' && <span className="portfolioSoonBadge">即将推出</span>}
              </div>
              <div className="portfolioCardSub">{work.subtitle}</div>
              <p className="portfolioCardDesc">{work.description}</p>
              {work.tags.length > 0 && (
                <div className="portfolioCardTags">
                  {work.tags.map((t) => (
                    <span key={t} className="portfolioTag">{t}</span>
                  ))}
                </div>
              )}
              {work.href && <div className="portfolioCardArrow">→</div>}
            </div>
          </div>
        ))}
      </main>

      <footer className="portfolioFooter">
        <span>xuxuxu.com · 小作品陈列室</span>
      </footer>
    </div>
  )
}
