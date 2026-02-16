'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

function parseHashParams() {
  if (typeof window === 'undefined') return new URLSearchParams()
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash)
}

export default function CallbackPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const authError = url.searchParams.get('error_description') || url.searchParams.get('error')

        if (authError) {
          setError(authError)
          setLoading(false)
          return
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            setError(exchangeError.message || '登录验证失败，请重试。')
            setLoading(false)
            return
          }
        } else {
          const hash = parseHashParams()
          const accessToken = hash.get('access_token')
          const refreshToken = hash.get('refresh_token')
          const tokenHash = hash.get('token_hash')
          const otpType = hash.get('type')

          if (accessToken && refreshToken) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
            if (setSessionError) {
              setError(setSessionError.message || '登录验证失败，请重试。')
              setLoading(false)
              return
            }
          } else if (tokenHash && otpType) {
            const { error: verifyError } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: otpType as EmailOtpType,
            })
            if (verifyError) {
              setError(verifyError.message || '登录验证失败，请重试。')
              setLoading(false)
              return
            }
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || !data?.session?.user) {
          setError('登录验证失败，请重试。')
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
