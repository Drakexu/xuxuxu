'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error || !data?.session?.user) {
        setError('登录验证失败，请重试。')
        setLoading(false)
        return
      }
      router.replace('/characters')
    }
    run()
  }, [router])

  return (
    <div className="uiPage">
      <main className="uiMain">
        {loading && <div className="uiSkeleton">正在验证登录...</div>}
        {!loading && error && <div className="uiAlert uiAlertErr">{error}</div>}
      </main>
    </div>
  )
}

