import { supabase } from '@/lib/supabaseClient'

export async function ensureLatestConversationForCharacter(args: {
  userId: string
  characterId: string
  title?: string
}) {
  const { userId, characterId, title } = args
  const existing = await supabase
    .from('conversations')
    .select('id,created_at')
    .eq('user_id', userId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!existing.error && existing.data?.id) {
    return { conversationId: String(existing.data.id), created: false }
  }

  const safeTitle = String(title || '对话').slice(0, 80)
  const createWithTitle = await supabase
    .from('conversations')
    .insert({ user_id: userId, character_id: characterId, title: safeTitle })
    .select('id')
    .single()

  if (!createWithTitle.error && createWithTitle.data?.id) {
    return { conversationId: String(createWithTitle.data.id), created: true }
  }

  const msg = String(createWithTitle.error?.message || '')
  const looksLikeLegacyNoTitle = msg.includes('column') && msg.includes('title')
  if (looksLikeLegacyNoTitle) {
    const createLegacy = await supabase
      .from('conversations')
      .insert({ user_id: userId, character_id: characterId })
      .select('id')
      .single()
    if (!createLegacy.error && createLegacy.data?.id) {
      return { conversationId: String(createLegacy.data.id), created: true }
    }
    throw new Error(createLegacy.error?.message || 'create conversation failed')
  }

  throw new Error(createWithTitle.error?.message || 'create conversation failed')
}
