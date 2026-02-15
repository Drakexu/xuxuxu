'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type CharacterRow = { id: string; name: string; created_at?: string; settings?: Record<string, unknown> }
type FeedItem = {
  id: string
  created_at: string
  input_event: string | null
  content: string
  conversation_id: string
  conversations?: { character_id?: string | null } | null
}

export default function HomeFeedPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [unlockedCharacters, setUnlockedCharacters] = useState<CharacterRow[]>([])
  const [activeCharId, setActiveCharId] = useState<string>('') // '' => all
  const [items, setItems] = useState<FeedItem[]>([])

  const canLoad = useMemo(() => !loading, [loading])

  const load = async () => {
    setLoading(true)
    setError('')

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      router.replace('/login')
      return
    }

    const rChars = await supabase.from('characters').select('id,name,created_at,settings').order('created_at', { ascending: false }).limit(200)
    if (rChars.error) {
      setError(rChars.error.message || '加载角色失败')
      setUnlockedCharacters([])
    } else {
      const rows = (rChars.data ?? []) as CharacterRow[]
      const unlocked = rows.filter((c) => {
        const s = (c.settings && typeof c.settings === 'object' ? (c.settings as Record<string, unknown>) : {}) as Record<string, unknown>
        return typeof s.source_character_id === 'string' && s.source_character_id.trim().length > 0
      })
      setUnlockedCharacters(unlocked)
    }

    const feedEvents = ['DIARY_DAILY', 'MOMENT_POST', 'SCHEDULE_TICK']
    const rFeed = await supabase
      .from('messages')
      .select('id,created_at,input_event,content,conversation_id,conversations(character_id)')
      .in('input_event', feedEvents)
      .order('created_at', { ascending: false })
      .limit(80)

    if (rFeed.error) {
      setError(rFeed.error.message || '加载动态失败')
      setItems([])
    } else {
      setItems((rFeed.data ?? []) as FeedItem[])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const filtered = useMemo(() => {
    if (!activeCharId) return items
    return items.filter((it) => String(it.conversations?.character_id || '') === activeCharId)
  }, [items, activeCharId])

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">首页</h1>
              <span className="uiBadge">feed</span>
            </div>
            <p className="uiSubtitle">已解锁角色动态：朋友圈 / 日记 / 生活片段</p>
          </div>

          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              广场
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              我的角色
            </button>
            <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canLoad}>
              刷新
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {error && <div className="uiAlert uiAlertErr">{error}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`uiPill ${!activeCharId ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId('')}>
              全部
            </button>
            {unlockedCharacters.slice(0, 20).map((c) => (
              <button key={c.id} className={`uiPill ${activeCharId === c.id ? 'uiPillActive' : ''}`} onClick={() => setActiveCharId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">还没有动态</div>
            <div className="uiEmptyDesc">去聊天，或者等一会儿让角色自动发生活片段/写日记。</div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            {filtered.map((it) => (
              <div key={it.id} className="uiPanel">
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">{it.input_event || 'FEED'}</div>
                    <div className="uiPanelSub">{new Date(it.created_at).toLocaleString()}</div>
                  </div>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${String(it.conversations?.character_id || '')}`)}>
                    去聊天
                  </button>
                </div>
                <div className="uiForm">
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{it.content}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
