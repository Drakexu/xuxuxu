import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

type MiniMaxResponse = {
  choices?: Array<{ message?: { content?: string } }>
  reply?: string
  output_text?: string
  base_resp?: { status_code?: number; status_msg?: string }
}

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

async function callMiniMax(mmBase: string, mmKey: string, body: JsonObject) {
  const url = joinUrl(mmBase, '/v1/text/chatcompletion_v2')
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mmKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  if (!resp.ok) throw new Error(`MiniMax error: ${resp.status} ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('MiniMax returned non-JSON response')
  }
}

function asRecord(v: unknown): JsonObject {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function toDayStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function dayIso(d: Date) {
  return d.toISOString().slice(0, 10)
}

function bucketStart10mUtc(dt: Date) {
  const ms = dt.getTime()
  const ten = 10 * 60 * 1000
  const floored = new Date(Math.floor(ms / ten) * ten)
  // Keep ISO with Z for timestamptz.
  return floored.toISOString()
}

function dateTimeShortUtc(d: Date) {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

function parseCreatedAt(v: unknown): Date | null {
  const s = typeof v === 'string' ? v : ''
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function extractTagged(text: string) {
  const s = String(text || '')
  const grab = (tag: string) => {
    const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)(?=\\n<|$)`, 'i')
    const m = re.exec(s)
    return m ? m[1].trim() : ''
  }
  return {
    c0: grab('C0'),
    h: grab('H'),
    user: grab('USER'),
    role: grab('ROLE'),
  }
}

const SUMMARY_B_SYSTEM = `你是一个对话总结专家。你将收到一个 10 分钟时间窗口内的“最新对话原文”（包含 {user}/{role} 以及可能的旁白括号）。
要求：
- 只总结这个时间窗口内发生的事，不要复述提示词
- 视角：第三人称
- 时间：把所有时间写成“YYYY年MM月DD日 HH:mm（UTC）”格式（如时间缺失可写“当时”）
- 将所有对用户的指代写成 {user}，将所有对主角的指代写成 {role}
- 重点记录：承诺、冲突、重要选择、关系推进、关键事实变化、重要亲密互动（避免露骨细节）
- 4~10 句话，总长度不超过 300 字`

const DAILY_SYSTEM = `你是一个总结专家。输入是某天内多条 10 分钟总结（B）。
你必须输出 4 段，使用如下 TAG（每段可多行）：
<C0>：当天时间线总结，4~10 句话，不超过 400 字
<H>：当天高光事件要点，3~8 条，每条用“- ”开头
<USER>：用户画像更新要点，4~8 条，每条用“- ”开头
<ROLE>：角色画像更新要点，4~8 条，每条用“- ”开头
约束：
- 第三人称
- 使用 {user}/{role} 代称
- 避免露骨性细节、避免过度引述原文`

const BIWEEKLY_SYSTEM = `你是一个总结专家。输入是连续 14 天的“日总结”（C0）与画像要点。
输出一段“每两周总结（D）”：
- 第三人称
- 8~14 句话，不超过 600 字
- 使用 {user}/{role} 代称
- 重点：主线变化、关系变化、承诺与反复出现的冲突、稳定的偏好与边界`

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

async function summarizeB(args: {
  mmBase: string
  mmKey: string
  transcript: string
}) {
  const mmJson = (await callMiniMax(args.mmBase, args.mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: SUMMARY_B_SYSTEM },
      { role: 'user', name: 'User', content: args.transcript },
    ],
    temperature: 0.4,
    top_p: 0.8,
    max_completion_tokens: 768,
  })) as MiniMaxResponse
  const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
  const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
  if (baseCode) throw new Error(`MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`)
  return String(mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? '').trim()
}

async function summarizeDaily(args: { mmBase: string; mmKey: string; input: string }) {
  const mmJson = (await callMiniMax(args.mmBase, args.mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: DAILY_SYSTEM },
      { role: 'user', name: 'User', content: args.input },
    ],
    temperature: 0.45,
    top_p: 0.85,
    max_completion_tokens: 1200,
  })) as MiniMaxResponse
  const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
  const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
  if (baseCode) throw new Error(`MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`)
  return String(mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? '').trim()
}

async function summarizeBiweekly(args: {
  mmBase: string
  mmKey: string
  input: string
}) {
  const mmJson = (await callMiniMax(args.mmBase, args.mmKey, {
    model: 'M2-her',
    messages: [
      { role: 'system', name: 'System', content: BIWEEKLY_SYSTEM },
      { role: 'user', name: 'User', content: args.input },
    ],
    temperature: 0.45,
    top_p: 0.85,
    max_completion_tokens: 1200,
  })) as MiniMaxResponse
  const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
  const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
  if (baseCode) throw new Error(`MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`)
  return String(mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? '').trim()
}

