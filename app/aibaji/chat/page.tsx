'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Character = {
  id: string
  name: string
  profile?: Record<string, unknown>
}

type AssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }

type ChatTab = 'favorites' | 'active'

const FAVORITES_KEY = 'aibaji_favorites'

function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch { return [] }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(r: Record<string, unknown>, k: string): string {
  const v = r[k]
  return typeof v === 'string' ? v.trim() : ''
}

function pickAssetPath(rows: AssetRow[]): string {
  const byKind: Record<string, AssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  for (const k of ['cover', 'full_body', 'head']) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

async function fetchImgUrls(chars: Character[]): Promise<Record<string, string>> {
  const ids = chars.map((c) => c.id).filter(Boolean)
  if (!ids.length) return {}
  const { data: assets, error } = await supabase
    .from('character_assets')
    .select('character_id,kind,storage_path,created_at')
    .in('character_id', ids)
    .in('kind', ['cover', 'full_body', 'head'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !assets) return {}
  const grouped: Record<string, AssetRow[]> = {}
  for (const row of assets as AssetRow[]) {
    if (!row.character_id) continue
    if (!grouped[row.character_id]) grouped[row.character_id] = []
    grouped[row.character_id].push(row)
  }
  const entries = Object.entries(grouped)
    .map(([cid, rs]) => [cid, pickAssetPath(rs)] as const)
    .filter(([, p]) => !!p)
  const signed = await Promise.all(
    entries.map(async ([cid, path]) => {
      const s = await supabase.storage.from('character-assets').createSignedUrl(path, 3600)
      return [cid, s.data?.signedUrl || ''] as const
    }),
  )
  const map: Record<string, string> = {}
  for (const [cid, url] of signed) if (url) map[cid] = url
  return map
}

export default function ChatHubPage() {
  const router = useRouter()
  const [tab, setTab] = useState<ChatTab>('favorites')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [favoriteChars, setFavoriteChars] = useState<Character[]>([])
  const [activeChars, setActiveChars] = useState<{ char: Character; localId: string }[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState('')

  // Load favorites from localStorage + fetch character details
  useEffect(() => {
    const run = async () => {
      const { data: userData } = await supabase.auth.getUser()
      setIsLoggedIn(!!userData.user?.id)

      const ids = loadFavoriteIds()
      if (ids.length) {
        const { data, error } = await supabase
          .from('characters')
          .select('id,name,profile')
          .in('id', ids)
          .eq('visibility', 'public')
        if (!error && data) {
          // Preserve original order
          const byId: Record<string, Character> = {}
          for (const c of data as Character[]) byId[c.id] = c
          setFavoriteChars(ids.filter((id) => byId[id]).map((id) => byId[id]))
        }
      }
    }
    run().catch(() => {})
  }, [])

  // Load active chats (characters with conversations) when tab switches
  useEffect(() => {
    if (tab !== 'active') return
    const run = async () => {
      setLoading(true)
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { setLoading(false); return }
      const userId = userData.user.id

      // Get user's characters (local copies from square)
      const { data: myChars, error } = await supabase
        .from('characters')
        .select('id,name,profile,settings')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)
      if (error || !myChars) { setLoading(false); return }

      // Get conversations for these characters
      const charIds = (myChars as Character[]).map((c) => c.id)
      if (!charIds.length) { setLoading(false); return }
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('id,character_id,created_at')
        .eq('user_id', userId)
        .in('character_id', charIds)
        .order('created_at', { ascending: false })
        .limit(60)
      if (convErr) { setLoading(false); return }

      // Deduplicate by character_id, keep latest
      const seenChars = new Set<string>()
      const result: { char: Character; localId: string }[] = []
      for (const conv of (convs ?? []) as Array<{ id: string; character_id: string }>) {
        if (seenChars.has(conv.character_id)) continue
        seenChars.add(conv.character_id)
        const char = (myChars as Character[]).find((c) => c.id === conv.character_id)
        if (char) {
          // Get display name from source character if available
          const s = asRecord((char as unknown as Record<string, unknown>).settings)
          const sourceName = getStr(s, 'source_name')
          const displayChar = sourceName ? { ...char, name: sourceName } : char
          result.push({ char: displayChar, localId: char.id })
        }
      }
      setActiveChars(result)
      setLoading(false)
    }
    run().catch(() => setLoading(false))
  }, [tab])

  // Fetch images when chars change
  useEffect(() => {
    const allChars = [
      ...favoriteChars,
      ...activeChars.map((a) => a.char),
    ]
    if (!allChars.length) return
    fetchImgUrls(allChars).then(setImgById).catch(() => {})
  }, [favoriteChars, activeChars])

  const handleStartChat = async (sourceCharacterId: string) => {
    if (chatLoading) return
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user?.id) { router.push('/login'); return }
    setChatLoading(sourceCharacterId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      const resp = await fetch('/api/aibaji/start-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceCharacterId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.localCharacterId) return
      router.push(`/aibaji/chat/${json.localCharacterId}`)
    } catch { /* ignore */ } finally {
      setChatLoading('')
    }
  }

  const renderCharCard = (c: Character, localId?: string) => {
    const p = asRecord(c.profile)
    const gender = getStr(p, 'gender') || getStr(p, 'sex')
    const age = getStr(p, 'age')
    const intro = getStr(p, 'summary') || getStr(p, 'occupation')
    const imgUrl = imgById[localId || c.id] || imgById[c.id]
    const dest = localId ? `/aibaji/chat/${localId}` : null

    return (
      <button
        key={localId || c.id}
        className="chatHubCard"
        onClick={() => {
          if (dest) { router.push(dest); return }
          void handleStartChat(c.id)
        }}
        disabled={chatLoading === c.id}
      >
        <div className="chatHubCardImage">
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={c.name} />
          ) : (
            <div className="chatHubCardImageFallback">{c.name?.[0] || '?'}</div>
          )}
        </div>
        <div className="chatHubCardInfo">
          <div className="chatHubCardName">{c.name}</div>
          <div className="chatHubCardMeta">
            {[gender, age ? `${age}岁` : ''].filter(Boolean).join(' · ') || ''}
          </div>
          {intro && <div className="chatHubCardIntro">{intro}</div>}
          {chatLoading === c.id && <div className="chatHubCardIntro">启动中...</div>}
        </div>
      </button>
    )
  }

  return (
    <div className="chatHubPage">
      {/* Tab 切换 */}
      <div className="chatHubTabs">
        <button
          className={`chatHubTab${tab === 'favorites' ? ' chatHubTabActive' : ''}`}
          onClick={() => setTab('favorites')}
        >
          收藏
        </button>
        <button
          className={`chatHubTab${tab === 'active' ? ' chatHubTabActive' : ''}`}
          onClick={() => setTab('active')}
        >
          正在聊天
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="chatHubContent">
        {tab === 'favorites' && (
          <>
            {favoriteChars.length === 0 ? (
              <div className="chatHubEmpty">
                <div className="chatHubEmptyTitle">还没有收藏的角色</div>
                <div className="chatHubEmptyHint">去广场发现喜欢的角色，点击「收藏」就会出现在这里</div>
                <button className="chatHubGoSquare" onClick={() => router.push('/aibaji/square')}>
                  去广场 →
                </button>
              </div>
            ) : (
              <div className="chatHubGrid">
                {favoriteChars.map((c) => renderCharCard(c))}
              </div>
            )}
          </>
        )}

        {tab === 'active' && (
          <>
            {!isLoggedIn ? (
              <div className="chatHubEmpty">
                <div className="chatHubEmptyTitle">请先登录</div>
                <button className="chatHubGoSquare" onClick={() => router.push('/login')}>
                  去登录 →
                </button>
              </div>
            ) : loading ? (
              <div className="chatHubLoading">加载中...</div>
            ) : activeChars.length === 0 ? (
              <div className="chatHubEmpty">
                <div className="chatHubEmptyTitle">还没有进行中的聊天</div>
                <div className="chatHubEmptyHint">在广场选择一个角色，点击「开始聊天」即可</div>
                <button className="chatHubGoSquare" onClick={() => router.push('/aibaji/square')}>
                  去广场 →
                </button>
              </div>
            ) : (
              <div className="chatHubGrid">
                {activeChars.map(({ char, localId }) => renderCharCard(char, localId))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
