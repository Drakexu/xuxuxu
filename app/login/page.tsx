'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Heart, Mail, CheckCircle, Clock, Sparkles, User, Newspaper, ArrowLeft } from 'lucide-react'

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

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownLeft(readCooldownLeft()), 1000)
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

  return (
    <div className="min-h-screen bg-[#FBFBFA] flex items-center justify-center p-5">
      <div className="w-full max-w-[960px] grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr] gap-4">

        {/* ── Left: Brand Panel ── */}
        <div className="rounded-[2rem] border border-zinc-100 bg-gradient-to-br from-pink-50/90 to-white p-8 md:p-10 flex flex-col gap-8 shadow-sm order-2 md:order-1">
          <div>
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-400 hover:text-zinc-900 transition-colors mb-8"
            >
              <ArrowLeft className="w-3 h-3" />
              xuxuxu
            </button>

            <div className="flex items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-white border border-pink-100 shadow-sm flex items-center justify-center">
                <Heart className="w-5 h-5 fill-[#EC4899] text-[#EC4899]" />
              </div>
              <div>
                <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">Magic Link</div>
                <div className="text-sm font-black text-zinc-900">爱巴基 账号</div>
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 leading-[1.05] mb-4">
              一个邮箱<br />即可登录
            </h1>
            <p className="text-sm text-zinc-500 font-medium leading-relaxed max-w-[36ch]">
              无需密码。输入邮箱，点击我们发送的魔法链接，即刻完成登录或注册。
            </p>
          </div>

          {/* Feature List */}
          <div className="space-y-4">
            <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-3">
              登录后解锁
              <div className="flex-1 h-px bg-zinc-100" />
            </div>
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-white border border-zinc-100 shadow-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-[#EC4899]" />
                </div>
                <div>
                  <div className="text-xs font-black text-zinc-900 uppercase tracking-wide">{label}</div>
                  <div className="text-[11px] text-zinc-400 font-medium mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Ghost Buttons */}
          <div className="flex flex-wrap gap-2 mt-auto pt-2">
            <button
              onClick={() => router.push('/aibaji/square')}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-200 text-zinc-600 hover:border-zinc-400 transition-colors"
            >
              先看广场
            </button>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-200 text-zinc-600 hover:border-zinc-400 transition-colors"
            >
              返回介绍页
            </button>
          </div>
        </div>

        {/* ── Right: Form / Sent Card ── */}
        <div className="rounded-[2rem] border border-zinc-100 bg-white shadow-sm p-8 flex flex-col order-1 md:order-2">

          {!sent ? (
            /* ── Form State ── */
            <>
              <div className="mb-8">
                <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400 mb-3">
                  Step 01 / 登录
                </div>
                <h2 className="text-2xl font-black tracking-tight text-zinc-900 mb-1.5">输入你的邮箱</h2>
                <p className="text-xs text-zinc-400 font-medium">我们会发送一封登录链接，无需密码。</p>
              </div>

              <form onSubmit={handleLogin} className="flex flex-col gap-4 flex-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] font-mono font-black uppercase tracking-[0.3em] text-zinc-400">
                    邮箱地址
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-300" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="example@example.com"
                      autoComplete="email"
                      inputMode="email"
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-zinc-200 bg-zinc-50/50 text-zinc-900 text-sm font-medium placeholder:text-zinc-300 focus:outline-none focus:border-[#EC4899] focus:ring-2 focus:ring-[#EC4899]/10 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                {error && (
                  <div className="px-4 py-3 rounded-xl border border-red-100 bg-red-50/60 text-red-500 text-[11px] font-medium leading-relaxed">
                    {error}
                  </div>
                )}

                {cooldownLeft > 0 && !error && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-100 bg-zinc-50 text-zinc-400 text-[11px] font-medium">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                    冷却中 {cooldownLeft}s
                    {retryAtLabel && <span className="ml-auto font-mono text-zinc-300">{retryAtLabel} 可重发</span>}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="mt-auto w-full py-4 rounded-xl text-[11px] font-black uppercase tracking-[0.3em] transition-all active:scale-[0.98] disabled:opacity-40"
                  style={
                    canSubmit
                      ? { background: '#EC4899', color: 'white', boxShadow: '0 8px 24px rgba(236,72,153,0.2)' }
                      : { background: '#F4F4F5', color: '#A1A1AA' }
                  }
                >
                  {loading ? '发送中...' : cooldownLeft > 0 ? `等待 ${cooldownLeft}s` : '发送登录邮件'}
                </button>
              </form>
            </>
          ) : (
            /* ── Sent State ── */
            <>
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-8">
                <div
                  className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center"
                  style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.15)' }}
                >
                  <CheckCircle className="w-10 h-10 text-[#EC4899]" />
                </div>

                <div className="space-y-2">
                  <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
                    Step 02 / 验证
                  </div>
                  <h2 className="text-3xl font-black tracking-tight text-zinc-900">去查看邮件</h2>
                  <p className="text-sm text-zinc-400 font-medium leading-relaxed max-w-[28ch] mx-auto">
                    登录链接已发送至<br />
                    <span className="font-black text-zinc-700">{email}</span>
                  </p>
                </div>

                <div className="w-full px-4 py-3 rounded-xl border border-zinc-100 bg-zinc-50 text-[11px] text-zinc-400 font-medium text-left space-y-1">
                  <div className="flex items-center gap-1.5 text-zinc-500 font-black uppercase tracking-wider text-[9px] mb-2">
                    <Sparkles className="w-3 h-3" />
                    注意事项
                  </div>
                  <p>· 请同时检查垃圾邮件文件夹</p>
                  <p>· 链接有效期约 10 分钟</p>
                  <p>· 请使用最新一封邮件中的链接</p>
                </div>

                <div className="w-full space-y-2.5 mt-auto">
                  {cooldownLeft > 0 ? (
                    <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-400 font-medium">
                      <Clock className="w-3.5 h-3.5" />
                      {cooldownLeft}s 后可重发
                      {retryAtLabel && <span className="font-mono text-zinc-300">（约 {retryAtLabel}）</span>}
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSent(false); setError('') }}
                      className="w-full py-3.5 rounded-xl border border-zinc-200 text-zinc-600 text-[11px] font-black uppercase tracking-widest hover:border-zinc-400 transition-colors"
                    >
                      重新发送
                    </button>
                  )}
                  <button
                    onClick={() => { setSent(false); setEmail(''); setError('') }}
                    className="w-full text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-600 transition-colors py-1"
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
