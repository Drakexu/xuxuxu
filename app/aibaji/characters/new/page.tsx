'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft, Loader } from 'lucide-react'

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

  const inputCls = "w-full px-4 py-3.5 rounded-2xl border border-zinc-800 bg-zinc-950 text-white placeholder:text-zinc-600 text-sm font-medium focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all"
  const labelCls = "text-[10px] font-mono font-black uppercase tracking-[0.3em] text-zinc-500 mb-2 block"

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/50 px-5 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push('/aibaji/characters')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-black text-white tracking-tight">创建新角色</h2>
      </div>

      {/* Form */}
      <div className="flex flex-col gap-5 px-5 pt-6 pb-24">
        {error && (
          <div className="px-5 py-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Name */}
        <div>
          <label className={labelCls}>角色名称 <span className="text-pink-500">*</span></label>
          <input
            className={inputCls}
            placeholder="给你的角色起个名字"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        {/* Gender + Age */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>性别</label>
            <div className="flex gap-2">
              {(['male', 'female', 'other'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => set('gender', g)}
                  className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all"
                  style={
                    form.gender === g
                      ? { background: 'rgba(236,72,153,0.1)', color: '#ec4899', borderColor: 'rgba(236,72,153,0.3)' }
                      : { background: '#18181b', color: '#52525b', borderColor: '#27272a' }
                  }
                >
                  {g === 'male' ? '男' : g === 'female' ? '女' : '其他'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>年龄</label>
            <input
              className={inputCls}
              placeholder="例如：18"
              value={form.age}
              onChange={(e) => set('age', e.target.value)}
            />
          </div>
        </div>

        {/* Occupation */}
        <div>
          <label className={labelCls}>职业 / 身份</label>
          <input
            className={inputCls}
            placeholder="例如：高中生、咖啡师、魔法学院学生..."
            value={form.occupation}
            onChange={(e) => set('occupation', e.target.value)}
          />
        </div>

        {/* Summary */}
        <div>
          <label className={labelCls}>一句话简介</label>
          <input
            className={inputCls}
            placeholder="广场卡片上展示的简短介绍"
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
          />
        </div>

        {/* Personality */}
        <div>
          <label className={labelCls}>性格描述</label>
          <textarea
            className={`${inputCls} resize-none`}
            placeholder="描述角色的性格、说话风格、特点..."
            rows={3}
            value={form.personality}
            onChange={(e) => set('personality', e.target.value)}
          />
        </div>

        {/* System Prompt */}
        <div>
          <label className={labelCls}>系统 Prompt（可选）</label>
          <p className="text-[11px] text-zinc-600 font-medium mb-2">留空则根据以上信息自动生成；填写则完全使用你的内容</p>
          <textarea
            className={`${inputCls} resize-none`}
            placeholder="你可以在这里写完整的角色扮演 prompt..."
            rows={6}
            value={form.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
          />
        </div>

        {/* Visibility */}
        <div>
          <label className={labelCls}>可见性</label>
          <div className="flex flex-col gap-2">
            {(['private', 'public'] as const).map((v) => (
              <button
                key={v}
                onClick={() => set('visibility', v)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border transition-all text-left"
                style={
                  form.visibility === v
                    ? { background: 'rgba(236,72,153,0.08)', borderColor: 'rgba(236,72,153,0.3)' }
                    : { background: '#18181b', borderColor: '#27272a' }
                }
              >
                <div
                  className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={
                    form.visibility === v
                      ? { borderColor: '#ec4899', background: '#ec4899' }
                      : { borderColor: '#3f3f46' }
                  }
                >
                  {form.visibility === v && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <span className="text-sm font-black text-white">
                  {v === 'private' ? '私密（仅自己可见）' : '发布到广场（所有人可见）'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 flex gap-3">
        <button
          onClick={() => router.push('/aibaji/characters')}
          className="flex-1 py-4 rounded-2xl border border-zinc-700 text-zinc-300 text-xs font-black uppercase tracking-widest hover:border-zinc-500 hover:text-white transition-all active:scale-[0.98]"
        >
          取消
        </button>
        <button
          onClick={() => { void handleSubmit() }}
          disabled={saving}
          className="flex-1 py-4 rounded-2xl text-white text-xs font-black uppercase tracking-widest transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(to right, #ec4899, #a855f7)', boxShadow: '0 0 20px rgba(236,72,153,0.3)' }}
        >
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : null}
          {saving ? '创建中...' : '创建角色'}
        </button>
      </div>
    </div>
  )
}

function buildDefaultPrompt(form: FormState): string {
  const parts: string[] = []
  const name = form.name.trim()
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
