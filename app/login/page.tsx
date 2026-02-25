'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Heart, Mail, CheckCircle, Clock, Sparkles, User, Newspaper, ArrowLeft, Loader, KeyRound } from 'lucide-react'

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

function readLastSentAt() {
  if (typeof window === 'undefined') return 0
  const last = Number(window.localStorage.getItem(LAST_OTP_SENT_AT_KEY) || 0)
  return Number.isFinite(last) && last > 0 ? last : 0
}

function formatClockTime(ts: number) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function mapAuthErrorMessage(raw: string, fallbackWaitSec = OTP_COOLDOWN_SECONDS) {
  const text = String(raw || '').trim()
  const lc = text.toLowerCase()
  if (lc.includes('rate limit') || lc.includes('rate_limit') || lc.includes('too many requests')) {
    return `邮件发送过于频繁，请 ${fallbackWaitSec} 秒后重试。`
  }
  if (lc.includes('invalid email')) return '邮箱格式无效，请检查后重试。'
  return text || '登录邮件发送失败，请稍后重试。'
}

const FEATURES = [
  { icon: Newspaper, label: '首页动态流', desc: '角色朋友圈、日记和日程片段' },
  { icon: Sparkles, label: '广场解锁', desc: '发现并收藏心仪的 AI 角色' },
  { icon: User, label: '创建角色', desc: '捏专属 AI 伙伴，发布到广场' },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldownLeft, setCooldownLeft] = useState(() => readCooldownLeft())
  const [lastSentAt, setLastSentAt] = useState(() => readLastSentAt())
  const [otpCode, setOtpCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownLeft(readCooldownLeft()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (data.user) router.replace('/aibaji/square')
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
      setError(retryAtLabel ? `请等待 ${cooldownLeft} 秒后重试（约 ${retryAtLabel} 可重发）。` : `请等待 ${cooldownLeft} 秒后重试。`)
      return
    }

    setLoading(true)
    const { error: signError } = await supabase.auth.signInWithOtp({
      email: v,
      options: { emailRedirectTo: resolveEmailRedirectTo() },
    })
    setLoading(false)

    if (signError) {
      const nextWait = Math.max(readCooldownLeft(), OTP_COOLDOWN_SECONDS)
      const retryAt = formatClockTime(Date.now() + nextWait * 1000)
      setError(`${mapAuthErrorMessage(signError.message, nextWait)}（约 ${retryAt} 可重试）`)
      if (String(signError.message || '').toLowerCase().includes('rate limit')) {
        const now = Date.now()
        try { window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now)) } catch { /* ignore */ }
        setLastSentAt(now)
        setCooldownLeft(nextWait)
      }
      return
    }

    const now = Date.now()
    try { window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now)) } catch { /* ignore */ }
    setLastSentAt(now)
    setCooldownLeft(OTP_COOLDOWN_SECONDS)
    setSent(true)
  }

  const handleVerifyOtp = async () => {
    const code = otpCode.replace(/\s/g, '')
    if (code.length < 6) {
      setError('请输入完整的 6 位验证码。')
      return
    }
    setVerifying(true)
    setError('')
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: 'email',
      })
      if (verifyError) {
        setError(verifyError.message || '验证码校验失败，请检查后重试。')
        setVerifying(false)
        return
      }
      router.replace('/aibaji/square')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '验证失败，请重试。')
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-5 relative overflow-hidden">
      {/* Background glow blurs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-pink-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />

      <div className="w-full max-w-[960px] grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr] gap-6 relative z-10">

        {/* -- Left: Brand Panel -- */}
        <div className="rounded-[2.5rem] border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-8 md:p-12 shadow-2xl flex flex-col gap-8 order-2 md:order-1 relative overflow-hidden">
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-purple-500/5 rounded-[2.5rem] pointer-events-none" />

          <div className="relative z-10">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors mb-8"
            >
              <ArrowLeft className="w-3 h-3" />
              xuxuxu
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.2)] flex items-center justify-center">
                <Heart className="w-5 h-5 fill-[#EC4899] text-[#EC4899]" />
              </div>
              <div>
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70">Magic Link</div>
                <div className="text-sm font-black text-white">爱巴基 账号</div>
              </div>
            </div>

            <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white leading-[1.1] mb-4">
              一个邮箱<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">即可登录</span>
            </h1>
            <p className="text-sm text-zinc-500 font-medium leading-relaxed max-w-[36ch]">
              无需密码。输入邮箱，点击我们发送的魔法链接，即刻完成登录或注册。
            </p>
          </div>

          {/* Feature List */}
          <div className="space-y-4 relative z-10">
            <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-zinc-600 flex items-center gap-3">
              登录后解锁
              <div className="flex-1 h-px bg-zinc-800/50" />
            </div>
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-950 border border-zinc-800/50 shadow-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-pink-500" />
                </div>
                <div>
                  <div className="text-xs font-black text-white uppercase tracking-wide">{label}</div>
                  <div className="text-[11px] text-zinc-500 font-medium mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Ghost Buttons */}
          <div className="flex flex-wrap gap-2 mt-auto pt-2 relative z-10">
            <button
              onClick={() => router.push('/aibaji/square')}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-pink-500/50 hover:text-white hover:bg-pink-500/10 transition-colors"
            >
              先看广场
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-pink-500/50 hover:text-white hover:bg-pink-500/10 transition-colors"
            >
              返回介绍页
            </button>
          </div>
        </div>

        {/* -- Right: Form / Sent Card -- */}
        <div className="rounded-[2.5rem] border border-zinc-800/50 bg-zinc-900/80 backdrop-blur-xl shadow-2xl p-8 md:p-10 flex flex-col order-1 md:order-2">

          {!sent ? (
            /* -- Form State -- */
            <>
              <div className="mb-8">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70 mb-3 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500" />
                  </span>
                  Step 01 / 登录
                </div>
                <h2 className="text-3xl font-black tracking-tight text-white mb-1.5">输入你的邮箱</h2>
                <p className="text-xs text-zinc-500 font-medium">我们会发送一封登录链接，无需密码。</p>
              </div>

              <form onSubmit={handleLogin} className="flex flex-col gap-4 flex-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-zinc-500">
                    邮箱地址
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="example@example.com"
                      autoComplete="email"
                      inputMode="email"
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-800 bg-zinc-950 text-white text-base placeholder:text-zinc-600 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all"
                    />
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-[11px] font-medium leading-relaxed">
                    {error}
                  </div>
                )}

                {cooldownLeft > 0 && !error && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-500 text-[11px] font-medium">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    冷却中 {cooldownLeft}s
                    {retryAtLabel && <span className="ml-auto font-mono text-zinc-600">{retryAtLabel} 可重发</span>}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="mt-auto w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] transition-all active:scale-[0.98]"
                  style={
                    canSubmit
                      ? { background: 'linear-gradient(to right, #ec4899, #a855f7)', color: 'white', boxShadow: '0 0 30px rgba(236,72,153,0.3)' }
                      : { background: '#18181b', color: '#52525b', border: '1px solid #27272a' }
                  }
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader className="w-4 h-4 animate-spin" />
                      发送中...
                    </span>
                  ) : cooldownLeft > 0 ? `等待 ${cooldownLeft}s` : '发送登录邮件'}
                </button>
              </form>
            </>
          ) : (
            /* -- Sent State -- */
            <>
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-8">
                <div
                  className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center"
                  style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.2)' }}
                >
                  <CheckCircle className="w-10 h-10 text-pink-500" />
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70 flex items-center justify-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500" />
                    </span>
                    Step 02 / 验证
                  </div>
                  <h2 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">查看邮件</h2>
                  <p className="text-sm text-zinc-500 font-medium leading-relaxed max-w-[28ch] mx-auto">
                    验证码已发送至<br />
                    <span className="font-black text-white">{email}</span>
                  </p>
                </div>

                {/* OTP Code Input */}
                <div className="w-full space-y-3">
                  <div className="flex items-center gap-1.5 text-pink-500/70 font-black uppercase tracking-wider text-[9px]">
                    <KeyRound className="w-3 h-3" />
                    输入验证码
                  </div>
                  <p className="text-[11px] text-zinc-500 font-medium">
                    在邮件中找到 6 位数字验证码，输入下方即可登录。
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      className="flex-1 px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-950 text-white text-center text-lg font-mono font-black tracking-[0.5em] placeholder:text-zinc-700 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all"
                    />
                    <button
                      onClick={() => { void handleVerifyOtp() }}
                      disabled={verifying || otpCode.length < 6}
                      className="px-5 py-3.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      style={
                        !verifying && otpCode.length >= 6
                          ? { background: 'linear-gradient(to right, #ec4899, #a855f7)', color: 'white', boxShadow: '0 0 20px rgba(236,72,153,0.3)' }
                          : { background: '#18181b', color: '#52525b', border: '1px solid #27272a' }
                      }
                    >
                      {verifying ? <Loader className="w-4 h-4 animate-spin" /> : '验证'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="w-full px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-[11px] font-medium leading-relaxed">
                    {error}
                  </div>
                )}

                <div className="w-full h-px bg-zinc-800/50" />

                <div className="w-full px-4 py-3 rounded-xl border border-zinc-800/50 bg-zinc-950 text-[11px] text-zinc-500 font-medium text-left space-y-1">
                  <div className="flex items-center gap-1.5 text-pink-500/70 font-black uppercase tracking-wider text-[9px] mb-2">
                    <Sparkles className="w-3 h-3" />
                    提示
                  </div>
                  <p>· 邮件中同时包含验证码和登录链接</p>
                  <p>· 手机用户推荐直接输入验证码</p>
                  <p>· 请检查垃圾邮件文件夹</p>
                </div>

                <div className="w-full space-y-2.5 mt-auto">
                  {cooldownLeft > 0 ? (
                    <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500 font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      {cooldownLeft}s 后可重发
                      {retryAtLabel && <span className="font-mono text-zinc-600">（约 {retryAtLabel}）</span>}
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSent(false); setError(''); setOtpCode('') }}
                      className="w-full py-3.5 rounded-xl border border-zinc-700 text-white text-[11px] font-black uppercase tracking-widest hover:border-pink-500/50 hover:bg-pink-500/10 transition-colors"
                    >
                      重新发送
                    </button>
                  )}
                  <button
                    onClick={() => { setSent(false); setEmail(''); setError(''); setOtpCode('') }}
                    className="w-full text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors py-1"
                  >
                    ← 更换邮箱
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
