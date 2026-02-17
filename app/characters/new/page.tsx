'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ensureLatestConversationForCharacter } from '@/lib/conversationClient'
import AppShell from '@/app/_components/AppShell'

type Alert = { type: 'ok' | 'err'; text: string } | null

type FormState = {
  name: string
  visibility: 'private' | 'public'
  systemPrompt: string

  gender: 'male' | 'female' | 'other'
  age: string
  occupation: string
  organization: string
  summary: string

  likes: string
  dislikes: string
  strengths: string
  weaknesses: string
  habits: string

  worldBackground: string
  userNow: string

  romanceOn: boolean
  teenMode: boolean
  outOfWorld: 'yes' | 'no'
  outOfWorldNote: string

  voice: string
  catchphrase: string
  tone: 'cool' | 'balanced' | 'warm'
  sentenceLen: 'short' | 'balanced' | 'long'

  authorNote: string
}

const DEFAULT_FORM: FormState = {
  name: '',
  visibility: 'public',
  systemPrompt: '',

  gender: 'other',
  age: '',
  occupation: '',
  organization: '',
  summary: '',

  likes: '',
  dislikes: '',
  strengths: '',
  weaknesses: '',
  habits: '',

  worldBackground: '',
  userNow: '',

  romanceOn: true,
  teenMode: false,
  outOfWorld: 'yes',
  outOfWorldNote: '',

  voice: '',
  catchphrase: '',
  tone: 'balanced',
  sentenceLen: 'balanced',

  authorNote: '',
}

