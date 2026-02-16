'use client'

import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

function resolveEmailRedirectTo() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (site) return `${site.replace(/\/+$/, '')}/auth/callback`
  if (typeof window !== 'undefined') return `${window.location.origin}/auth/callback`
  return undefined
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const canSubmit = useMemo(() => email.trim().length > 3 && !loading, [email, loading])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSent(false)

    const v = email.trim()
    if (!v) {
      setError('请输入有效的邮箱地址。')
      return
    }

    setLoading(true)
    const { error: signError } = await supabase.auth.signInWithOtp({
      email: v,
      options: {
        emailRedirectTo: resolveEmailRedirectTo(),
      },
    })
    setLoading(false)

    if (signError) {
      setError(signError.message)
      return
    }

    setSent(true)
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
          {sent && (
            <div className="uiAlert uiAlertOk">
              登录邮件已发送，请在邮箱中点击链接完成验证。
            </div>
          )}

          <button type="submit" className="uiBtn uiBtnPrimary" disabled={!canSubmit}>
            {loading ? '发送中...' : '发送登录邮件'}
          </button>
        </form>
      </main>
    </div>
  )
}
