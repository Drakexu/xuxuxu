'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import AppShell from '@/app/_components/AppShell'

type Alert = { type: 'ok' | 'err'; text: string } | null

type CharacterRow = {
  id: string
  name: string
  system_prompt: string
  visibility?: 'private' | 'public' | string | null
  settings?: Record<string, unknown> | null
}

type AgeMode = 'adult' | 'teen'
type RomanceMode = 'ROMANCE_ON' | 'ROMANCE_OFF'

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
  const [settingsRaw, setSettingsRaw] = useState<Record<string, unknown>>({})
  const [userCard, setUserCard] = useState('')
  const [ageMode, setAgeMode] = useState<AgeMode>('adult')
  const [romanceMode, setRomanceMode] = useState<RomanceMode>('ROMANCE_ON')
  const [plotGranularity, setPlotGranularity] = useState<'LINE' | 'BEAT' | 'SCENE'>('BEAT')
  const [endingMode, setEndingMode] = useState<'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED'>('MIXED')
  const [endingRepeatWindow, setEndingRepeatWindow] = useState(6)

  const canSave = useMemo(() => !loading && !saving && !deleting && name.trim().length > 0 && prompt.trim().length > 0, [loading, saving, deleting, name, prompt])

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

      const r1 = await supabase.from('characters').select('id,name,system_prompt,visibility,settings').eq('id', characterId).single()
      if (r1.error) {
        setAlert({ type: 'err', text: `加载失败：${r1.error.message || 'unknown error'}` })
        setLoading(false)
        return
      }

      const row = r1.data as CharacterRow
      setName(row.name || '')
      setPrompt(row.system_prompt || '')
      setVisibility(row.visibility === 'public' ? 'public' : 'private')

      const settings = row.settings && typeof row.settings === 'object' ? (row.settings as Record<string, unknown>) : {}
      setSettingsRaw(settings)
      setUserCard(typeof settings.user_card === 'string' ? settings.user_card.slice(0, 300) : '')

      const teenMode = settings.teen_mode === true || settings.age_mode === 'teen'
      setAgeMode(teenMode ? 'teen' : 'adult')
      setRomanceMode(teenMode ? 'ROMANCE_OFF' : settings.romance_mode === 'ROMANCE_OFF' ? 'ROMANCE_OFF' : 'ROMANCE_ON')

      const policy = settings.prompt_policy && typeof settings.prompt_policy === 'object' ? (settings.prompt_policy as Record<string, unknown>) : {}
      const plotRaw = String(policy.plot_granularity ?? settings.plot_granularity ?? 'BEAT').toUpperCase()
      const endingRaw = String(policy.ending_mode ?? settings.ending_mode ?? 'MIXED').toUpperCase()
      const windowRaw = Number(policy.ending_repeat_window ?? settings.ending_repeat_window ?? 6)

      setPlotGranularity(plotRaw === 'LINE' || plotRaw === 'SCENE' ? (plotRaw as 'LINE' | 'SCENE') : 'BEAT')
      setEndingMode(
        endingRaw === 'QUESTION' || endingRaw === 'ACTION' || endingRaw === 'CLIFF' || endingRaw === 'MIXED'
          ? (endingRaw as 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED')
          : 'MIXED',
      )
      setEndingRepeatWindow(Number.isFinite(windowRaw) ? Math.max(3, Math.min(Math.floor(windowRaw), 12)) : 6)

      setLoading(false)
    }

    if (!characterId) return
    void load()
  }, [characterId, router])

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setAlert(null)

    const resolvedRomanceMode = ageMode === 'teen' ? 'ROMANCE_OFF' : romanceMode
    const nextSettings = {
      ...settingsRaw,
      user_card: userCard.slice(0, 300),
      teen_mode: ageMode === 'teen',
      age_mode: ageMode,
      romance_mode: resolvedRomanceMode,
      plot_granularity: plotGranularity,
      ending_mode: endingMode,
      ending_repeat_window: endingRepeatWindow,
      next_endings_prefer:
        endingMode === 'QUESTION'
          ? ['Q', 'A', 'B']
          : endingMode === 'ACTION'
            ? ['A', 'B', 'S']
            : endingMode === 'CLIFF'
              ? ['S', 'A', 'B']
              : ['A', 'B', 'S'],
      prompt_policy: {
        ...(settingsRaw.prompt_policy && typeof settingsRaw.prompt_policy === 'object' ? (settingsRaw.prompt_policy as Record<string, unknown>) : {}),
        plot_granularity: plotGranularity,
        ending_mode: endingMode,
        ending_repeat_window: endingRepeatWindow,
      },
    }

    const r1 = await supabase
      .from('characters')
      .update({ name: name.trim(), system_prompt: prompt.trim(), visibility, settings: nextSettings })
      .eq('id', characterId)

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('visibility') || msg.includes('settings'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `保存失败: ${msg || 'unknown error'}` })
        setSaving(false)
        return
      }

      const r2 = await supabase.from('characters').update({ name: name.trim(), system_prompt: prompt.trim() }).eq('id', characterId)
      if (r2.error) {
        setAlert({ type: 'err', text: `保存失败: ${r2.error.message || 'unknown error'}` })
        setSaving(false)
        return
      }
    }

    setSettingsRaw(nextSettings)
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
      <AppShell
        title="编辑角色"
        badge={characterId ? characterId.slice(0, 8) : '...'}
        subtitle="修改角色核心设定、提示词与发布设置。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
            返回工作台
          </button>
        }
      >
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiPanel" style={{ marginTop: 0 }}>
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">基础信息</div>
                <div className="uiPanelSub">保存后会作用于后续对话。删除不可恢复。</div>
              </div>
            </div>

            <div className="uiForm">
              <label className="uiLabel">
                角色名称
                <input className="uiInput" value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="uiLabel">
                角色提示词
                <textarea className="uiTextarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </label>

              <label className="uiLabel">
                身份卡（注入 Prompt，0~300 字）
                <textarea
                  className="uiTextarea"
                  value={userCard}
                  maxLength={300}
                  onChange={(e) => setUserCard(e.target.value.slice(0, 300))}
                  placeholder="例如：你希望角色重点知道的背景、关系定位、禁区、偏好。"
                />
                <div className="uiHint" style={{ marginTop: 6 }}>
                  {userCard.length}/300
                </div>
              </label>

              <label className="uiLabel">
                可见性
                <select className="uiInput" value={visibility} onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'private')}>
                  <option value="private">私密（仅自己可见）</option>
                  <option value="public">公开（可出现在广场）</option>
                </select>
              </label>

              <div className="uiSplit">
                <label className="uiLabel">
                  年龄模式
                  <select
                    className="uiInput"
                    value={ageMode}
                    onChange={(e) => {
                      const next = e.target.value === 'teen' ? 'teen' : 'adult'
                      setAgeMode(next)
                      if (next === 'teen') setRomanceMode('ROMANCE_OFF')
                    }}
                  >
                    <option value="adult">adult</option>
                    <option value="teen">teen</option>
                  </select>
                </label>

                <label className="uiLabel">
                  恋爱模式
                  <select
                    className="uiInput"
                    value={ageMode === 'teen' ? 'ROMANCE_OFF' : romanceMode}
                    disabled={ageMode === 'teen'}
                    onChange={(e) => setRomanceMode(e.target.value === 'ROMANCE_OFF' ? 'ROMANCE_OFF' : 'ROMANCE_ON')}
                  >
                    <option value="ROMANCE_ON">ROMANCE_ON</option>
                    <option value="ROMANCE_OFF">ROMANCE_OFF</option>
                  </select>
                  {ageMode === 'teen' ? <div className="uiHint" style={{ marginTop: 6 }}>teen 模式下固定为 ROMANCE_OFF。</div> : null}
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  剧情颗粒度
                  <select className="uiInput" value={plotGranularity} onChange={(e) => setPlotGranularity(e.target.value as 'LINE' | 'BEAT' | 'SCENE')}>
                    <option value="LINE">LINE</option>
                    <option value="BEAT">BEAT</option>
                    <option value="SCENE">SCENE</option>
                  </select>
                </label>

                <label className="uiLabel">
                  结尾策略
                  <select className="uiInput" value={endingMode} onChange={(e) => setEndingMode(e.target.value as 'QUESTION' | 'ACTION' | 'CLIFF' | 'MIXED')}>
                    <option value="MIXED">MIXED</option>
                    <option value="QUESTION">QUESTION</option>
                    <option value="ACTION">ACTION</option>
                    <option value="CLIFF">CLIFF</option>
                  </select>
                </label>
              </div>

              <label className="uiLabel">
                结尾防复读窗口
                <select className="uiInput" value={String(endingRepeatWindow)} onChange={(e) => setEndingRepeatWindow(Math.max(3, Math.min(Number(e.target.value) || 6, 12)))}>
                  <option value="4">4</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                  <option value="10">10</option>
                  <option value="12">12</option>
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
      </AppShell>
    </div>
  )
}
