import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CharacterRow = { settings?: unknown }

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function parseIds(url: URL) {
  const parts: string[] = []
  const csv = String(url.searchParams.get('ids') || '').trim()
  if (csv) parts.push(...csv.split(','))
  for (const id of url.searchParams.getAll('id')) parts.push(id)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of parts) {
    const id = raw.trim()
    if (!id) continue
    if (id.length > 80) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 80) break
  }
  return out
}

function isActivatedBySettings(settings: unknown) {
  const s = asRecord(settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const ids = parseIds(url)
    if (!ids.length) return NextResponse.json({ ok: true, metrics: {} })

    const scanLimit = clamp(Number(process.env.SQUARE_METRICS_SCAN_LIMIT ?? 12000), 1000, 60000)
    let sb: ReturnType<typeof createAdminClient>
    try {
      sb = createAdminClient()
    } catch {
      return NextResponse.json({ ok: true, unavailable: true, metrics: {} })
    }

    const r = await sb.from('characters').select('settings').order('created_at', { ascending: false }).limit(scanLimit)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

    const target = new Set(ids)
    const metrics: Record<string, { unlocked: number; active: number }> = {}
    for (const id of ids) {
      metrics[id] = { unlocked: 0, active: 0 }
    }

    for (const row of (r.data ?? []) as CharacterRow[]) {
      const s = asRecord(row.settings)
      const sourceId = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
      if (!sourceId || !target.has(sourceId)) continue
      metrics[sourceId].unlocked += 1
      if (isActivatedBySettings(s)) metrics[sourceId].active += 1
    }

    return NextResponse.json({
      ok: true,
      scan_limit: scanLimit,
      metrics,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
