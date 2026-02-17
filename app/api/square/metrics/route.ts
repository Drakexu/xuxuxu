import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CharacterRow = { id?: string | null; settings?: unknown }
type SquareMetric = {
  unlocked: number
  active: number
  likes: number
  saves: number
  reactions: number
  comments: number
  revenue: number
  sales: number
  hot: number
}

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

function isMissingTableError(msg: string, table: string) {
  const s = String(msg || '').toLowerCase()
  return s.includes(table) && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const ids = parseIds(url)
    if (!ids.length) return NextResponse.json({ ok: true, metrics: {} })

    const scanLimit = clamp(Number(process.env.SQUARE_METRICS_SCAN_LIMIT ?? 12000), 1000, 60000)
    const reactionScanLimit = clamp(Number(process.env.SQUARE_REACTIONS_SCAN_LIMIT ?? 30000), 1000, 80000)
    const commentScanLimit = clamp(Number(process.env.SQUARE_COMMENTS_SCAN_LIMIT ?? 30000), 1000, 80000)
    const revenueScanLimit = clamp(Number(process.env.SQUARE_REVENUE_SCAN_LIMIT ?? 30000), 1000, 80000)
    let sb: ReturnType<typeof createAdminClient>
    try {
      sb = createAdminClient()
    } catch {
      return NextResponse.json({ ok: true, unavailable: true, metrics: {} })
    }

    const r = await sb.from('characters').select('id,settings').order('created_at', { ascending: false }).limit(scanLimit)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })

    const target = new Set(ids)
    const metrics: Record<string, SquareMetric> = {}
    for (const id of ids) {
      metrics[id] = {
        unlocked: 0,
        active: 0,
        likes: 0,
        saves: 0,
        reactions: 0,
        comments: 0,
        revenue: 0,
        sales: 0,
        hot: 0,
      }
    }
    const localToSourceId: Record<string, string> = {}

    for (const row of (r.data ?? []) as CharacterRow[]) {
      const s = asRecord(row.settings)
      const sourceId = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
      if (!sourceId || !target.has(sourceId)) continue
      metrics[sourceId].unlocked += 1
      if (isActivatedBySettings(s)) metrics[sourceId].active += 1
      const localId = String(row.id || '').trim()
      if (localId && !localToSourceId[localId]) localToSourceId[localId] = sourceId
    }

    let reactionsReady = false
    let reactionsFrom = 'none'
    try {
      const rrSquare = await sb
        .from('square_reactions')
        .select('source_character_id,liked,saved')
        .in('source_character_id', ids)
        .order('updated_at', { ascending: false })
        .limit(reactionScanLimit)
      if (!rrSquare.error) {
        reactionsReady = true
        reactionsFrom = 'square_reactions'
        for (const row of rrSquare.data ?? []) {
          const rrow = asRecord(row)
          const sourceId = String(rrow.source_character_id || '').trim()
          if (!sourceId || !metrics[sourceId]) continue
          const liked = rrow.liked === true
          const saved = rrow.saved === true
          if (liked) metrics[sourceId].likes += 1
          if (saved) metrics[sourceId].saves += 1
          metrics[sourceId].reactions += (liked ? 1 : 0) + (saved ? 2 : 0)
        }
      } else {
        if (!isMissingTableError(rrSquare.error.message || '', 'square_reactions')) throw rrSquare.error
        const rr = await sb
          .from('feed_reactions')
          .select('character_id,liked,saved')
          .order('updated_at', { ascending: false })
          .limit(reactionScanLimit)
        if (rr.error) {
          if (!isMissingTableError(rr.error.message || '', 'feed_reactions')) throw rr.error
        } else {
          reactionsReady = true
          reactionsFrom = 'feed_reactions'
          for (const row of rr.data ?? []) {
            const rrow = asRecord(row)
            const localId = String(rrow.character_id || '').trim()
            const sourceId = localToSourceId[localId] || ''
            if (!sourceId || !metrics[sourceId]) continue
            const liked = rrow.liked === true
            const saved = rrow.saved === true
            if (liked) metrics[sourceId].likes += 1
            if (saved) metrics[sourceId].saves += 1
            metrics[sourceId].reactions += (liked ? 1 : 0) + (saved ? 2 : 0)
          }
        }
      }
    } catch {
      reactionsReady = false
      reactionsFrom = 'none'
    }

    let commentsReady = false
    let commentsFrom = 'none'
    try {
      const crSquare = await sb
        .from('square_comments')
        .select('source_character_id')
        .in('source_character_id', ids)
        .order('created_at', { ascending: false })
        .limit(commentScanLimit)
      if (!crSquare.error) {
        commentsReady = true
        commentsFrom = 'square_comments'
        for (const row of crSquare.data ?? []) {
          const crow = asRecord(row)
          const sourceId = String(crow.source_character_id || '').trim()
          if (!sourceId || !metrics[sourceId]) continue
          metrics[sourceId].comments += 1
        }
      } else {
        if (!isMissingTableError(crSquare.error.message || '', 'square_comments')) throw crSquare.error
        const cr = await sb
          .from('feed_comments')
          .select('character_id')
          .order('created_at', { ascending: false })
          .limit(commentScanLimit)
        if (cr.error) {
          if (!isMissingTableError(cr.error.message || '', 'feed_comments')) throw cr.error
        } else {
          commentsReady = true
          commentsFrom = 'feed_comments'
          for (const row of cr.data ?? []) {
            const crow = asRecord(row)
            const localId = String(crow.character_id || '').trim()
            const sourceId = localToSourceId[localId] || ''
            if (!sourceId || !metrics[sourceId]) continue
            metrics[sourceId].comments += 1
          }
        }
      }
    } catch {
      commentsReady = false
      commentsFrom = 'none'
    }

    let revenueReady = false
    try {
      const tr = await sb
        .from('wallet_transactions')
        .select('source_character_id,kind,amount,reason')
        .in('source_character_id', ids)
        .eq('reason', 'square_unlock')
        .order('created_at', { ascending: false })
        .limit(revenueScanLimit)
      if (tr.error) {
        if (!isMissingTableError(tr.error.message || '', 'wallet_transactions')) throw tr.error
      } else {
        revenueReady = true
        for (const row of tr.data ?? []) {
          const trow = asRecord(row)
          const sourceId = String(trow.source_character_id || '').trim()
          if (!sourceId || !metrics[sourceId]) continue
          if (String(trow.kind || '') !== 'debit') continue
          const amount = Number(trow.amount || 0)
          if (!Number.isFinite(amount) || amount <= 0) continue
          metrics[sourceId].revenue += Math.floor(amount)
          metrics[sourceId].sales += 1
        }
      }
    } catch {
      revenueReady = false
    }

    for (const id of ids) {
      const m = metrics[id]
      m.hot =
        m.unlocked * 2 +
        m.active * 3 +
        m.likes +
        m.saves * 2 +
        m.comments * 2 +
        m.sales * 2 +
        Math.floor(m.revenue / 50)
    }

    return NextResponse.json({
      ok: true,
      scan_limit: scanLimit,
      signals: {
        reactionsReady,
        commentsReady,
        revenueReady,
        reactionsFrom,
        commentsFrom,
      },
      metrics,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
