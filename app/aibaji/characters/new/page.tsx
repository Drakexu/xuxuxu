'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ArrowLeft } from 'lucide-react'

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

  const inputClass =
    'w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all'

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/aibaji/characters')}
              className="w-8 h-8 rounded-full bg-zinc-900 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-400 text-[10px] font-black uppercase tracking-widest">
              Studio
            </span>
          </div>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-pink-600 text-white text-sm font-bold hover:bg-pink-500 shadow-lg shadow-pink-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '创建中...' : '创建角色'}
          </button>
        </div>
      </div>

      {/* Page content */}
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Title */}
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">创建新角色</h1>
          <p className="text-sm text-zinc-400 mt-1">填写角色信息，打造独一无二的 AI 伙伴</p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-3 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Basic info section */}
        <div className="border border-zinc-800/50 rounded-[1.5rem] bg-zinc-900/30">
          <div className="p-6 space-y-6">
            {/* Name */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">
                角色名称 <span className="text-pink-400">*</span>
              </label>
              <input
                className={inputClass}
                placeholder="给你的角色起个名字"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>

            {/* Gender + Age row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">性别</label>
                <div className="flex gap-2">
                  {(['male', 'female', 'other'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set('gender', g)}
                      className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                        form.gender === g
                          ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {g === 'male' ? '男' : g === 'female' ? '女' : '其他'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">年龄</label>
                <input
                  className={inputClass}
                  placeholder="例如：18"
                  value={form.age}
                  onChange={(e) => set('age', e.target.value)}
                />
              </div>
            </div>

            {/* Occupation */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">职业 / 身份</label>
              <input
                className={inputClass}
                placeholder="例如：高中生、咖啡师、魔法学院学生..."
                value={form.occupation}
                onChange={(e) => set('occupation', e.target.value)}
              />
            </div>

            {/* Summary */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">一句话简介</label>
              <input
                className={inputClass}
                placeholder="广场卡片上展示的简短介绍"
                value={form.summary}
                onChange={(e) => set('summary', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Personality section */}
        <div className="border border-zinc-800/50 rounded-[1.5rem] bg-zinc-900/30">
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">性格描述</label>
              <textarea
                className={`${inputClass} min-h-[100px] resize-y`}
                placeholder="描述角色的性格、说话风格、特点..."
                rows={3}
                value={form.personality}
                onChange={(e) => set('personality', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">系统 Prompt（可选）</label>
              <p className="text-[10px] text-zinc-500">留空则根据以上信息自动生成；填写则完全使用你的内容</p>
              <textarea
                className={`${inputClass} min-h-[160px] resize-y`}
                placeholder="你可以在这里写完整的角色扮演 prompt..."
                rows={6}
                value={form.systemPrompt}
                onChange={(e) => set('systemPrompt', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Visibility section */}
        <div className="border border-zinc-800/50 rounded-[1.5rem] bg-zinc-900/30">
          <div className="p-6 space-y-2">
            <label className="text-xs font-bold text-zinc-400">可见性</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => set('visibility', 'private')}
                className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  form.visibility === 'private'
                    ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                私密（仅自己可见）
              </button>
              <button
                type="button"
                onClick={() => set('visibility', 'public')}
                className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  form.visibility === 'public'
                    ? 'border-pink-500/50 bg-pink-500/10 text-pink-400'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                发布到广场（所有人可见）
              </button>
            </div>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="flex items-center justify-end gap-3 pb-8">
          <button
            onClick={() => router.push('/aibaji/characters')}
            className="px-5 py-2.5 rounded-xl border border-zinc-800 text-sm text-zinc-400 font-medium hover:text-white hover:border-zinc-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => { void handleSubmit() }}
            disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-pink-600 text-white text-sm font-bold hover:bg-pink-500 shadow-lg shadow-pink-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
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