async function runForConversation(args: {
  sb: SupabaseClient
  mmBase: string
  mmKey: string
  conversation: { id: string; user_id: string; character_id: string }
  maxBuckets: number
  maxDailyDays: number
}) {
  const { sb, mmBase, mmKey, conversation, maxBuckets, maxDailyDays } = args
  const convId = conversation.id
  const userId = conversation.user_id
  const characterId = conversation.character_id

  const charRes = await sb.from('characters').select('name').eq('id', characterId).maybeSingle()
  const roleName = String(charRes.data?.name || '{role}')

  // Latest B bucket already summarized
  const lastB = await sb.from('memory_b_episodes').select('bucket_start').eq('conversation_id', convId).order('bucket_start', { ascending: false }).limit(1)
  const lastBucketStart = String(lastB.data?.[0]?.bucket_start || '')

  // Fetch recent messages after last bucket (or last N messages if none). Include input_event if present.
  let msgQuery = sb.from('messages').select('role,content,created_at,input_event').eq('conversation_id', convId).order('created_at', { ascending: true }).limit(500)
  if (lastBucketStart) msgQuery = msgQuery.gte('created_at', lastBucketStart)
  const msgRes1 = await msgQuery
  let rows: Array<{ role: string; content: string; created_at?: string; input_event?: string }> = []
  if (!msgRes1.error) {
    rows = (msgRes1.data ?? []) as unknown as Array<{ role: string; content: string; created_at?: string; input_event?: string }>
  } else if (String(msgRes1.error.message || '').includes('input_event')) {
    // Legacy schema: retry without input_event.
    let q2 = sb.from('messages').select('role,content,created_at').eq('conversation_id', convId).order('created_at', { ascending: true }).limit(500)
    if (lastBucketStart) q2 = q2.gte('created_at', lastBucketStart)
    const msgRes2 = await q2
    rows = (msgRes2.data ?? []) as unknown as Array<{ role: string; content: string; created_at?: string; input_event?: string }>
  } else {
    throw new Error(`Load messages failed: ${msgRes1.error.message}`)
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - 2 * 60 * 1000) // avoid racing just-written messages

  // Group messages into 10-min buckets
  const buckets = new Map<string, Array<{ t: Date; role: string; content: string; input_event?: string }>>()
  for (const r of rows) {
    const t = parseCreatedAt(r.created_at) || null
    if (!t) continue
    if (t > cutoff) continue
    const b = bucketStart10mUtc(t)
    const arr = buckets.get(b) || []
    arr.push({ t, role: r.role, content: String(r.content || ''), input_event: typeof r.input_event === 'string' ? r.input_event : '' })
    buckets.set(b, arr)
  }

  const bucketKeys = [...buckets.keys()].sort()
  let bCount = 0
  for (const b of bucketKeys) {
    if (bCount >= maxBuckets) break
    const exists = await sb.from('memory_b_episodes').select('id').eq('conversation_id', convId).eq('bucket_start', b).maybeSingle()
    if (exists.data?.id) continue

    const arr = buckets.get(b) || []
    if (arr.length < 2) continue

    const day = dayIso(new Date(b))
    const transcript = [
      `时间窗口起点：${day} 00:00（UTC）附近的 10 分钟桶。bucket_start=${b}`,
      `角色名（仅用于替换）：${roleName}`,
      '对话原文：',
      ...arr.map((m) => {
        const who = m.role === 'assistant' ? '{role}' : '{user}'
        // We avoid raw role name/user name leakage: force tags.
        const ev = m.input_event ? ` event=${m.input_event}` : ''
        return `${dateTimeShortUtc(m.t)} ${who}${ev}: ${String(m.content || '').trim()}`
      }),
    ].join('\n')

    const summary = await summarizeB({ mmBase, mmKey, transcript })
    await sb.from('memory_b_episodes').upsert(
      { conversation_id: convId, user_id: userId, bucket_start: b, summary: summary.slice(0, 500), open_loops: [], tags: [] },
      { onConflict: 'conversation_id,bucket_start' },
    )
    bCount++
  }

  // Daily: generate yesterday (and any missing days up to maxDailyDays) if there are B entries.
  const todayStart = toDayStartUtc(new Date())
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  // Find latest day_start already generated; if none, start from yesterday only (avoid huge backfill).
  const latestDaily = await sb.from('memory_daily').select('day_start').eq('conversation_id', convId).order('day_start', { ascending: false }).limit(1)
  let startDay = yesterdayStart
  if (latestDaily.data?.[0]?.day_start) {
    const s = String(latestDaily.data[0].day_start)
    const d = new Date(`${s}T00:00:00.000Z`)
    if (Number.isFinite(d.getTime())) startDay = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  }

  let dailyCount = 0
  for (
    let d = startDay;
    d.getTime() <= yesterdayStart.getTime() && dailyCount < maxDailyDays;
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const dayStartStr = dayIso(d)
    const exists = await sb.from('memory_daily').select('id').eq('conversation_id', convId).eq('day_start', dayStartStr).maybeSingle()
    if (exists.data?.id) continue

    const dayStartIso = new Date(`${dayStartStr}T00:00:00.000Z`).toISOString()
    const dayEndIso = new Date(new Date(dayStartIso).getTime() + 24 * 60 * 60 * 1000).toISOString()

    // Daily summary must be derived from raw messages, not from B summaries.
    const dayMsgRes1 = await sb
      .from('messages')
      .select('role,content,created_at,input_event')
      .eq('conversation_id', convId)
      .gte('created_at', dayStartIso)
      .lt('created_at', dayEndIso)
      .order('created_at', { ascending: true })
      .limit(1200)

    let dayRows: Array<{ role: string; content: string; created_at?: string; input_event?: string }> = []
    if (!dayMsgRes1.error) {
      dayRows = (dayMsgRes1.data ?? []) as unknown as Array<{ role: string; content: string; created_at?: string; input_event?: string }>
    } else if (String(dayMsgRes1.error.message || '').includes('input_event')) {
      const dayMsgRes2 = await sb
        .from('messages')
        .select('role,content,created_at')
        .eq('conversation_id', convId)
        .gte('created_at', dayStartIso)
        .lt('created_at', dayEndIso)
        .order('created_at', { ascending: true })
        .limit(1200)
      dayRows = (dayMsgRes2.data ?? []) as unknown as Array<{ role: string; content: string; created_at?: string; input_event?: string }>
    } else {
      throw new Error(`Load daily messages failed: ${dayMsgRes1.error.message}`)
    }

    if (dayRows.length < 2) continue

    // Keep the transcript bounded while still using raw text.
    const maxLines = 260
    const tail = dayRows.length > maxLines ? dayRows.slice(-maxLines) : dayRows
    const transcriptLines = tail
      .map((r) => {
        const t = parseCreatedAt(r.created_at) || null
        const ts = t ? dateTimeShortUtc(t) : ''
        const who = r.role === 'assistant' ? '{role}' : '{user}'
        const ev = r.input_event ? ` event=${String(r.input_event)}` : ''
        return `${ts} ${who}${ev}: ${String(r.content || '').trim()}`
      })
      .filter(Boolean)

    const input = [`DAY=${dayStartStr} UTC`, `角色名（仅用于替换）：${roleName}`, '对话原文：', ...transcriptLines].join('\n')
    const out = await summarizeDaily({ mmBase, mmKey, input })
    const t = extractTagged(out)

    const c0 = (t.c0 || out).slice(0, 900)
    const highlights = t.h
      ? t.h
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('-'))
          .slice(0, 12)
      : []
    const userProfile = (t.user || '').slice(0, 900)
    const roleProfile = (t.role || '').slice(0, 900)

    await sb.from('memory_daily').upsert(
      {
        conversation_id: convId,
        user_id: userId,
        day_start: dayStartStr,
        c0_summary: c0,
        c1_highlights: highlights,
        c2_user_profile: userProfile || '（待补充）',
        c3_role_profile: roleProfile || '（待补充）',
      },
      { onConflict: 'conversation_id,day_start' },
    )

    // Also merge into conversation_states.memory for prompt injection.
    const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', convId).maybeSingle()
    const state = (st.data?.state && typeof st.data.state === 'object') ? (st.data.state as JsonObject) : {}
    const mem = asRecord(state['memory'])
    const c0Recent = [...asArray(mem['memory_c0_recent'])]
    c0Recent.push({ day_start: dayStartStr, summary: c0 })
    mem['memory_c0_recent'] = c0Recent.slice(-14)

    const hl = [...asArray(mem['highlights'])]
    for (const h of highlights) hl.push({ day_start: dayStartStr, item: h })
    mem['highlights'] = hl.slice(-60)

    mem['user_profile'] = userProfile ? { ...(asRecord(mem['user_profile'])), last_update: dayStartStr, text: userProfile } : mem['user_profile']
    mem['role_profile'] = roleProfile ? { ...(asRecord(mem['role_profile'])), last_update: dayStartStr, text: roleProfile } : mem['role_profile']

    state['memory'] = mem
    await sb.from('conversation_states').upsert({
      conversation_id: convId,
      user_id: userId,
      character_id: characterId,
      state,
      version: Number(st.data?.version ?? 0) + 1,
    })

    dailyCount++
  }

  // Biweekly: if we crossed into a new 14-day period, generate previous period summary once.
  const nowDayStart = toDayStartUtc(new Date())
  const daysSinceEpoch = Math.floor(nowDayStart.getTime() / (24 * 60 * 60 * 1000))
  const currentPeriodStartDays = Math.floor(daysSinceEpoch / 14) * 14
  const currentPeriodStart = new Date(currentPeriodStartDays * 24 * 60 * 60 * 1000)
  const prevPeriodStart = new Date(currentPeriodStart.getTime() - 14 * 24 * 60 * 60 * 1000)
  // Only run if the previous period is fully finished (i.e., we're at/after current period start).
  if (nowDayStart.getTime() >= currentPeriodStart.getTime()) {
    const prevStartStr = dayIso(prevPeriodStart)
    const exists = await sb.from('memory_biweekly').select('id').eq('conversation_id', convId).eq('period_start', prevStartStr).maybeSingle()
    if (!exists.data?.id) {
      const dailyRows = await sb
        .from('memory_daily')
        .select('day_start,c0_summary,c2_user_profile,c3_role_profile')
        .eq('conversation_id', convId)
        .gte('day_start', prevStartStr)
        .lt('day_start', dayIso(currentPeriodStart))
        .order('day_start', { ascending: true })

      const dr = (dailyRows.data ?? []) as Array<{ day_start: string; c0_summary: string; c2_user_profile: string; c3_role_profile: string }>
      if (dr.length) {
        const input = [
          `PERIOD_START=${prevStartStr} UTC`,
          ...dr.map((x) => `- (${x.day_start}) ${x.c0_summary}`),
          '',
          'USER_PROFILE_LAST:',
          dr[dr.length - 1].c2_user_profile,
          '',
          'ROLE_PROFILE_LAST:',
          dr[dr.length - 1].c3_role_profile,
        ].join('\n')

        const sum = await summarizeBiweekly({ mmBase, mmKey, input })
        await sb.from('memory_biweekly').upsert(
          { conversation_id: convId, user_id: userId, period_start: prevStartStr, summary: sum.slice(0, 1200) },
          { onConflict: 'conversation_id,period_start' },
        )

        const st = await sb.from('conversation_states').select('state,version').eq('conversation_id', convId).maybeSingle()
        const state = (st.data?.state && typeof st.data.state === 'object') ? (st.data.state as JsonObject) : {}
        const mem = asRecord(state['memory'])
        const bi = [...asArray(mem['biweekly'])]
        bi.push({ period_start: prevStartStr, summary: sum.slice(0, 1200) })
        mem['biweekly'] = bi.slice(-10)
        state['memory'] = mem
        await sb.from('conversation_states').upsert({
          conversation_id: convId,
          user_id: userId,
          character_id: characterId,
          state,
          version: Number(st.data?.version ?? 0) + 1,
        })
      }
    }
  }

  return { ok: true, convId, bBucketsProcessed: bCount }
}

