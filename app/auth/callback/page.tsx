'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

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

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [step, setStep] = useState('初始化验证...')

  useEffect(() => {
    const run = async () => {
      try {
        const existing = await supabase.auth.getSession()
        if (!existing.error && existing.data?.session?.user) {
          router.replace('/home')
          return
        }

        setStep('解析登录票据...')
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

        if (code) {
          setStep('使用 code 建立会话...')
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(exchangeError.message || '登录验证失败（code 交换失败），请重试。')
            setLoading(false)
            return
          }
        } else if (accessToken && refreshToken) {
          setStep('写入 token 会话...')
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (setSessionError) {
            setError(setSessionError.message || '登录验证失败（token 会话建立失败），请重试。')
            setLoading(false)
            return
          }
        } else if (tokenHash) {
          if (!otpType) {
            setError('登录链接缺少 type 参数，请重新获取登录邮件。')
            setLoading(false)
            return
          }
          setStep('校验 OTP 票据...')
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          })
          if (verifyError) {
            setError(verifyError.message || '登录验证失败（OTP 校验失败），请重试。')
            setLoading(false)
            return
          }
        }

        setStep('确认会话状态...')
        const session = await waitForSession()
        if (!session?.user) {
          const hasTicket = Boolean(code || tokenHash || (accessToken && refreshToken))
          setError(hasTicket ? '登录票据已处理，但会话未建立，请重试登录。' : '未检测到登录票据，请从邮箱中的登录链接进入。')
          setLoading(false)
          return
        }

        setStep('登录成功，正在跳转...')
        router.replace('/home')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '登录验证失败，请重试。')
        setLoading(false)
      }
    }

    void run()
  }, [router])

  return (
    <div className="uiAuthPage">
      <div className="uiAuthWrap">
        <section className="uiAuthPanel">
          <span className="uiBadge">验证登录</span>
          <h1 className="uiAuthTitle">正在处理邮箱登录票据</h1>
          <p className="uiAuthSub">通常会在几秒内完成。如失败，请返回登录页重新发送链接，并确保使用最新的一封邮件。</p>
          <div className="uiAuthMeta">
            <span className="uiBadge">阶段: {step}</span>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/login')}>
              返回登录页
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              去广场浏览
            </button>
          </div>
        </section>

        <section className="uiAuthCard">
          <div className="uiPanelHeader">
            <div>
              <div className="uiPanelTitle">验证状态</div>
              <div className="uiPanelSub">若长时间停留，请返回登录页重新发起登录。</div>
            </div>
          </div>
          <div className="uiForm" style={{ paddingTop: 14 }}>
            {loading && <div className="uiSkeleton">{step}</div>}
            {!loading && error && <div className="uiAlert uiAlertErr">{error}</div>}
            {!loading && error && (
              <div className="uiActions">
                <button className="uiBtn uiBtnPrimary" onClick={() => router.push('/login')}>
                  重新登录
                </button>
                <button className="uiBtn uiBtnGhost" onClick={() => router.push('/')}>
                  返回首页
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