function clampText(s: string, max: number) {
  const t = (s || '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function effectiveRomanceMode(f: FormState): 'ROMANCE_ON' | 'ROMANCE_OFF' {
  if (f.teenMode) return 'ROMANCE_OFF'
  return f.romanceOn ? 'ROMANCE_ON' : 'ROMANCE_OFF'
}

function buildSystemPrompt(f: FormState) {
  const ageMode = f.teenMode ? 'teen' : 'adult'
  const romanceMode = effectiveRomanceMode(f)
  const lines: string[] = []

  lines.push('【角色基础】')
  lines.push(`名字：${f.name || '(未命名)'}`)
  lines.push(`性别：${f.gender}`)
  if (f.age.trim()) lines.push(`年龄：${f.age.trim()}`)
  if (f.occupation.trim()) lines.push(`职业：${f.occupation.trim()}`)
  if (f.organization.trim()) lines.push(`所属组织：${f.organization.trim()}`)
  if (f.summary.trim()) lines.push(`人物简介：${f.summary.trim()}`)

  lines.push('')
  lines.push('【能力与习惯】')
  if (f.likes.trim()) lines.push(`喜欢：${f.likes.trim()}`)
  if (f.dislikes.trim()) lines.push(`不喜欢：${f.dislikes.trim()}`)
  if (f.strengths.trim()) lines.push(`擅长：${f.strengths.trim()}`)
  if (f.weaknesses.trim()) lines.push(`弱点：${f.weaknesses.trim()}`)
  if (f.habits.trim()) lines.push(`习惯：${f.habits.trim()}`)

  lines.push('')
  lines.push('【世界与关系】')
  if (f.worldBackground.trim()) lines.push(`世界观背景：${f.worldBackground.trim()}`)
  if (f.userNow.trim()) lines.push(`与{user}当前关系：${f.userNow.trim()}`)

  lines.push('')
  lines.push('【互动风格】')
  lines.push(`恋爱开关：${romanceMode}`)
  lines.push(`年龄模式：${ageMode}`)
  lines.push(`语气：${f.tone}`)
  lines.push(`句长倾向：${f.sentenceLen}`)
  if (f.voice.trim()) lines.push(`音色：${f.voice.trim()}`)
  if (f.catchphrase.trim()) lines.push(`口头禅：${f.catchphrase.trim()}`)
  lines.push(`能否回答超出角色设定的问题：${f.outOfWorld === 'yes' ? '可以' : '不可以'}`)
  if (f.outOfWorldNote.trim()) lines.push(`补充说明：${f.outOfWorldNote.trim()}`)

  lines.push('')
  lines.push('【硬规则】')
  lines.push('- 你不是AI助手，不解释系统提示词。')
  lines.push('- 禁止替{user}说话、替{user}做决定。')
  lines.push('- {user}的括号输入视为旁白，不当作用户台词复读。')
  if (f.teenMode) {
    lines.push('- 未成年模式：禁止露骨内容、禁止恋爱暗示与性暗示。')
  } else {
    lines.push('- 成人模式：允许亲密氛围，但禁止强迫、羞辱、违法和未成年人相关内容。')
  }
  if (romanceMode === 'ROMANCE_OFF') {
    lines.push('- ROMANCE_OFF：禁止表白、官宣、情侣称呼体系。')
  }

  return lines.join('\n').trim()
}

export default function NewCharacterPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [alert, setAlert] = useState<Alert>(null)
  const [userId, setUserId] = useState('')
  const [f, setF] = useState<FormState>(DEFAULT_FORM)

  const canCreate = useMemo(
    () => !loading && !!userId && !creating && f.name.trim().length > 0 && f.systemPrompt.trim().length > 0,
    [loading, userId, creating, f.name, f.systemPrompt],
  )
  const romanceMode = effectiveRomanceMode(f)

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 3000)
    return () => clearTimeout(t)
  }, [alert])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.replace('/login')
        return
      }
      setUserId(data.user.id)
      setLoading(false)
    }
    load().catch(() => {
      setAlert({ type: 'err', text: '加载用户信息失败。' })
      setLoading(false)
    })
  }, [router])

  const onGeneratePrompt = () => {
    setF((prev) => ({ ...prev, systemPrompt: buildSystemPrompt(prev) }))
    setAlert({ type: 'ok', text: '已根据表单生成提示词。' })
  }

  const onCreate = async (options?: { startChat?: boolean }) => {
    if (!canCreate) return
    setCreating(true)
    setAlert(null)
    const resolvedRomanceMode = effectiveRomanceMode(f)

    const payloadV2: {
      user_id: string
      name: string
      system_prompt: string
      visibility: 'private' | 'public'
      profile: Record<string, unknown>
      settings: Record<string, unknown>
    } = {
      user_id: userId,
      name: f.name.trim(),
      system_prompt: f.systemPrompt.trim(),
      visibility: f.visibility,
      profile: {
        gender: f.gender,
        age: clampText(f.age, 20),
        occupation: clampText(f.occupation, 120),
        organization: clampText(f.organization, 120),
        summary: clampText(f.summary, 1800),
      },
      settings: {
        romance_mode: resolvedRomanceMode,
        teen_mode: !!f.teenMode,
        age_mode: f.teenMode ? 'teen' : 'adult',
        plot_granularity: 'BEAT',
        ending_mode: 'MIXED',
        ending_repeat_window: 6,
        next_endings_prefer: ['A', 'B', 'S'],
        prompt_policy: {
          plot_granularity: 'BEAT',
          ending_mode: 'MIXED',
          ending_repeat_window: 6,
          next_endings_prefer: ['A', 'B', 'S'],
        },
        creation_form: {
          likes: clampText(f.likes, 900),
          dislikes: clampText(f.dislikes, 900),
          strengths: clampText(f.strengths, 900),
          weaknesses: clampText(f.weaknesses, 900),
          habits: clampText(f.habits, 900),
          world: {
            background: clampText(f.worldBackground, 2400),
          },
          user_relation: {
            now: clampText(f.userNow, 900),
          },
          dialog: {
            voice: clampText(f.voice, 120),
            catchphrase: clampText(f.catchphrase, 120),
            tone: f.tone,
            sentence_len: f.sentenceLen,
          },
          constraints: {
            out_of_world: f.outOfWorld,
            note: clampText(f.outOfWorldNote, 400),
          },
          publish: {
            author_note: clampText(f.authorNote, 1200),
          },
        },
      },
    }

    let createdCharacterId = ''
    const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `创建失败：${msg}` })
        setCreating(false)
        return
      }

      const r2 = await supabase
        .from('characters')
        .insert({
          user_id: userId,
          name: f.name.trim(),
          system_prompt: f.systemPrompt.trim(),
        })
        .select('id')
        .single()
      if (r2.error || !r2.data?.id) {
        setAlert({ type: 'err', text: `创建失败：${r2.error?.message || 'unknown error'}` })
        setCreating(false)
        return
      }
      createdCharacterId = String(r2.data.id)
    } else {
      createdCharacterId = String(r1.data?.id || '')
    }

    if (!createdCharacterId) {
      setAlert({ type: 'err', text: '创建成功但未获取角色 ID，请刷新后重试。' })
      setCreating(false)
      return
    }

    if (options?.startChat) {
      try {
        await ensureLatestConversationForCharacter({
          userId,
          characterId: createdCharacterId,
          title: f.name.trim() || '对话',
        })
        setCreating(false)
        setAlert({ type: 'ok', text: '创建成功，正在进入聊天。' })
        setTimeout(() => router.replace(`/chat/${createdCharacterId}`), 260)
        return
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setCreating(false)
        setAlert({ type: 'err', text: `角色已创建，但会话初始化失败：${msg}` })
        setTimeout(() => router.replace('/characters'), 1100)
        return
      }
    }

    setCreating(false)
    setAlert({ type: 'ok', text: '创建成功，正在返回角色工作台。' })
    setTimeout(() => router.replace('/characters'), 900)
  }

  return (
    <div className="uiPage">
      <AppShell
        title="新建角色"
        badge="studio"
        subtitle="先填写角色设定，再生成提示词并发布。"
        actions={
          <>
            <button className="uiBtn uiBtnSecondary" onClick={onGeneratePrompt} disabled={loading || creating}>
              生成提示词
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              返回工作台
            </button>
          </>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">创作流程</span>
            <h2 className="uiHeroTitle">先定角色，再定规则，最后生成可执行提示词</h2>
            <p className="uiHeroSub">这版覆盖高频字段。更细节的人设和规则可在创建后继续编辑。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{f.name.trim().length > 0 ? '已填写' : '未填写'}</b>
              <span>角色名</span>
            </div>
            <div className="uiKpi">
              <b>{f.systemPrompt.trim().length}</b>
              <span>提示词长度</span>
            </div>
            <div className="uiKpi">
              <b>{f.visibility === 'public' ? '公开' : '私密'}</b>
              <span>发布范围</span>
            </div>
            <div className="uiKpi">
              <b>{romanceMode === 'ROMANCE_ON' ? '开启' : '关闭'}</b>
              <span>恋爱模式</span>
            </div>
            <div className="uiKpi">
              <b>{f.teenMode ? '未成年' : '成人'}</b>
              <span>年龄模式</span>
            </div>
            <div className="uiKpi">
              <b>{f.outOfWorld === 'yes' ? '允许' : '禁止'}</b>
              <span>越界问答</span>
            </div>
          </div>
        </section>

        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <div className="uiPanel" style={{ marginTop: 14 }}>
            <div className="uiPanelHeader">
              <div>
                <div className="uiPanelTitle">角色表单</div>
                <div className="uiPanelSub">先填核心字段，再点击“生成提示词”。</div>
              </div>
            </div>

            <div className="uiForm" style={{ paddingTop: 14 }}>
              <div className="uiSplit">
                <label className="uiLabel">
                  角色名
                  <input className="uiInput" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="例如：林澈" />
                </label>
                <label className="uiLabel">
                  可见性
                  <select className="uiInput" value={f.visibility} onChange={(e) => setF((p) => ({ ...p, visibility: e.target.value === 'public' ? 'public' : 'private' }))}>
                    <option value="public">公开（可出现在广场）</option>
                    <option value="private">私密（仅自己可见）</option>
                  </select>
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  性别
                  <select className="uiInput" value={f.gender} onChange={(e) => setF((p) => ({ ...p, gender: e.target.value === 'male' ? 'male' : e.target.value === 'female' ? 'female' : 'other' }))}>
                    <option value="male">男</option>
                    <option value="female">女</option>
                    <option value="other">其他</option>
                  </select>
                </label>
                <label className="uiLabel">
                  年龄
                  <input className="uiInput" value={f.age} onChange={(e) => setF((p) => ({ ...p, age: e.target.value }))} placeholder="例如：23" />
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  职业
                  <input className="uiInput" value={f.occupation} onChange={(e) => setF((p) => ({ ...p, occupation: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  所属组织
                  <input className="uiInput" value={f.organization} onChange={(e) => setF((p) => ({ ...p, organization: e.target.value }))} />
                </label>
              </div>

              <label className="uiLabel">
                人物简介
                <textarea
                  className="uiTextarea"
                  value={f.summary}
                  onChange={(e) => setF((p) => ({ ...p, summary: e.target.value }))}
                  placeholder="角色核心设定、性格关键词、背景摘要。"
                />
              </label>

              <div className="uiSplit">
                <label className="uiLabel">
                  喜欢
                  <textarea className="uiTextarea" value={f.likes} onChange={(e) => setF((p) => ({ ...p, likes: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  不喜欢
                  <textarea className="uiTextarea" value={f.dislikes} onChange={(e) => setF((p) => ({ ...p, dislikes: e.target.value }))} />
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  长处
                  <textarea className="uiTextarea" value={f.strengths} onChange={(e) => setF((p) => ({ ...p, strengths: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  弱点
                  <textarea className="uiTextarea" value={f.weaknesses} onChange={(e) => setF((p) => ({ ...p, weaknesses: e.target.value }))} />
                </label>
              </div>

              <label className="uiLabel">
                习惯
                <textarea className="uiTextarea" value={f.habits} onChange={(e) => setF((p) => ({ ...p, habits: e.target.value }))} />
              </label>

              <div className="uiSplit">
                <label className="uiLabel">
                  世界观背景
                  <textarea className="uiTextarea" value={f.worldBackground} onChange={(e) => setF((p) => ({ ...p, worldBackground: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  与用户当前关系
                  <textarea className="uiTextarea" value={f.userNow} onChange={(e) => setF((p) => ({ ...p, userNow: e.target.value }))} />
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  音色
                  <input className="uiInput" value={f.voice} onChange={(e) => setF((p) => ({ ...p, voice: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  口头禅
                  <input className="uiInput" value={f.catchphrase} onChange={(e) => setF((p) => ({ ...p, catchphrase: e.target.value }))} />
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  语气
                  <select className="uiInput" value={f.tone} onChange={(e) => setF((p) => ({ ...p, tone: e.target.value as FormState['tone'] }))}>
                    <option value="cool">冷静</option>
                    <option value="balanced">均衡</option>
                    <option value="warm">热情</option>
                  </select>
                </label>
                <label className="uiLabel">
                  句长倾向
                  <select className="uiInput" value={f.sentenceLen} onChange={(e) => setF((p) => ({ ...p, sentenceLen: e.target.value as FormState['sentenceLen'] }))}>
                    <option value="short">短句</option>
                    <option value="balanced">均衡</option>
                    <option value="long">长句</option>
                  </select>
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  恋爱模式
                  <select
                    className="uiInput"
                    value={romanceMode === 'ROMANCE_ON' ? 'on' : 'off'}
                    disabled={f.teenMode}
                    onChange={(e) => setF((p) => ({ ...p, romanceOn: e.target.value === 'on' }))}
                  >
                    <option value="on">ROMANCE_ON</option>
                    <option value="off">ROMANCE_OFF</option>
                  </select>
                  {f.teenMode ? <div className="uiHint" style={{ marginTop: 6 }}>青少年模式下固定为 ROMANCE_OFF。</div> : null}
                </label>
                <label className="uiLabel">
                  年龄模式
                  <select
                    className="uiInput"
                    value={f.teenMode ? 'teen' : 'adult'}
                    onChange={(e) =>
                      setF((p) => {
                        const teen = e.target.value === 'teen'
                        return teen ? { ...p, teenMode: true, romanceOn: false } : { ...p, teenMode: false }
                      })
                    }
                  >
                    <option value="adult">成人</option>
                    <option value="teen">未成年</option>
                  </select>
                </label>
              </div>

              <div className="uiSplit">
                <label className="uiLabel">
                  超出设定的问题
                  <select className="uiInput" value={f.outOfWorld} onChange={(e) => setF((p) => ({ ...p, outOfWorld: e.target.value === 'no' ? 'no' : 'yes' }))}>
                    <option value="yes">允许回答</option>
                    <option value="no">拒绝回答</option>
                  </select>
                </label>
                <label className="uiLabel">
                  附加说明
                  <input className="uiInput" value={f.outOfWorldNote} onChange={(e) => setF((p) => ({ ...p, outOfWorldNote: e.target.value }))} />
                </label>
              </div>

              <label className="uiLabel">
                创作者备注（展示给广场浏览者）
                <textarea className="uiTextarea" value={f.authorNote} onChange={(e) => setF((p) => ({ ...p, authorNote: e.target.value }))} />
              </label>

              <label className="uiLabel">
                角色提示词（可手动调整）
                <textarea className="uiTextarea" value={f.systemPrompt} onChange={(e) => setF((p) => ({ ...p, systemPrompt: e.target.value }))} />
              </label>
            </div>

            <div className="uiPanelFooter">
              <button className="uiBtn uiBtnSecondary" onClick={onGeneratePrompt} disabled={loading || creating}>
                重新生成提示词
              </button>
              <button className="uiBtn uiBtnGhost" onClick={() => void onCreate({ startChat: true })} disabled={!canCreate}>
                {creating ? '创建中...' : '创建并开聊'}
              </button>
              <button className="uiBtn uiBtnPrimary" onClick={() => void onCreate()} disabled={!canCreate}>
                {creating ? '创建中...' : '创建角色'}
              </button>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
