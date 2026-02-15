'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function HomePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      const { data: userData } = await supabase.auth.getUser()

      if (userData.user) {
        // 如果用户已登录，直接跳转到角色页面
        router.push('/characters')
      } else {
        // 如果用户未登录，继续在首页
        setLoading(false)
      }
    }

    checkSession()
  }, [router])

  return (
    <div className="uiPage">
      <div className="uiTopbar">
        <div className="uiTopbarInner">
          <h1 className="uiTitle">XuxuXu AI</h1>
          <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/login')}>
            登录
          </button>
        </div>
      </div>

      <main className="uiMain">
        <h2 className="uiSectionTitle">欢迎来到 XuxuXu AI 角色平台</h2>
        <p className="uiHint">创建属于你的个性化 AI 角色，开始一段虚拟旅程。</p>
      </main>
    </div>
  )
}
