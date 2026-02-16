'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user) {
        router.replace('/home')
        return
      }
      setChecking(false)
    }
    checkSession().catch(() => setChecking(false))
  }, [router])

  return (
    <div className="uiLanding">
      <section className="uiLandingHero">
        <span className="uiBadge">XuxuXu Web</span>
        <h1 className="uiLandingTitle">把爱巴基搬到 Web</h1>
        <p className="uiLandingSub">
          你可以在这里管理已解锁角色、浏览广场公开角色、创建自己的角色设定，并持续看到角色日常动态。
        </p>
        <div className="uiActions">
          <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/login')}>
            登录开始
          </button>
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            先看广场
          </button>
        </div>
        {checking ? <div className="uiSkeleton">正在检查登录态...</div> : null}
      </section>

      <section className="uiLandingGrid">
        <div className="uiLandingItem">
          <b>首页</b>
          已激活角色的朋友圈、日记、日程片段聚合流，直接进入对话或动态中心。
        </div>
        <div className="uiLandingItem">
          <b>广场</b>
          所有公开角色卡片化浏览，可查看详情并解锁到你的可聊天队列。
        </div>
        <div className="uiLandingItem">
          <b>创建角色</b>
          集中管理你创建过的角色，支持继续编辑、资产管理与新建。
        </div>
      </section>
    </div>
  )
}
