'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type FormState = {
  name: string
  gender: 'male' | 'female' | 'other'
  age: string
  occupation: string
  summary: string
  personality: string
  systemPrompt: string
  visibility: 'private' | 'public'
}

const DEFAULT_FORM: FormState = {
  name: '',
  gender: 'other',
  age: '',
  occupation: '',
  summary: '',
  personality: '',
  systemPrompt: '',
  visibility: 'private',
}

export default function NewCharacterPage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = async () => {
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

      const systemPrompt = form.systemPrompt.trim() || buildDefaultPrompt(form)

      const { data: newChar, error: insertErr } = await supabase
        .from('characters')
        .insert({
          user_id: userData.user.id,
          name: form.name.trim(),
          system_prompt: systemPrompt,
          profile,
          settings: {},
          visibility: form.visibility,
        })
        .select('id')
        .single()

      if (insertErr || !newChar?.id) {
        setError(insertErr?.message || '创建失败')
        return
      }
      router.push('/aibaji/characters')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="charFormPage">
      <button className="charFormBack" onClick={() => router.push('/aibaji/characters')}>← 返回</button>
      <h2 className="charFormTitle">创建新角色</h2>

      {error && <div className="charFormError">{error}</div>}

      <div className="charFormBody">
        <div className="charFormSection">
          <div className="charFormLabel">角色名称 <span className="charFormRequired">*</span></div>
          <input
            className="charFormInput"
            placeholder="给你的角色起个名字"
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
            placeholder="例如：高中生、咖啡师、魔法学院学生..."
            value={form.occupation}
            onChange={(e) => set('occupation', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">一句话简介</div>
          <input
            className="charFormInput"
            placeholder="广场卡片上展示的简短介绍"
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">性格描述</div>
          <textarea
            className="charFormTextarea"
            placeholder="描述角色的性格、说话风格、特点..."
            rows={3}
            value={form.personality}
            onChange={(e) => set('personality', e.target.value)}
          />
        </div>

        <div className="charFormSection">
          <div className="charFormLabel">系统 Prompt（可选）</div>
          <div className="charFormHint">留空则根据以上信息自动生成；填写则完全使用你的内容</div>
          <textarea
            className="charFormTextarea charFormTextareaLarge"
            placeholder="你可以在这里写完整的角色扮演 prompt..."
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
              发布到广场（所有人可见）
            </label>
          </div>
        </div>

        <div className="charFormActions">
          <button className="charFormCancelBtn" onClick={() => router.push('/aibaji/characters')}>
            取消
          </button>
          <button className="charFormSubmitBtn" onClick={() => { void handleSubmit() }} disabled={saving}>
            {saving ? '创建中...' : '创建角色'}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildDefaultPrompt(form: FormState): string {
  const parts: string[] = []
  const name = form.name.trim()
  const gender = form.gender === 'male' ? '男性' : form.gender === 'female' ? '女性' : '人物'
  const age = form.age.trim() ? `${form.age.trim()}岁` : ''
  const occ = form.occupation.trim()
  const summary = form.summary.trim()
  const personality = form.personality.trim()

  const intro = [name, age, occ].filter(Boolean).join('，')
  parts.push(`你是${intro}。`)
  if (summary) parts.push(summary)
  if (personality) parts.push(`性格：${personality}`)
  parts.push('请用第一人称扮演这个角色，与用户自然地对话。')
  return parts.join('\n')
}
