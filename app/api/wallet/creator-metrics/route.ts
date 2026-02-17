import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CharacterRow = {
  id: string
  name?: string | null
  visibility?: string | null
  settings?: unknown
  created_at?: string | null
}

type UnlockRow = {
  source_character_id?: string | null
  price_coins?: number | null
  created_at?: string | null
}

type TxRow = {
  source_character_id?: string | null
  amount?: number | null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
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

function isUnlockedFromSquare(settings: unknown) {
  const s = asRecord(settings)
  return (typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0) || s.unlocked_from_square === true
}

function isWalletUnavailableError(msg: string) {
  const s = String(msg || '').toLowerCase()
  if (!s) return false
  return (
    (s.includes('wallet_transactions') || s.includes('square_unlocks')) &&
    (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
  )
}

function parseUnlockPrice(settings: unknown) {
  const s = asRecord(settings)
  const own = Number(s.unlock_price_coins)
  if (Number.isFinite(own) && own > 0) return Math.max(0, Math.min(Math.floor(own), 200000))
  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const nested = Number(publish.unlock_price_coins)
  if (Number.isFinite(nested) && nested > 0) return Math.max(0, Math.min(Math.floor(nested), 200000))
  return 0
}

function parseCreatorShareBp(settings: unknown) {
  const s = asRecord(settings)
  const own = Number(s.unlock_creator_share_bp)
  if (Number.isFinite(own)) return Math.max(0, Math.min(Math.floor(own), 10000))
  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const nested = Number(publish.unlock_creator_share_bp)
  if (Number.isFinite(nested)) return Math.max(0, Math.min(Math.floor(nested), 10000))
  return 7000
}

export async function GET(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const charsRes = await sb
      .from('characters')
      .select('id,name,visibility,settings,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (charsRes.error) throw new Error(charsRes.error.message)

    const chars = (charsRes.data ?? []) as CharacterRow[]
    const createdPublic = chars.filter((c) => c.visibility === 'public' && !isUnlockedFromSquare(c.settings))
    const sourceIds = createdPublic.map((x) => String(x.id || '').trim()).filter(Boolean).slice(0, 1000)
    if (!sourceIds.length) {
      return NextResponse.json({
        ok: true,
        walletReady: true,
        publicRoleCount: 0,
        totalUnlocks: 0,
        totalRevenue: 0,
        topRoles: [],
        roleMetrics: [],
      })
    }

    const unlockRes = await sb
      .from('square_unlocks')
      .select('source_character_id,price_coins,created_at')
      .in('source_character_id', sourceIds)
      .limit(10000)
    if (unlockRes.error) {
      if (isWalletUnavailableError(unlockRes.error.message || '')) {
        return NextResponse.json({
          ok: true,
          walletReady: false,
          publicRoleCount: createdPublic.length,
          totalUnlocks: 0,
          totalRevenue: 0,
          topRoles: [],
          roleMetrics: [],
        })
      }
      throw new Error(unlockRes.error.message)
    }

    const txRes = await sb
      .from('wallet_transactions')
      .select('source_character_id,amount')
      .eq('user_id', userId)
      .eq('kind', 'credit')
      .eq('reason', 'square_unlock_sale')
      .in('source_character_id', sourceIds)
      .limit(5000)
    if (txRes.error) {
      if (isWalletUnavailableError(txRes.error.message || '')) {
        return NextResponse.json({
          ok: true,
          walletReady: false,
          publicRoleCount: createdPublic.length,
          totalUnlocks: 0,
          totalRevenue: 0,
          topRoles: [],
          roleMetrics: [],
        })
      }
      throw new Error(txRes.error.message)
    }

    const unlockBySource: Record<string, number> = {}
    const unlockPriceSumBySource: Record<string, number> = {}
    const latestUnlockAtBySource: Record<string, string> = {}
    for (const row of (unlockRes.data ?? []) as UnlockRow[]) {
      const sid = String(row.source_character_id || '').trim()
      if (!sid) continue
      unlockBySource[sid] = Number(unlockBySource[sid] || 0) + 1
      unlockPriceSumBySource[sid] = Number(unlockPriceSumBySource[sid] || 0) + Math.max(0, Number(row.price_coins || 0))
      const ts = String(row.created_at || '')
      if (ts && (!latestUnlockAtBySource[sid] || ts > latestUnlockAtBySource[sid])) latestUnlockAtBySource[sid] = ts
    }

    const revenueBySource: Record<string, number> = {}
    for (const row of (txRes.data ?? []) as TxRow[]) {
      const sid = String(row.source_character_id || '').trim()
      if (!sid) continue
      revenueBySource[sid] = Number(revenueBySource[sid] || 0) + Number(row.amount || 0)
    }

    const nameById: Record<string, string> = {}
    const settingsById: Record<string, unknown> = {}
    const createdAtById: Record<string, string> = {}
    for (const c of createdPublic) {
      if (!c.id) continue
      nameById[c.id] = String(c.name || '')
      settingsById[c.id] = c.settings
      createdAtById[c.id] = String(c.created_at || '')
    }

    const roleMetrics = sourceIds
      .map((id) => ({
        sourceCharacterId: id,
        name: nameById[id] || '',
        unlocks: Number(unlockBySource[id] || 0),
        revenue: Number(revenueBySource[id] || 0),
        avgUnlockPrice:
          Number(unlockBySource[id] || 0) > 0
            ? Math.floor(Number(unlockPriceSumBySource[id] || 0) / Math.max(1, Number(unlockBySource[id] || 0)))
            : parseUnlockPrice(settingsById[id]),
        unlockPrice: parseUnlockPrice(settingsById[id]),
        creatorShareBp: parseCreatorShareBp(settingsById[id]),
        latestUnlockAt: latestUnlockAtBySource[id] || '',
        createdAt: createdAtById[id] || '',
      }))
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue
        if (b.unlocks !== a.unlocks) return b.unlocks - a.unlocks
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
    const topRoles = roleMetrics.slice(0, 12)

    const totalUnlocks = Object.values(unlockBySource).reduce((s, n) => s + Number(n || 0), 0)
    const totalRevenue = Object.values(revenueBySource).reduce((s, n) => s + Number(n || 0), 0)

    return NextResponse.json({
      ok: true,
      walletReady: true,
      publicRoleCount: createdPublic.length,
      totalUnlocks,
      totalRevenue,
      topRoles,
      roleMetrics,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
