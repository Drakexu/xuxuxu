import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function requireAuthToken(req: Request) {
  const auth = (req.headers.get('authorization') || '').trim()
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : ''
  if (!token) throw new Error('Missing Authorization token')
  return token
}

function supabaseForToken(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anon) throw new Error('Missing Supabase env')
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

function isWalletUnavailableError(msg: string) {
  const s = String(msg || '').toLowerCase()
  return s.includes('get_wallet_summary') && (s.includes('does not exist') || s.includes('schema cache'))
}

export async function GET(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    if (u.error || !u.data?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const out = await sb.rpc('get_wallet_summary')
    if (out.error) {
      if (isWalletUnavailableError(out.error.message || '')) {
        return NextResponse.json({
          ok: true,
          walletReady: false,
          balance: 0,
          totalSpent: 0,
          totalUnlocked: 0,
        })
      }
      throw new Error(out.error.message)
    }

    const row = asRecord(out.data)
    return NextResponse.json({
      ok: row.ok !== false,
      walletReady: row.wallet_ready !== false,
      balance: Number(row.balance || 0),
      totalSpent: Number(row.total_spent || 0),
      totalUnlocked: Number(row.total_unlocked || 0),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

