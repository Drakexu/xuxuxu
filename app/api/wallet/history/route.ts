import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

type TxRow = {
  id: string
  kind?: string | null
  amount?: number | null
  reason?: string | null
  created_at?: string | null
  source_character_id?: string | null
  local_character_id?: string | null
}

type UnlockRow = {
  id: string
  created_at?: string | null
  source_character_id?: string | null
  local_character_id?: string | null
  price_coins?: number | null
}

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
  if (!s) return false
  return (
    (s.includes('wallet_transactions') || s.includes('square_unlocks')) &&
    (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
  )
}

export async function GET(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const txRes = await sb
      .from('wallet_transactions')
      .select('id,kind,amount,reason,created_at,source_character_id,local_character_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (txRes.error) {
      if (isWalletUnavailableError(txRes.error.message || '')) {
        return NextResponse.json({ ok: true, walletReady: false, transactions: [], unlocks: [] })
      }
      throw new Error(txRes.error.message)
    }

    const unlockRes = await sb
      .from('square_unlocks')
      .select('id,created_at,source_character_id,local_character_id,price_coins')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(240)

    if (unlockRes.error) {
      if (isWalletUnavailableError(unlockRes.error.message || '')) {
        return NextResponse.json({ ok: true, walletReady: false, transactions: [], unlocks: [] })
      }
      throw new Error(unlockRes.error.message)
    }

    const txRows = (txRes.data ?? []) as TxRow[]
    const unlockRows = (unlockRes.data ?? []) as UnlockRow[]

    const idSet = new Set<string>()
    for (const r of txRows) {
      const src = String(r.source_character_id || '').trim()
      const local = String(r.local_character_id || '').trim()
      if (src) idSet.add(src)
      if (local) idSet.add(local)
    }
    for (const r of unlockRows) {
      const src = String(r.source_character_id || '').trim()
      const local = String(r.local_character_id || '').trim()
      if (src) idSet.add(src)
      if (local) idSet.add(local)
    }

    const ids = Array.from(idSet).slice(0, 1000)
    const nameById: Record<string, string> = {}
    if (ids.length) {
      const charRes = await sb.from('characters').select('id,name').in('id', ids)
      if (!charRes.error) {
        for (const row of charRes.data ?? []) {
          const r = asRecord(row)
          const id = String(r.id || '').trim()
          if (!id) continue
          nameById[id] = String(r.name || '')
        }
      }
    }

    const transactions = txRows.map((r) => {
      const sourceCharacterId = String(r.source_character_id || '').trim()
      const localCharacterId = String(r.local_character_id || '').trim()
      return {
        id: String(r.id || ''),
        kind: String(r.kind || ''),
        amount: Number(r.amount || 0),
        reason: String(r.reason || ''),
        createdAt: String(r.created_at || ''),
        sourceCharacterId,
        sourceCharacterName: nameById[sourceCharacterId] || '',
        localCharacterId,
        localCharacterName: nameById[localCharacterId] || '',
      }
    })

    const unlocks = unlockRows.map((r) => {
      const sourceCharacterId = String(r.source_character_id || '').trim()
      const localCharacterId = String(r.local_character_id || '').trim()
      return {
        id: String(r.id || ''),
        createdAt: String(r.created_at || ''),
        priceCoins: Number(r.price_coins || 0),
        sourceCharacterId,
        sourceCharacterName: nameById[sourceCharacterId] || '',
        localCharacterId,
        localCharacterName: nameById[localCharacterId] || '',
      }
    })

    return NextResponse.json({
      ok: true,
      walletReady: true,
      transactions,
      unlocks,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}

