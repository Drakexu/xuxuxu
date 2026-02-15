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
      if (userData.user) router.push('/characters')
      else setLoading(false)
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
        <p className="uiHint">创建属于你的角色，开始沉浸式文字聊天。</p>
        {loading && <div className="uiSkeleton">加载中...</div>}
      </main>
    </div>
  )
}

