import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>
type ScheduleAction = 'PLAY' | 'PAUSE' | 'LOCK' | 'UNLOCK'

type ScheduleReq = {
  conversationId: string
  action: ScheduleAction
  lockMinutes?: number
  reason?: string
}

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
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

function nextLockIso(lockMinutes: number) {
  return new Date(Date.now() + lockMinutes * 60 * 1000).toISOString()
}

async function optimisticUpdateScheduleState(args: {
  sb: ReturnType<typeof supabaseForToken>
  conversationId: string
  action: ScheduleAction
  lockMinutes?: number
  reason?: string
}) {
  const { sb, conversationId, action } = args
  const lockMinutes = clamp(Number(args.lockMinutes ?? 120), 10, 24 * 14 * 60)
  const reason = String(args.reason || 'story_lock').trim().slice(0, 120)

  for (let i = 0; i < 4; i++) {
    const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', conversationId).maybeSingle()
    if (st.error) throw new Error(st.error.message)
    if (!st.data) throw new Error('Conversation state not found')

    const state = asRecord(st.data.state)
    const run = { ...asRecord(state.run_state) }
    const scheduleBoard = { ...asRecord(state.schedule_board) }
    const ledger = { ...asRecord(state.ledger) }

    scheduleBoard.manual_control = true

    if (action === 'PLAY') {
      run.schedule_state = 'PLAY'
      scheduleBoard.schedule_state = 'PLAY'
      scheduleBoard.lock_mode = 'manual'
      scheduleBoard.story_lock_until = ''
      scheduleBoard.story_lock_reason = ''
    } else if (action === 'PAUSE') {
      run.schedule_state = 'PAUSE'
      scheduleBoard.schedule_state = 'PAUSE'
      scheduleBoard.lock_mode = 'manual'
      scheduleBoard.story_lock_until = ''
      scheduleBoard.story_lock_reason = ''
    } else if (action === 'LOCK') {
      run.schedule_state = 'PAUSE'
      scheduleBoard.schedule_state = 'PAUSE'
      scheduleBoard.lock_mode = 'story_lock'
      scheduleBoard.story_lock_until = nextLockIso(lockMinutes)
      scheduleBoard.story_lock_reason = reason || 'story_lock'
    } else {
      run.schedule_state = 'PLAY'
      scheduleBoard.schedule_state = 'PLAY'
      scheduleBoard.lock_mode = 'manual'
      scheduleBoard.story_lock_until = ''
      scheduleBoard.story_lock_reason = ''
    }

    const eventLog = Array.isArray(ledger.event_log) ? [...ledger.event_log] : []
    const marker =
      action === 'LOCK'
        ? `[SCHEDULE] LOCK ${lockMinutes}m (${scheduleBoard.story_lock_reason})`
        : action === 'PAUSE'
          ? '[SCHEDULE] PAUSE'
          : action === 'UNLOCK'
            ? '[SCHEDULE] UNLOCK -> PLAY'
            : '[SCHEDULE] PLAY'
    eventLog.push(marker)
    ledger.event_log = eventLog.slice(-260)

    state.run_state = run
    state.schedule_board = scheduleBoard
    state.ledger = ledger

    const expectedVersion = Number(st.data.version ?? 0)
    const nextVersion = expectedVersion + 1

    const upd = await sb
      .from('conversation_states')
      .update({ state, version: nextVersion, updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('version', expectedVersion)
      .select('version')

    if (upd.error) throw new Error(upd.error.message)
    if (upd.data && (!Array.isArray(upd.data) || upd.data.length > 0)) {
      return {
        version: nextVersion,
        scheduleState: String(run.schedule_state || ''),
        manualControl: scheduleBoard.manual_control === true,
        lockMode: String(scheduleBoard.lock_mode || ''),
        storyLockUntil: String(scheduleBoard.story_lock_until || ''),
        storyLockReason: String(scheduleBoard.story_lock_reason || ''),
      }
    }
  }

  throw new Error('Conversation state version conflict')
}

export async function POST(req: Request) {
  try {
    const token = requireAuthToken(req)
    const sb = supabaseForToken(token)

    const u = await sb.auth.getUser(token)
    if (u.error || !u.data?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as ScheduleReq
    const conversationId = String(body?.conversationId || '').trim()
    const action = String(body?.action || '').trim().toUpperCase() as ScheduleAction
    const lockMinutes = Number(body?.lockMinutes ?? 120)
    const reason = String(body?.reason || '').trim()

    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 })
    if (!['PLAY', 'PAUSE', 'LOCK', 'UNLOCK'].includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    if (action === 'LOCK' && !Number.isFinite(lockMinutes)) return NextResponse.json({ error: 'Invalid lockMinutes' }, { status: 400 })

    const out = await optimisticUpdateScheduleState({
      sb,
      conversationId,
      action,
      lockMinutes,
      reason,
    })
    return NextResponse.json({ ok: true, ...out })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('Missing Authorization token') ? 401 : msg.includes('not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
