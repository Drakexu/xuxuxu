import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

const LADDER_SYSTEM = `你是“角色好感度阶梯设计师”。你的任务是：基于【角色人设】与【曲线化参数】生成该角色专属的“7阶段递进指引”，用于驱动后续对话风格与亲密行为边界。

【核心要求】
- 阶梯固定为 7 个阶段：S1 ~ S7，必须严格递进：疏远/试探 → 信任建立 → 情感升温 → 稳定亲密。
- 你不需要也不允许设计任何数值区间；只输出阶段序号。
- 输出必须结构化，禁止 JSON，禁止额外解释，禁止示例对话，禁止代码。
- 每个字段必须有内容，不得为空，不得写“无/没有/暂无/未知/N/A”。

【恋爱开关（硬约束）】
- 若 inLoveWithUser=false：必须输出 <MODE>：ROMANCE_OFF
  - 禁止恋爱关系语义：表白/官宣/情侣承诺/恋人标签/情侣称呼体系（如“老公/老婆/男朋友/女朋友”等）
  - 允许好感度上升与高亲密，但语义只能是“非恋爱亲密关系”：知己/搭档/守护/同盟/家人感/默契伙伴等
- 若 inLoveWithUser=true：必须输出 <MODE>：ROMANCE_ON
  - 允许恋爱语义递进，但仍需尊重自愿与边界。

【亲密安全边界】
- 允许亲密，但禁止露骨性细节描写、强迫、羞辱、未成年人相关内容。
- 任何亲密行为都必须强调尊重与自愿；用户不接球要能立刻降温收束。

【高亲密度必须“充分指导”】【重要】
- S6、S7 的 <S*_INTIMACY> 必须明确：
  - 允许的亲密类型（非露骨）
  - 亲密升级路径（从轻到重的自然递进）
  - 同意/拒绝信号（对方犹豫/拒绝时怎么退）
  - 越界请求处理
  - 避免甜蜜复读的方法（暗号/仪式/共同计划/生活细节/行动表达等）

【输出格式：必须严格遵守；只允许输出下列 TAG；每行一个字段；格式固定为：<TAG>：内容】
- 内容必须写成“要点列表”，要点之间用顿号“、”分隔；避免长句和逗号。

<MODE>：ROMANCE_ON 或 ROMANCE_OFF

<S1_STATE>：...
<S1_STYLE>：...
<S1_INITIATIVE>：...
<S1_BOUNDARY>：...
<S1_INTIMACY>：...
<S1_UNLOCKS>：...
<S1_FALLBACK>：...

<S2_STATE>：...
<S2_STYLE>：...
<S2_INITIATIVE>：...
<S2_BOUNDARY>：...
<S2_INTIMACY>：...
<S2_UNLOCKS>：...
<S2_FALLBACK>：...

<S3_STATE>：...
<S3_STYLE>：...
<S3_INITIATIVE>：...
<S3_BOUNDARY>：...
<S3_INTIMACY>：...
<S3_UNLOCKS>：...
<S3_FALLBACK>：...

<S4_STATE>：...
<S4_STYLE>：...
<S4_INITIATIVE>：...
<S4_BOUNDARY>：...
<S4_INTIMACY>：...
<S4_UNLOCKS>：...
<S4_FALLBACK>：...

<S5_STATE>：...
<S5_STYLE>：...
<S5_INITIATIVE>：...
<S5_BOUNDARY>：...
<S5_INTIMACY>：...
<S5_UNLOCKS>：...
<S5_FALLBACK>：...

<S6_STATE>：...
<S6_STYLE>：...
<S6_INITIATIVE>：...
<S6_BOUNDARY>：...
<S6_INTIMACY>：...
<S6_UNLOCKS>：...
<S6_FALLBACK>：...

<S7_STATE>：...
<S7_STYLE>：...
<S7_INITIATIVE>：...
<S7_BOUNDARY>：...
<S7_INTIMACY>：...
<S7_UNLOCKS>：...
<S7_FALLBACK>：...

【再次强调】
- 只输出上述 TAG 行，不要输出任何其他内容。
- 所有字段必须有内容。`

