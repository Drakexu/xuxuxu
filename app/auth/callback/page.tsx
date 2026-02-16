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

  useEffect(() => {
    const run = async () => {
      try {
        const existing = await supabase.auth.getSession()
        if (!existing.error && existing.data?.session?.user) {
          router.replace('/characters')
          return
        }

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
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(exchangeError.message || '登录验证失败（code 交换失败），请重试。')
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
        }

        const session = await waitForSession()
        if (!session?.user) {
          const hasTicket = Boolean(code || tokenHash || (accessToken && refreshToken))
          setError(hasTicket ? '登录票据已处理，但会话未建立，请重试登录。' : '未检测到登录票据，请从邮箱中的登录链接进入。')
          setLoading(false)
          return
        }

        router.replace('/characters')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '登录验证失败，请重试。')
        setLoading(false)
      }
    }

    void run()
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
