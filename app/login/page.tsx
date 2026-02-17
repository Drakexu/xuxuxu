'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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

function formatClockTime(ts: number) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function readLastSentAt() {
  if (typeof window === 'undefined') return 0
  const last = Number(window.localStorage.getItem(LAST_OTP_SENT_AT_KEY) || 0)
  return Number.isFinite(last) && last > 0 ? last : 0
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(() => readCooldownLeft())
  const [lastSentAt, setLastSentAt] = useState(() => readLastSentAt())

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldownLeft(readCooldownLeft())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user) router.replace('/home')
    })().catch(() => {})
  }, [router])

  const canSubmit = useMemo(() => email.trim().length > 3 && !loading && cooldownLeft === 0, [email, loading, cooldownLeft])
  const retryAtLabel = useMemo(() => {
    if (!lastSentAt) return ''
    return formatClockTime(lastSentAt + OTP_COOLDOWN_SECONDS * 1000)
  }, [lastSentAt])

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
      setError(retryAtLabel ? `请等待 ${cooldownLeft} 秒后再发送（约 ${retryAtLabel} 可重试）。` : `请等待 ${cooldownLeft} 秒后再发送。`)
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
      const retryAt = formatClockTime(Date.now() + nextWait * 1000)
      setError(`${mapAuthErrorMessage(signError.message, nextWait)}（约 ${retryAt} 可重试）`)
      if (String(signError.message || '').toLowerCase().includes('rate limit')) {
        const now = Date.now()
        try {
          window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now))
        } catch {
          // ignore
        }
        setLastSentAt(now)
        setCooldownLeft(nextWait)
      }
      return
    }

    const now = Date.now()
    try {
      window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now))
    } catch {
      // ignore
    }
    setLastSentAt(now)
    setCooldownLeft(OTP_COOLDOWN_SECONDS)
    setSent(true)
  }

  return (
    <div className="uiAuthPage">
      <div className="uiAuthWrap">
        <section className="uiAuthPanel">
          <span className="uiBadge">XuxuXu 登录</span>
          <h1 className="uiAuthTitle">用邮箱魔法链接进入角色世界</h1>
          <p className="uiAuthSub">登录后可解锁广场角色、管理创作工作台，并在首页持续查看角色朋友圈、日记和日程片段。</p>
          <div className="uiAuthMeta">
            <span className="uiBadge">首页动态流</span>
            <span className="uiBadge">广场解锁</span>
            <span className="uiBadge">创建角色</span>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              先去广场看看
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/')}>
              返回介绍页
            </button>
          </div>
        </section>

        <section className="uiAuthCard">
          <div className="uiPanelHeader">
            <div>
              <div className="uiPanelTitle">邮箱登录</div>
              <div className="uiPanelSub">输入邮箱后发送登录链接，无需密码。</div>
            </div>
          </div>

          <form className="uiForm" onSubmit={handleLogin} style={{ paddingTop: 14 }}>
            <label className="uiLabel">
              邮箱地址
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
            {cooldownLeft > 0 && <div className="uiHint">发送冷却中：{cooldownLeft} 秒（约 {retryAtLabel} 可重发）</div>}

            <button type="submit" className="uiBtn uiBtnPrimary" disabled={!canSubmit}>
              {loading ? '发送中...' : cooldownLeft > 0 ? `请等待 ${cooldownLeft}s` : '发送登录邮件'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