function cleanLadderText(text: string) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const kept = lines.filter((l) => l.startsWith('<') && l.includes('>：'))
  return (kept.length ? kept : lines).join('\n').trim()
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (!token) return NextResponse.json({ error: 'Missing Authorization token' }, { status: 401 })

    const body = (await req.json()) as { characterId?: string; inLoveWithUser?: boolean; curve?: JsonObject }
    const characterId = String(body.characterId || '').trim()
    if (!characterId) return NextResponse.json({ error: 'characterId is required' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) return NextResponse.json({ error: 'Missing Supabase env' }, { status: 500 })

    const mmKey = process.env.MINIMAX_API_KEY
    const mmBase = process.env.MINIMAX_BASE_URL
    if (!mmKey || !mmBase) return NextResponse.json({ error: 'Missing MINIMAX env (MINIMAX_API_KEY / MINIMAX_BASE_URL)' }, { status: 500 })

    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })

    const { data: userRes, error: userErr } = await sb.auth.getUser(token)
    if (userErr || !userRes.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    const userId = userRes.user.id

    const { data: character, error: charErr } = await sb
      .from('characters')
      .select('id,name,system_prompt,profile,settings')
      .eq('id', characterId)
      .single()

    if (charErr || !character) return NextResponse.json({ error: 'Character not found or no access' }, { status: 404 })

    const romanceMode = (character.settings?.romance_mode || '') as string
    const inLove = typeof body.inLoveWithUser === 'boolean' ? body.inLoveWithUser : romanceMode !== 'ROMANCE_OFF'

    const curve = body.curve && typeof body.curve === 'object' ? body.curve : {}

    const persona = [
      `角色名：${String(character.name || '').trim()}`,
      `system_prompt：${String(character.system_prompt || '').trim()}`,
      `profile：${JSON.stringify(character.profile ?? {})}`,
      `settings：${JSON.stringify(character.settings ?? {})}`,
    ].join('\n')

    const userMsg = `【角色人设】\n${persona}\n\n【曲线化参数】\n${JSON.stringify({ inLoveWithUser: inLove, ...curve })}`

    const mmJson = (await callMiniMax(mmBase, mmKey, {
      model: 'M2-her',
      messages: [
        { role: 'system', name: 'System', content: LADDER_SYSTEM },
        { role: 'user', name: 'User', content: userMsg },
      ],
      temperature: 0.6,
      top_p: 0.85,
      max_completion_tokens: 2048,
    })) as MiniMaxResponse

    const baseCode = Number(mmJson?.base_resp?.status_code ?? 0)
    const baseMsg = String(mmJson?.base_resp?.status_msg ?? '')
    if (baseCode) return NextResponse.json({ error: `MiniMax error ${baseCode}: ${baseMsg || 'unknown error'}`, raw: mmJson }, { status: 502 })

    const rawText = mmJson?.choices?.[0]?.message?.content ?? mmJson?.reply ?? mmJson?.output_text ?? ''
    const ladderText = cleanLadderText(String(rawText || ''))
    if (!ladderText) return NextResponse.json({ error: 'MiniMax returned empty ladder output', raw: mmJson }, { status: 502 })

    const { data: stRow } = await sb.from('character_states').select('state,version').eq('character_id', characterId).maybeSingle()
    const prevState = (stRow?.state && typeof stRow.state === 'object') ? (stRow.state as JsonObject) : {}
    const nextState: JsonObject = { ...prevState, relationship_ladder: ladderText }
    const nextVer = Number(stRow?.version ?? 0) + 1

    const up = await sb.from('character_states').upsert({ character_id: characterId, user_id: userId, state: nextState, version: nextVer })
    if (up.error) return NextResponse.json({ error: `Save character_states failed: ${up.error.message}` }, { status: 500 })

    return NextResponse.json({ ok: true, characterId, ladderText })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