export async function GET(req: Request) {
  try {
    requireCronSecret(req)

    const mmKey = process.env.MINIMAX_API_KEY || ''
    const mmBase = process.env.MINIMAX_BASE_URL || ''
    if (!mmKey || !mmBase) return NextResponse.json({ error: 'Missing MINIMAX env (MINIMAX_API_KEY / MINIMAX_BASE_URL)' }, { status: 500 })

    const sb = createAdminClient()
    const convRes = await sb.from('conversations').select('id,user_id,character_id').limit(200)
    if (convRes.error) return NextResponse.json({ error: `Load conversations failed: ${convRes.error.message}` }, { status: 500 })

    const convs = (convRes.data ?? []) as Array<{ id: string; user_id: string; character_id: string }>

    const maxBuckets = Number(new URL(req.url).searchParams.get('maxBuckets') || 4)
    const maxDailyDays = Number(new URL(req.url).searchParams.get('maxDailyDays') || 1)

    const results = []
    for (const c of convs) {
      try {
        results.push(await runForConversation({ sb, mmBase, mmKey, conversation: c, maxBuckets, maxDailyDays }))
      } catch (e: unknown) {
        results.push({ ok: false, convId: c.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({ ok: true, conversations: results.length, results })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 401 })
  }
}

export async function POST(req: Request) {
  return GET(req)
}
