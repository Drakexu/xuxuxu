'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Character = {
  id: string
  name: string
  system_prompt: string
  created_at?: string
}

export default function CharactersPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState<string>('')

  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const canSave = useMemo(() => name.trim().length > 0 && prompt.trim().length > 0 && !saving, [name, prompt, saving])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(t)
  }, [toast])

  const load = async () => {
    setLoading(true)

    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      router.replace('/login')
      return
    }

    setEmail(userData.user.email ?? '')
    setUserId(userData.user.id)

    const { data, error } = await supabase
      .from('characters')
      .select('id,name,system_prompt,created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setToast({ type: 'err', text: `加载失败：${error.message}` })
      setCharacters([])
    } else {
      setCharacters((data ?? []) as Character[])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace('/')
  }

  const openModal = () => {
    setName('')
    setPrompt('')
    setOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setOpen(false)
  }

  const createCharacter = async () => {
    if (!canSave) return
    setSaving(true)

    const payload = {
      user_id: userId,
      name: name.trim(),
      system_prompt: prompt.trim(),
    }

    const { error } = await supabase.from('characters').insert(payload)

    if (error) {
      setToast({ type: 'err', text: `创建失败：${error.message}` })
      setSaving(false)
      return
    }

    setToast({ type: 'ok', text: '已创建角色' })
    setSaving(false)
    setOpen(false)
    await load()
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">角色</h1>
              <span className="uiBadge">Beta</span>
            </div>
            <p className="uiSubtitle">{email}</p>
          </div>

          <div className="uiActions">
            <button className="uiBtn uiBtnPrimary" onClick={openModal}>
              新建角色
            </button>
            <button className="uiBtn uiBtnGhost" onClick={logout}>
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        <div className="uiSectionHeader">
          <h2 className="uiSectionTitle">我的角色</h2>
          <p className="uiHint">每个角色都会拥有独立设定与记忆（下一步接入）。</p>
        </div>

        {loading && <div className="uiSkeleton">加载中…</div>}

        {!loading && characters.length === 0 && (
          <div className="uiEmpty">
            <div className="uiEmptyTitle">还没有角色</div>
            <div className="uiEmptyDesc">点击右上角「新建角色」创建你的第一个角色。</div>
          </div>
        )}

        {!loading && characters.length > 0 && (
          <div className="uiGrid">
            {characters.map((c) => (
              <div key={c.id}
                className="uiCard"
                style={{ cursor: 'pointer' }}
                onClick={() => router.push(`/chat/${c.id}`)}
              >
                <div className="uiCardTitle">{c.name}</div>
                <div className="uiCardMeta">点击进入聊天</div>
              </div>

            ))}
          </div>
        )}
      </main>

      {toast && (
        <div className={`uiToast ${toast.type === 'ok' ? 'uiToastOk' : 'uiToastErr'}`}>
          {toast.text}
        </div>
      )}

      {open && (
        <div className="uiModalOverlay" onMouseDown={closeModal}>
          <div className="uiModal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="uiModalHeader">
              <div>
                <div className="uiModalTitle">新建角色</div>
                <div className="uiModalSub">为角色定义名字与系统设定（system prompt）</div>
              </div>
              <button className="uiIconBtn" onClick={closeModal} aria-label="Close">
                <span className="uiX" />
              </button>
            </div>

            <div className="uiForm">
              <label className="uiLabel">
                角色名称
                <input
                  className="uiInput"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：绫人 / 爱巴基管家 / 侦探搭档"
                  autoFocus
                />
              </label>

              <label className="uiLabel">
                System Prompt
                <textarea
                  className="uiTextarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="写下角色的性格、边界、口癖、关系定位、输出风格…"
                />
              </label>
            </div>

            <div className="uiModalFooter">
              <button className="uiBtn uiBtnSecondary" onClick={closeModal} disabled={saving}>
                取消
              </button>
              <button className="uiBtn uiBtnPrimary" onClick={createCharacter} disabled={!canSave}>
                {saving ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
