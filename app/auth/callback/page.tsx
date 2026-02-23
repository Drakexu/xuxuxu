'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { Heart, CheckCircle, XCircle, Loader } from 'lucide-react'

const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function parseHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams()
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash)
}

function normalizeOtpType(v: unknown): EmailOtpType | null {
  const t = String(v || '').trim().toLowerCase()
  if (!t) return null
  return OTP_TYPES.includes(t as EmailOtpType) ? (t as EmailOtpType) : null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForSession(maxAttempts = 10, intervalMs = 180) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data, error } = await supabase.auth.getSession()
    if (!error && data?.session?.user) return data.session
    await sleep(intervalMs)
  }
  return null
}

const STEPS = [
  '初始化验证...',
  '解析登录票据...',
  '校验身份令牌...',
  '确认会话状态...',
  '登录成功，正在跳转...',
]

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [step, setStep] = useState(STEPS[0])
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    const run = async () => {
      try {
        const existing = await supabase.auth.getSession()
        if (!existing.error && existing.data?.session?.user) {
          setStep(STEPS[4])
          setStepIndex(4)
          router.replace('/home')
          return
        }

        setStep(STEPS[1])
        setStepIndex(1)
        const url = new URL(window.location.href)
        const query = url.searchParams
        const hash = parseHashParams()
        const read = (key: string) => query.get(key) || hash.get(key) || ''

        const authError = read('error_description') || read('error')
        if (authError) {
          setError(authError)
          setLoading(false)
          return
        }

        const code = read('code')
        const accessToken = read('access_token')
        const refreshToken = read('refresh_token')
        const tokenHash = read('token_hash')
        const otpType = normalizeOtpType(read('type'))

        setStep(STEPS[2])
        setStepIndex(2)

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(exchangeError.message || '登录验证失败（code 交换失败），请重试。')
            setLoading(false)
            return
          }
        } else if (tokenHash) {
          if (!otpType) {
            setError('登录链接缺少 type 参数，请重新获取登录邮件。')
            setLoading(false)
            return
          }
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          })
          if (verifyError) {
            setError(verifyError.message || '登录验证失败（OTP 校验失败），请重试。')
            setLoading(false)
            return
          }
        } else if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (setSessionError) {
            setError(setSessionError.message || '登录验证失败（token 会话建立失败），请重试。')
            setLoading(false)
            return
          }
        }

        setStep(STEPS[3])
        setStepIndex(3)
        const session = await waitForSession()
        if (!session?.user) {
          const hasTicket = Boolean(code || tokenHash || (accessToken && refreshToken))
          setError(hasTicket ? '登录票据已处理，但会话未建立，请回到登录页重试。' : '未检测到登录票据，请从邮箱中的登录链接进入。')
          setLoading(false)
          return
        }

        setStep(STEPS[4])
        setStepIndex(4)
        router.replace('/home')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '登录验证失败，请重试。')
        setLoading(false)
      }
    }

    void run()
  }, [router])

  return (
    <div className="min-h-screen bg-[#FBFBFA] flex items-center justify-center p-5">
      <div className="w-full max-w-[420px] flex flex-col gap-4">

        {/* Brand mark */}
        <div className="flex items-center gap-2 justify-center mb-2">
          <Heart className="w-4 h-4 fill-[#EC4899] text-[#EC4899]" />
          <span className="text-sm font-black tracking-tight text-zinc-900">爱巴基</span>
        </div>

        {/* Main Card */}
        <div className="rounded-[2rem] border border-zinc-100 bg-white shadow-sm p-8 flex flex-col items-center gap-6">

          {loading ? (
            /* Loading State */
            <>
              <div
                className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center"
                style={{ background: 'rgba(236,72,153,0.06)', border: '1px solid rgba(236,72,153,0.12)' }}
              >
                <Loader className="w-9 h-9 text-[#EC4899] animate-spin" />
              </div>

              <div className="text-center space-y-1.5">
                <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
                  验证中 {stepIndex + 1} / {STEPS.length}
                </div>
                <h1 className="text-2xl font-black tracking-tight text-zinc-900">正在验证登录</h1>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed">
                  通常在几秒内完成，请稍候
                </p>
              </div>

              {/* Progress Steps */}
              <div className="w-full space-y-2">
                {STEPS.slice(0, -1).map((s, i) => (
                  <div key={s} className="flex items-center gap-3">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-black transition-all"
                      style={
                        i < stepIndex
                          ? { background: '#EC4899', color: 'white' }
                          : i === stepIndex
                          ? { background: 'rgba(236,72,153,0.1)', color: '#EC4899', border: '1.5px solid rgba(236,72,153,0.3)' }
                          : { background: '#F4F4F5', color: '#A1A1AA' }
                      }
                    >
                      {i < stepIndex ? '✓' : i + 1}
                    </div>
                    <span
                      className="text-[11px] font-medium transition-colors"
                      style={{ color: i <= stepIndex ? '#18181B' : '#A1A1AA' }}
                    >
                      {s.replace('...', '')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Current step label */}
              <div className="w-full px-4 py-2.5 rounded-xl border border-zinc-100 bg-zinc-50 text-[10px] font-mono font-black uppercase tracking-widest text-zinc-400 text-center">
                {step}
              </div>
            </>
          ) : error ? (
            /* Error State */
            <>
              <div
                className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}
              >
                <XCircle className="w-9 h-9 text-red-400" />
              </div>

              <div className="text-center space-y-1.5">
                <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
                  验证失败
                </div>
                <h1 className="text-2xl font-black tracking-tight text-zinc-900">登录遇到问题</h1>
              </div>

              <div className="w-full px-4 py-3 rounded-xl border border-red-100 bg-red-50/60 text-red-500 text-[11px] font-medium leading-relaxed">
                {error}
              </div>

              <p className="text-[11px] text-zinc-400 font-medium text-center leading-relaxed">
                请使用邮件中最新一封链接，或重新发送登录邮件
              </p>

              <div className="w-full flex flex-col gap-2.5">
                <button
                  onClick={() => router.push('/login')}
                  className="w-full py-4 rounded-xl text-[11px] font-black uppercase tracking-[0.3em] text-white transition-all active:scale-[0.98]"
                  style={{ background: '#EC4899', boxShadow: '0 8px 24px rgba(236,72,153,0.2)' }}
                >
                  重新登录
                </button>
                <button
                  onClick={() => router.push('/')}
                  className="w-full py-3 rounded-xl text-[11px] font-black uppercase tracking-widest border border-zinc-200 text-zinc-600 hover:border-zinc-400 transition-colors"
                >
                  返回首页
                </button>
              </div>
            </>
          ) : (
            /* Success State (brief flash before redirect) */
            <>
              <div
                className="w-20 h-20 rounded-[1.75rem] flex items-center justify-center"
                style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.15)' }}
              >
                <CheckCircle className="w-9 h-9 text-[#EC4899]" />
              </div>
              <div className="text-center space-y-1.5">
                <div className="text-[9px] font-mono font-black uppercase tracking-[0.4em] text-zinc-400">
                  登录成功
                </div>
                <h1 className="text-2xl font-black tracking-tight text-zinc-900">正在跳转...</h1>
              </div>
            </>
          )}
        </div>

        {/* Bottom links */}
        <div className="flex justify-center gap-4">
          <button
            onClick={() => router.push('/login')}
            className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            返回登录页
          </button>
          <span className="text-zinc-200">·</span>
          <button
            onClick={() => router.push('/aibaji/square')}
            className="text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            去广场浏览
          </button>
        </div>
      </div>
    </div>
  )
}
