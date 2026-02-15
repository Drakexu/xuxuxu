'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const verifyOtp = async () => {
      const { data, error } = await supabase.auth.getSession()

      if (error || !data?.session?.user) {
        router.push('/login')
      } else {
        router.push('/characters')
      }

      setLoading(false)
    }

    verifyOtp()
  }, [router])

  return (
    <div className="uiPage">
      <main className="uiMain">
        {loading ? (
          <p className="uiLoading">正在验证，请稍等...</p>
        ) : (
          <p className="uiLoading">登录成功，跳转中...</p>
        )}
      </main>
    </div>
  )
}
