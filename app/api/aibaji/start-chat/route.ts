import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function makeAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) throw new Error('Missing Supabase admin config')
  return createClient(url, key, { auth: { persistSession: false } })
}

function makeUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const client = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  return client
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/, '').trim()
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const userClient = makeUserClient(token)
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = userData.user.id

    const body = await req.json().catch(() => ({}))
    const sourceCharacterId = String(body?.sourceCharacterId || '').trim()
    if (!sourceCharacterId) return NextResponse.json({ error: 'Missing sourceCharacterId' }, { status: 400 })

    const admin = makeAdmin()

    // Fetch source character (must be public)
    const { data: sourceChar, error: srcErr } = await admin
      .from('characters')
      .select('id,name,system_prompt,profile,settings,visibility')
      .eq('id', sourceCharacterId)
      .maybeSingle()
    if (srcErr || !sourceChar) return NextResponse.json({ error: 'Character not found' }, { status: 404 })
    if (sourceChar.visibility !== 'public') return NextResponse.json({ error: 'Character is not public' }, { status: 403 })

    // Check if user already has a local copy
    const { data: existing } = await admin
      .from('characters')
      .select('id')
      .eq('user_id', userId)
      .contains('settings', { source_character_id: sourceCharacterId })
      .maybeSingle()

    let localCharacterId: string

    if (existing?.id) {
      localCharacterId = existing.id
    } else {
      // Create a free local copy
      const srcSettings = (sourceChar.settings && typeof sourceChar.settings === 'object' && !Array.isArray(sourceChar.settings))
        ? sourceChar.settings as Record<string, unknown>
        : {}
      const newSettings: Record<string, unknown> = {
        ...srcSettings,
        source_character_id: sourceCharacterId,
        activated: true,
        activated_at: new Date().toISOString(),
        unlock_price_coins: 0,
      }

      const { data: newChar, error: insertErr } = await admin
        .from('characters')
        .insert({
          user_id: userId,
          name: sourceChar.name,
          system_prompt: sourceChar.system_prompt || '',
          profile: sourceChar.profile || {},
          settings: newSettings,
          visibility: 'private',
        })
        .select('id')
        .single()
      if (insertErr || !newChar?.id) {
        return NextResponse.json({ error: insertErr?.message || 'Failed to create local copy' }, { status: 500 })
      }
      localCharacterId = newChar.id
    }

    // Ensure a conversation exists
    const { data: existingConv } = await admin
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('character_id', localCharacterId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let conversationId: string
    if (existingConv?.id) {
      conversationId = existingConv.id
    } else {
      const { data: newConv, error: convErr } = await admin
        .from('conversations')
        .insert({ user_id: userId, character_id: localCharacterId, title: sourceChar.name || '对话' })
        .select('id')
        .single()
      if (convErr || !newConv?.id) {
        return NextResponse.json({ error: convErr?.message || 'Failed to create conversation' }, { status: 500 })
      }
      conversationId = newConv.id
    }

    return NextResponse.json({ ok: true, localCharacterId, conversationId })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
