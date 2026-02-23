'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type FormState = {
  name: string
  gender: string
  age: string
  occupation: string
  summary: string
  personality: string
  systemPrompt: string
  visibility: 'private' | 'public'
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function getStr(r: Record<string, unknown>, k: string): string {
  const v = r[k]
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeGender(v: string): 'male' | 'female' | 'other' {
  const s = v.trim().toLowerCase()
  if (s === 'male' || s === '男') return 'male'
  if (s === 'female' || s === '女') return 'female'
  return 'other'
}

export default function EditCharacterPage() {
  const router = useRouter()
  const params = useParams()
  const characterId = String(params?.id || '')

  const [form, setForm] = useState<FormState>({
    name: '',
    gender: 'other',
    age: '',
    occupation: '',
    summary: '',
    personality: '',
    systemPrompt: '',
    visibility: 'private',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  useEffect(() => {
    if (!characterId) return
    const run = async () => {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { router.push('/login'); return }
      const { data, error: e } = await supabase
        .from('characters')
        .select('id,name,system_prompt,profile,settings,visibility')
        .eq('id', characterId)
        .eq('user_id', userData.user.id)
        .maybeSingle()
      if (e || !data) { setError('角色不存在或无权编辑'); setLoading(false); return }
      const p = asRecord(data.profile)
      const rawGender = getStr(p, 'gender') || getStr(p, 'sex')
      setForm({
        name: String(data.name || ''),
        gender: normalizeGender(rawGender),
        age: getStr(p, 'age'),
        occupation: getStr(p, 'occupation'),
        summary: getStr(p, 'summary') || getStr(p, 'introduction'),
        personality: getStr(p, 'personality') || getStr(p, 'personality_summary'),
        systemPrompt: String(data.system_prompt || ''),
        visibility: data.visibility === 'public' ? 'public' : 'private',
      })
      setLoading(false)
    }
    run().catch(() => { setError('加载失败'); setLoading(false) })
  }, [characterId, router])

  const handleSave = async () => {
    if (!form.name.trim()) { setError('请填写角色名称'); return }
    setSaving(true)
    setError('')
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) { router.push('/login'); return }

      const profile: Record<string, string> = {}
      if (form.gender) profile.gender = form.gender === 'male' ? '男' : form.gender === 'female' ? '女' : '其他'
      if (form.age.trim()) profile.age = form.age.trim()
      if (form.occupation.trim()) profile.occupation = form.occupation.trim()
      if (form.summary.trim()) profile.summary = form.summary.trim()
      if (form.personality.trim()) profile.personality = form.personality.trim()

      const { error: updateErr } = await supabase
        .from('characters')
        .update({
          name: form.name.trim(),
          system_prompt: form.systemPrompt.trim(),
          profile,
          visibility: form.visibility,
        })
        .eq('id', characterId)
        .eq('user_id', userData.user.id)

      if (updateErr) { setError(updateErr.message); return }
      router.push('/aibaji/characters')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="charFormPage"><div className="charFormLoading">加载中...</div></div>

  return (
    <div className="charFormPage">
      <button className="charFormBack" onClick={() => router.push('/aibaji/characters')}>← 返回</button>
      <h2 className="charFormTitle">编辑角色</h2>

      {error && <div className="charFormError">{error}</div>}

      <div className="charFormBody">
        <div className="charFormSection">
          <div className="charFormLabel">角色名称 <span className="charFormRequired">*</span></div>
          <input
            className="charFormInput"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="charFormRow">
          <div className="charFormSection">
            <div className="charFormLabel">性别</div>
            <div className="charFormRadioGroup">
              {(['male', 'female', 'other'] as const).map((g) => (
                <label key={g} className={`charFormRadio${form.gender === g ? ' charFormRadioActive' : ''}`}>
                  <input type="radio" name="gender" value={g} checked={form.gender === g} onChange={() => set('gender', g)} />
                  {g === 'male' ? '男' : g === 'female' ? '女' : '其他'}
                </label>
              ))}
            </div>
          </div>
          <div className="charFormSection">
            <div className="charFormLabel">年龄</div>
            <input
              className="charFormInput"
              placeholder="例如：18"
              value={form.age}
              onChange={(e) => set('age', e.target.value)}
            />
          </div>
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">职业 / 身份</div>
          <input
            className="charFormInput"
            value={form.occupation}
            onChange={(e) => set('occupation', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">一句话简介</div>
          <input
            className="charFormInput"
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">性格描述</div>
          <textarea
            className="charFormTextarea"
            rows={3}
            value={form.personality}
            onChange={(e) => set('personality', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">系统 Prompt</div>
          <textarea
            className="charFormTextarea charFormTextareaLarge"
            rows={6}
            value={form.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">可见性</div>
          <div className="charFormRadioGroup">
            <label className={`charFormRadio${form.visibility === 'private' ? ' charFormRadioActive' : ''}`}>
              <input type="radio" name="visibility" value="private" checked={form.visibility === 'private'} onChange={() => set('visibility', 'private')} />
              私密（仅自己可见）
            </label>
            <label className={`charFormRadio${form.visibility === 'public' ? ' charFormRadioActive' : ''}`}>
              <input type="radio" name="visibility" value="public" checked={form.visibility === 'public'} onChange={() => set('visibility', 'public')} />
              发布到广场
            </label>
          </div>
        </div>

        <div className="charFormActions">
          <button className="charFormCancelBtn" onClick={() => router.push('/aibaji/characters')}>
            取消
          </button>
          <button className="charFormSubmitBtn" onClick={() => { void handleSave() }} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
