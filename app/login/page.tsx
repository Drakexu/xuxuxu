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

    if (!email) {
      setError('请输入有效的邮箱地址')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ email })

    if (error) {
      setError(error.message)
    } else {
      router.push('/auth/callback')
    }

    setLoading(false)
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
            输入你的邮箱：
            <input
              className="uiInput"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@example.com"
            />
          </label>
          {error && <div className="uiError">{error}</div>}
          <button type="submit" className="uiBtn uiBtnPrimary" disabled={loading}>
            {loading ? '加载中…' : '发送验证码'}
          </button>
        </form>
      </main>
    </div>
  )
}
