import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

type PublicCharacterRow = {
  id: string
  name: string
  system_prompt: string
  profile?: JsonObject
  settings?: JsonObject
  visibility?: string | null
}

type UserCharacterRow = {
  id: string
  settings?: unknown
  created_at?: string
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

function parseUnlockPrice(settings: unknown) {
  const s = asRecord(settings)
  const own = Number(s.unlock_price_coins)
  if (Number.isFinite(own) && own > 0) return Math.max(0, Math.min(Math.floor(own), 200000))
  const creation = asRecord(s.creation_form)
  const publish = asRecord(creation.publish)
  const publishPrice = Number(publish.unlock_price_coins)
  if (Number.isFinite(publishPrice) && publishPrice > 0) return Math.max(0, Math.min(Math.floor(publishPrice), 200000))
  return 0
}

function normalizeUnlockedSettings(sourceSettings: unknown, sourceId: string) {
  const src = asRecord(sourceSettings)
  const teen = src.teen_mode === true || src.age_mode === 'teen'
  return {
    ...(teen ? { ...src, teen_mode: true, age_mode: 'teen', romance_mode: 'ROMANCE_OFF' } : src),
    source_character_id: sourceId,
    unlocked_from_square: true,
    activated: true,
    home_hidden: false,
    activated_at: new Date().toISOString(),
    activated_order: Date.now(),
  }
}

function isLegacyWalletMissing(msg: string) {
  const s = String(msg || '').toLowerCase()
  if (!s) return false
  return (
    s.includes('unlock_public_character') &&
    (s.includes('does not exist') || s.includes('schema cache') || s.includes('user_wallets') || s.includes('square_unlocks'))
  )
}

async function fallbackUnlock(sb: ReturnType<typeof supabaseForToken>, userId: string, sourceCharacterId: string) {
  const sourceRes = await sb
    .from('characters')
    .select('id,name,system_prompt,profile,settings,visibility')
    .eq('id', sourceCharacterId)
    .eq('visibility', 'public')
    .maybeSingle()
  if (sourceRes.error) throw new Error(sourceRes.error.message)
  if (!sourceRes.data?.id) return { ok: false, error: 'SOURCE_NOT_PUBLIC' }

  const source = sourceRes.data as PublicCharacterRow

  const mine = await sb.from('characters').select('id,settings,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500)
  if (mine.error) throw new Error(mine.error.message)

  const rows = (mine.data ?? []) as UserCharacterRow[]
  for (const row of rows) {
    const s = asRecord(row.settings)
    const srcId = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
    if (srcId !== sourceCharacterId) continue
    return {
      ok: true,
      walletReady: false,
      alreadyUnlocked: true,
      localCharacterId: row.id,
      chargedCoins: 0,
      priceCoins: parseUnlockPrice(source.settings),
      balanceAfter: null,
    }
  }

  const payloadV2 = {
    user_id: userId,
    name: source.name,
    system_prompt: source.system_prompt,
    visibility: 'private' as const,
    profile: source.profile ?? {},
    settings: normalizeUnlockedSettings(source.settings, source.id),
  }

  const r1 = await sb.from('characters').insert(payloadV2).select('id').single()
  if (r1.error) {
    const msg = r1.error.message || ''
    const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
    if (!looksLikeLegacy) throw new Error(msg)

    const r2 = await sb.from('characters').insert({ user_id: userId, name: source.name, system_prompt: source.system_prompt }).select('id').single()
    if (r2.error || !r2.data?.id) throw new Error(r2.error?.message || 'unlock failed')

    return {
      ok: true,
      walletReady: false,
      alreadyUnlocked: false,
      localCharacterId: r2.data.id,
      chargedCoins: 0,
      priceCoins: parseUnlockPrice(source.settings),
      balanceAfter: null,
    }
  }

  return {
    ok: true,
    walletReady: false,
    alreadyUnlocked: false,
    localCharacterId: r1.data.id,
    chargedCoins: 0,
    priceCoins: parseUnlockPrice(source.settings),
    balanceAfter: null,
  }
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    const userId = u.data?.user?.id || ''
    if (u.error || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as { sourceCharacterId?: string }
    const sourceCharacterId = String(body?.sourceCharacterId || '').trim()
    if (!sourceCharacterId) return NextResponse.json({ error: 'Missing sourceCharacterId' }, { status: 400 })

    const out = await sb.rpc('unlock_public_character', { p_source_character_id: sourceCharacterId })
    if (out.error) {
      if (isLegacyWalletMissing(out.error.message || '')) {
        const fallback = await fallbackUnlock(sb, userId, sourceCharacterId)
        return NextResponse.json(fallback, { status: fallback.ok ? 200 : 400 })
      }
      throw new Error(out.error.message)
    }

    const row = asRecord(out.data)
    if (row.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: String(row.error || 'unlock failed'),
          priceCoins: Number(row.price_coins || 0),
          balance: Number(row.balance || 0),
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      walletReady: row.wallet_ready !== false,
      alreadyUnlocked: row.already_unlocked === true,
      localCharacterId: String(row.local_character_id || ''),
      chargedCoins: Number(row.charged_coins || 0),
      priceCoins: Number(row.price_coins || 0),
      balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
