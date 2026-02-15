'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Alert = { type: 'ok' | 'err'; text: string } | null

type CharacterRow = {
  id: string
  name: string
  system_prompt: string
  visibility?: 'private' | 'public' | string | null
}

export default function EditCharacterPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const characterId = params?.characterId || ''

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [alert, setAlert] = useState<Alert>(null)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')

  const canSave = useMemo(() => {
    return !loading && !saving && !deleting && name.trim().length > 0 && prompt.trim().length > 0
  }, [loading, saving, deleting, name, prompt])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setAlert(null)

      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        router.replace('/login')
        return
      }

      const r1 = await supabase.from('characters').select('id,name,system_prompt,visibility').eq('id', characterId).single()
      if (r1.error) {
        setAlert({ type: 'err', text: `加载失败：${r1.error.message || 'unknown error'}` })
        setLoading(false)
        return
      }

      const row = r1.data as CharacterRow
      setName(row.name || '')
      setPrompt(row.system_prompt || '')
      setVisibility(row.visibility === 'public' ? 'public' : 'private')

      setLoading(false)
    }

    if (!characterId) return
    load()
  }, [characterId, router])

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setAlert(null)

    // Try schema with visibility; fall back if legacy schema.
    const r1 = await supabase
      .from('characters')
      .update({ name: name.trim(), system_prompt: prompt.trim(), visibility })
      .eq('id', characterId)

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && msg.includes('visibility')
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `保存失败：${msg || 'unknown error'}` })
        setSaving(false)
        return
      }

      const r2 = await supabase.from('characters').update({ name: name.trim(), system_prompt: prompt.trim() }).eq('id', characterId)
      if (r2.error) {
        setAlert({ type: 'err', text: `保存失败：${r2.error.message || 'unknown error'}` })
        setSaving(false)
        return
      }
    }

    setAlert({ type: 'ok', text: '已保存。' })
    setSaving(false)
  }

  const del = async () => {
    if (deleting) return
    const ok = confirm('确认删除这个角色？删除后不可恢复。')
    if (!ok) return

    setDeleting(true)
    setAlert(null)
    const r = await supabase.from('characters').delete().eq('id', characterId)
    if (r.error) {
      setAlert({ type: 'err', text: `删除失败：${r.error.message || 'unknown error'}` })
      setDeleting(false)
      return
    }

    router.replace('/characters')
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">编辑角色</h1>
              <span className="uiBadge">{characterId ? characterId.slice(0, 8) : '...'}</span>
            </div>
            <p className="uiSubtitle">修改名称 / Prompt / 可见性</p>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              返回
            </button>
          </div>
        </div>
      </header>

      <main className="uiMain">
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiPanel">
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">基础信息</div>
                <div className="uiPanelSub">保存后会作用于后续聊天。删除不可恢复。</div>
              </div>
            </div>

            <div className="uiForm">
              <label className="uiLabel">
                角色名称
                <input className="uiInput" value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="uiLabel">
                System Prompt
                <textarea className="uiTextarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>

              <label className="uiLabel">
                可见性
                <select className="uiInput" value={visibility} onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'private')}>
                  <option value="private">私密（仅自己可见）</option>
                  <option value="public">公开（可出现在广场）</option>
                </select>
              </label>
            </div>

            <div className="uiPanelFooter">
              <button className="uiBtn uiBtnSecondary" disabled={!canSave} onClick={save}>
                {saving ? '保存中...' : '保存'}
              </button>
              <button className="uiBtn uiBtnGhost" disabled={deleting} onClick={del}>
                {deleting ? '删除中...' : '删除角色'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
