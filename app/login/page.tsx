'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const v = email.trim()
    if (!v) {
      setError('请输入有效的邮箱地址。')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: v,
      options: {
        // Supabase dashboard should set redirect URL allow-list too.
        emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` : undefined,
      },
    })
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    router.push('/auth/callback')
  }

  return (
    <div className="uiPage">
      <div className="uiTopbar">
        <div className="uiTopbarInner">
          <h1 className="uiTitle">登录</h1>
        </div>
      </div>

      <main className="uiMain">
        <form className="uiForm" onSubmit={handleLogin}>
          <label className="uiLabel">
            邮箱
            <input
              className="uiInput"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@example.com"
              autoComplete="email"
              inputMode="email"
            />
          </label>

          {error && <div className="uiAlert uiAlertErr">{error}</div>}

          <button type="submit" className="uiBtn uiBtnPrimary" disabled={loading}>
            {loading ? '发送中...' : '发送登录链接'}
          </button>
        </form>
      </main>
    </div>
  )
}

