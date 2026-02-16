'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

const OTP_COOLDOWN_SECONDS = 65
const LAST_OTP_SENT_AT_KEY = 'xuxuxu:auth:lastOtpSentAt'

function resolveEmailRedirectTo() {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (site) return `${site.replace(/\/+$/, '')}/auth/callback`
  if (typeof window !== 'undefined') return `${window.location.origin}/auth/callback`
  return undefined
}

function readCooldownLeft() {
  if (typeof window === 'undefined') return 0
  const last = Number(window.localStorage.getItem(LAST_OTP_SENT_AT_KEY) || 0)
  if (!Number.isFinite(last) || last <= 0) return 0
  const passed = Math.floor((Date.now() - last) / 1000)
  return Math.max(0, OTP_COOLDOWN_SECONDS - passed)
}

function mapAuthErrorMessage(raw: string, fallbackWaitSec = OTP_COOLDOWN_SECONDS) {
  const text = String(raw || '').trim()
  const lc = text.toLowerCase()
  if (lc.includes('rate limit') || lc.includes('rate_limit') || lc.includes('too many requests')) {
    return `邮件发送过于频繁，请 ${fallbackWaitSec} 秒后重试。`
  }
  return text || '登录邮件发送失败，请稍后重试。'
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(() => readCooldownLeft())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldownLeft(readCooldownLeft())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const canSubmit = useMemo(() => email.trim().length > 3 && !loading && cooldownLeft === 0, [email, loading, cooldownLeft])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSent(false)

    const v = email.trim()
    if (!v) {
      setError('请输入有效的邮箱地址。')
      return
    }
    if (cooldownLeft > 0) {
      setError(`请等待 ${cooldownLeft} 秒后再发送。`)
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
      const nextWait = Math.max(readCooldownLeft(), OTP_COOLDOWN_SECONDS)
      setError(mapAuthErrorMessage(signError.message, nextWait))
      if (String(signError.message || '').toLowerCase().includes('rate limit')) {
        try {
          window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(Date.now()))
        } catch {
          // ignore
        }
        setCooldownLeft(nextWait)
      }
      return
    }

    try {
      window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(Date.now()))
    } catch {
      // ignore
    }
    setCooldownLeft(OTP_COOLDOWN_SECONDS)
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
              登录邮件已发送，请在邮箱中点击链接完成验证（可同时检查垃圾邮件箱）。
            </div>
          )}
          {cooldownLeft > 0 && <div className="uiHint">发送冷却中：{cooldownLeft} 秒</div>}

          <button type="submit" className="uiBtn uiBtnPrimary" disabled={!canSubmit}>
            {loading ? '发送中...' : cooldownLeft > 0 ? `请等待 ${cooldownLeft}s` : '发送登录邮件'}
          </button>
        </form>
      </main>
    </div>
  )
}
