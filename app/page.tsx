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
        <span className="uiBadge">XuxuXu Web Beta</span>
        <h1 className="uiLandingTitle">在 Web 上复刻爱巴基（语音除外）</h1>
        <p className="uiLandingSub">
          你可以在这里管理已解锁角色、浏览广场公开角色、创建自己的角色设定，并持续查看角色自动生成的朋友圈、日记和日程片段。
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
          已激活角色的朋友圈、日记、日程片段聚合流，可直接跳转到聊天和单角色动态中心。
        </div>
        <div className="uiLandingItem">
          <b>广场</b>
          浏览公开角色详情，解锁到自己的可聊天队列，再按需激活到首页。
        </div>
        <div className="uiLandingItem">
          <b>创建角色</b>
          管理你创建过的角色卡片，继续编辑设定、维护衣柜/资产，并发布到广场。
        </div>
      </section>
    </div>
  )
}
