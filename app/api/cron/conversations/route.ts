import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CharacterRow = {
  id: string
  user_id: string
  name?: string | null
  settings?: unknown
}

function requireCronSecret(req: Request) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) throw new Error('Missing CRON_SECRET')
  const url = new URL(req.url)
  const q = (url.searchParams.get('secret') || '').trim()
  const h = (req.headers.get('x-cron-secret') || '').trim()
  const auth = (req.headers.get('authorization') || '').trim()
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice('bearer '.length).trim() : ''
  const got = q || h || token
  if (got !== secret) throw new Error('Invalid CRON secret')
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isUnlockedFromSquare(settings: unknown) {
  const s = asRecord(settings)
  if (s.unlocked_from_square === true) return true
  const src = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
  return !!src
}

function parseBool(v: string | null, fallback = false) {
  const s = String(v || '').trim().toLowerCase()
  if (!s) return fallback
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false
  return fallback
}

export async function POST(req: Request) {
  try {
    requireCronSecret(req)
    const sb = createAdminClient()
    const url = new URL(req.url)

    const scanLimit = clamp(Number(url.searchParams.get('scanLimit') ?? process.env.CONVERSATION_BOOTSTRAP_SCAN_LIMIT ?? 1200), 100, 5000)
    const createLimit = clamp(Number(url.searchParams.get('createLimit') ?? process.env.CONVERSATION_BOOTSTRAP_CREATE_LIMIT ?? 240), 10, 1000)
    const dryRun = parseBool(url.searchParams.get('dryRun'), false)

    const chars = await sb
      .from('characters')
      .select('id,user_id,name,settings,created_at')
      .not('settings', 'is', null)
      .order('created_at', { ascending: false })
      .limit(scanLimit)

    if (chars.error) return NextResponse.json({ error: chars.error.message }, { status: 500 })

    const unlocked = ((chars.data ?? []) as CharacterRow[])
      .filter((row) => !!row.id && !!row.user_id && isUnlockedFromSquare(row.settings))
      .slice(0, createLimit * 3)

    const charIds = unlocked.map((x) => x.id).filter(Boolean)
    if (!charIds.length) {
      return NextResponse.json({
        ok: true,
        dry_run: dryRun,
        scan_limit: scanLimit,
        create_limit: createLimit,
        unlocked_candidates: 0,
        existing_conversations: 0,
        missing_conversations: 0,
        created: 0,
      })
    }

    const convs = await sb
      .from('conversations')
      .select('character_id')
      .in('character_id', charIds)
      .limit(Math.max(1000, charIds.length * 2))

    if (convs.error) return NextResponse.json({ error: convs.error.message }, { status: 500 })

    const hasConversationForChar = new Set(
      (convs.data ?? [])
        .map((x) => String((x as { character_id?: string | null }).character_id || '').trim())
        .filter(Boolean),
    )

    const missing = unlocked.filter((x) => !hasConversationForChar.has(x.id)).slice(0, createLimit)
    if (!missing.length || dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: dryRun,
        scan_limit: scanLimit,
        create_limit: createLimit,
        unlocked_candidates: unlocked.length,
        existing_conversations: hasConversationForChar.size,
        missing_conversations: missing.length,
        created: 0,
      })
    }

    const rowsWithTitle = missing.map((x) => ({
      user_id: x.user_id,
      character_id: x.id,
      title: String(x.name || '对话').slice(0, 80),
    }))

    let created = 0
    const ins = await sb.from('conversations').insert(rowsWithTitle).select('id')
    if (!ins.error) {
      created = (ins.data ?? []).length
    } else {
      const msg = String(ins.error.message || '')
      const looksLikeNoTitleColumn = msg.includes('column') && msg.includes('title')
      if (!looksLikeNoTitleColumn) {
        return NextResponse.json({ error: ins.error.message }, { status: 500 })
      }
      const rowsLegacy = missing.map((x) => ({ user_id: x.user_id, character_id: x.id }))
      const insLegacy = await sb.from('conversations').insert(rowsLegacy).select('id')
      if (insLegacy.error) return NextResponse.json({ error: insLegacy.error.message }, { status: 500 })
      created = (insLegacy.data ?? []).length
    }

    return NextResponse.json({
      ok: true,
      dry_run: false,
      scan_limit: scanLimit,
      create_limit: createLimit,
      unlocked_candidates: unlocked.length,
      existing_conversations: hasConversationForChar.size,
      missing_conversations: missing.length,
      created,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function GET(req: Request) {
  return POST(req)
}
