'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Alert = { type: 'ok' | 'err'; text: string } | null

type Gender = 'male' | 'female' | 'other'
type PersonalityAxisValue = 'left' | 'mid' | 'right'

type FormState = {
  name: string
  systemPrompt: string
  visibility: 'private' | 'public'

  nickname: string
  gender: Gender
  age: string
  birthday: string
  appearance: 'human' | 'nonhuman'
  organization: string
  occupation: string

  likes: string
  dislikes: string
  strengths: string
  weaknesses: string
  habits: string

  personality: {
    axis1: PersonalityAxisValue // 温和-暴躁
    axis2: PersonalityAxisValue // 内向-外向
    axis3: PersonalityAxisValue // 理性-感性
    axis4: PersonalityAxisValue // 独立-依赖
    axis5: PersonalityAxisValue // 担当-逃避
    axis6: PersonalityAxisValue // 自我-讨好
    axis7: PersonalityAxisValue // 坚强-脆弱
  }

  moral: 'good' | 'neutral' | 'evil'
  order: 'lawful' | 'neutral' | 'chaotic'
  valuesExtra: string

  romanceOn: boolean
  teenMode: boolean
  loveGrowth: 'slow' | 'normal' | 'fast'
  jealousy: 'low' | 'normal' | 'high'
  privateSpace: 'weak' | 'normal' | 'strong'
  intimacyAccept: 'low' | 'normal' | 'high'
  sweetTalk: 'low' | 'normal' | 'high'
  loveExpression: 'passive' | 'normal' | 'active'
  loveExtra: string

  worldBackground: string
  family: string
  friends: string
  colleagues: string
  enemies: string
  worldExtra: string

  pastExperience: string
  currentStage: string
  futureDestiny: string

  userPast: string
  userNow: string
  userFuture: string

  voice: string
  catchphrase: string
  sentenceLen: 'short' | 'balanced' | 'long'
  completeness: 'low' | 'balanced' | 'high'
  tone: 'cool' | 'balanced' | 'warm'
  enthusiasm: 'clingy' | 'balanced' | 'troll'
  dialogExtra: string

  outOfWorld: 'yes' | 'no'
  outOfWorldNote: string

  audienceGender: 'all' | 'male' | 'female'
  authorNote: string
}

function clampText(s: string, max: number) {
  const t = (s || '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function axisLabel(v: PersonalityAxisValue, left: string, right: string) {
  if (v === 'left') return left
  if (v === 'right') return right
  return '中间'
}

function buildSystemPromptFromForm(f: FormState) {
  const ageMode = f.teenMode ? 'teen' : 'adult'
  const romanceMode = f.romanceOn ? 'ROMANCE_ON' : 'ROMANCE_OFF'

  const parts: string[] = []

  parts.push('【基础信息】')
  parts.push(`名字：${f.name || '（未命名）'}`)
  if (f.nickname) parts.push(`昵称/称呼：${f.nickname}`)
  parts.push(`性别：${f.gender}`)
  if (f.age) parts.push(`年龄：${f.age}`)
  if (f.birthday) parts.push(`生日：${f.birthday}`)
  parts.push(`外观：${f.appearance === 'nonhuman' ? '非人形角色' : '人形角色'}`)
  if (f.organization) parts.push(`所属组织：${f.organization}`)
  if (f.occupation) parts.push(`职业：${f.occupation}`)

  parts.push('')
  parts.push('【角色喜好与技能】')
  if (f.likes) parts.push(`喜欢的事：${f.likes}`)
  if (f.dislikes) parts.push(`不喜欢的事：${f.dislikes}`)
  if (f.strengths) parts.push(`擅长的技能：${f.strengths}`)
  if (f.weaknesses) parts.push(`不擅长的技能：${f.weaknesses}`)
  if (f.habits) parts.push(`特殊习惯：${f.habits}`)

  parts.push('')
  parts.push('【性格】')
  parts.push(`性格1：${axisLabel(f.personality.axis1, '温和', '暴躁')}`)
  parts.push(`性格2：${axisLabel(f.personality.axis2, '内向', '外向')}`)
  parts.push(`性格3：${axisLabel(f.personality.axis3, '理性', '感性')}`)
  parts.push(`性格4：${axisLabel(f.personality.axis4, '独立', '依赖')}`)
  parts.push(`性格5：${axisLabel(f.personality.axis5, '担当', '逃避')}`)
  parts.push(`性格6：${axisLabel(f.personality.axis6, '自我', '讨好')}`)
  parts.push(`性格7：${axisLabel(f.personality.axis7, '坚强', '脆弱')}`)

  parts.push('')
  parts.push('【价值观】')
  parts.push(`道德程度：${f.moral}`)
  parts.push(`秩序程度：${f.order}`)
  if (f.valuesExtra) parts.push(`价值观补充：${f.valuesExtra}`)

  parts.push('')
  parts.push('【感情观】')
  parts.push(`恋爱开关：${romanceMode}`)
  parts.push(`年龄模式：${ageMode}`)
  parts.push(`情感成长速度：${f.loveGrowth}`)
  parts.push(`独占欲：${f.jealousy}`)
  parts.push(`私人空间意识：${f.privateSpace}`)
  parts.push(`亲密动作接受度：${f.intimacyAccept}`)
  parts.push(`甜言蜜语比例：${f.sweetTalk}`)
  parts.push(`爱意表达方式：${f.loveExpression}`)
  if (f.loveExtra) parts.push(`感情观补充：${f.loveExtra}`)

  parts.push('')
  parts.push('【世界观】')
  if (f.worldBackground) parts.push(`背景设定：${f.worldBackground}`)
  if (f.family) parts.push(`家人：${f.family}`)
  if (f.friends) parts.push(`朋友：${f.friends}`)
  if (f.colleagues) parts.push(`同事/同学：${f.colleagues}`)
  if (f.enemies) parts.push(`仇人：${f.enemies}`)
  if (f.worldExtra) parts.push(`世界观补充：${f.worldExtra}`)

  parts.push('')
  parts.push('【角色命运】')
  if (f.pastExperience) parts.push(`过往经历：${f.pastExperience}`)
  if (f.currentStage) parts.push(`当前阶段：${f.currentStage}`)
  if (f.futureDestiny) parts.push(`未来命运：${f.futureDestiny}`)

  parts.push('')
  parts.push('【你与{user}的关系】')
  if (f.userPast) parts.push(`过去经历：${f.userPast}`)
  if (f.userNow) parts.push(`当前关系阶段：${f.userNow}`)
  if (f.userFuture) parts.push(`未来关系走向：${f.userFuture}`)

  parts.push('')
  parts.push('【对话风格】')
  if (f.voice) parts.push(`音色：${f.voice}`)
  if (f.catchphrase) parts.push(`口癖/口头禅：${f.catchphrase}`)
  parts.push(`长短句倾向：${f.sentenceLen}`)
  parts.push(`表达完整性：${f.completeness}`)
  parts.push(`对话语气：${f.tone}`)
  parts.push(`热情程度：${f.enthusiasm}`)
  if (f.dialogExtra) parts.push(`其他对话信息：${f.dialogExtra}`)

  parts.push('')
  parts.push('【人设约束】')
  parts.push(
    `能否回答超出角色时空的问题：${f.outOfWorld === 'yes' ? '可以回答（用角色口吻解释）' : '不可以回答（保持世界观内）'}`,
  )
  if (f.outOfWorldNote) parts.push(`补充说明：${f.outOfWorldNote}`)

  parts.push('')
  parts.push('【硬规则】')
  parts.push('- 你不是AI/助手/模型，不要自称或解释系统。')
  parts.push('- 禁止替{user}说话、替{user}做决定、替{user}输出心理活动。')
  parts.push('- {user}的括号输入是导演旁白/指令，不要当作台词回怼。')
  if (f.teenMode) {
    parts.push('- 青少年模式：禁止露骨内容；禁止恋爱与性暗示；语言健康克制。')
  } else {
    parts.push('- 成人模式：允许亲密氛围，但禁止露骨性细节、强迫、羞辱、未成年相关内容。')
  }
  if (!f.romanceOn) {
    parts.push('- 恋爱开关：ROMANCE_OFF。禁止表白/官宣/情侣承诺/情侣称呼体系；可发展为知己/搭档/守护等非恋爱亲密关系。')
  }

  return parts.filter(Boolean).join('\n').trim()
}

const DEFAULT_FORM: FormState = {
  name: '',
  systemPrompt: '',
  visibility: 'public',

  nickname: '',
  gender: 'other',
  age: '',
  birthday: '',
  appearance: 'human',
  organization: '',
  occupation: '',

  likes: '',
  dislikes: '',
  strengths: '',
  weaknesses: '',
  habits: '',

  personality: { axis1: 'mid', axis2: 'mid', axis3: 'mid', axis4: 'mid', axis5: 'mid', axis6: 'mid', axis7: 'mid' },

  moral: 'neutral',
  order: 'neutral',
  valuesExtra: '',

  romanceOn: true,
  teenMode: false,
  loveGrowth: 'normal',
  jealousy: 'normal',
  privateSpace: 'normal',
  intimacyAccept: 'normal',
  sweetTalk: 'normal',
  loveExpression: 'normal',
  loveExtra: '',

  worldBackground: '',
  family: '',
  friends: '',
  colleagues: '',
  enemies: '',
  worldExtra: '',

  pastExperience: '',
  currentStage: '',
  futureDestiny: '',

  userPast: '',
  userNow: '',
  userFuture: '',

  voice: '',
  catchphrase: '',
  sentenceLen: 'balanced',
  completeness: 'balanced',
  tone: 'balanced',
  enthusiasm: 'balanced',
  dialogExtra: '',

  outOfWorld: 'yes',
  outOfWorldNote: '可以回答，但会以角色口吻解释，不直接暴露元信息。',

  audienceGender: 'all',
  authorNote: '',
}

function SelectAxis(props: {
  label: string
  value: PersonalityAxisValue
  onChange: (v: PersonalityAxisValue) => void
  left: string
  right: string
}) {
  return (
    <label className="uiLabel">
      {props.label}
      <select
        className="uiInput"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value === 'left' ? 'left' : e.target.value === 'right' ? 'right' : 'mid')}
      >
        <option value="left">偏{props.left}</option>
        <option value="mid">均衡</option>
        <option value="right">偏{props.right}</option>
      </select>
    </label>
  )
}

export default function NewCharacterPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [creating, setCreating] = useState(false)
  const [f, setF] = useState<FormState>(DEFAULT_FORM)

  const canCreate = useMemo(() => {
    return !loading && !!userId && f.name.trim().length > 0 && f.systemPrompt.trim().length > 0 && !creating
  }, [loading, userId, f.name, f.systemPrompt, creating])

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
      setEmail(userData.user.email ?? '')
      setUserId(userData.user.id)
      setLoading(false)
    }
    load()
  }, [router])

  const generatePromptFromForm = () => {
    setF((p) => ({ ...p, systemPrompt: buildSystemPromptFromForm(p) }))
    setAlert({ type: 'ok', text: '已生成 System Prompt。' })
  }

  const createCharacter = async () => {
    if (!canCreate) return
    setCreating(true)
    setAlert(null)

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
        nickname: clampText(f.nickname, 60),
        gender: f.gender,
        age: clampText(f.age, 20),
        birthday: clampText(f.birthday, 32),
        organization: clampText(f.organization, 120),
        occupation: clampText(f.occupation, 120),
      },
      settings: {
        romance_mode: f.romanceOn ? 'ROMANCE_ON' : 'ROMANCE_OFF',
        teen_mode: !!f.teenMode,
        age_mode: f.teenMode ? 'teen' : 'adult',
        creation_form: {
          appearance: f.appearance,
          likes: clampText(f.likes, 900),
          dislikes: clampText(f.dislikes, 900),
          strengths: clampText(f.strengths, 900),
          weaknesses: clampText(f.weaknesses, 900),
          habits: clampText(f.habits, 900),
          personality: f.personality,
          values: { moral: f.moral, order: f.order, extra: clampText(f.valuesExtra, 900) },
          romance: {
            romance_on: !!f.romanceOn,
            love_growth: f.loveGrowth,
            jealousy: f.jealousy,
            private_space: f.privateSpace,
            intimacy_accept: f.intimacyAccept,
            sweet_talk: f.sweetTalk,
            love_expression: f.loveExpression,
            extra: clampText(f.loveExtra, 900),
          },
          world: {
            background: clampText(f.worldBackground, 2000),
            family: clampText(f.family, 900),
            friends: clampText(f.friends, 900),
            colleagues: clampText(f.colleagues, 900),
            enemies: clampText(f.enemies, 900),
            extra: clampText(f.worldExtra, 1200),
          },
          destiny: {
            past: clampText(f.pastExperience, 2000),
            current: clampText(f.currentStage, 900),
            future: clampText(f.futureDestiny, 900),
          },
          user_relation: {
            past: clampText(f.userPast, 2000),
            now: clampText(f.userNow, 900),
            future: clampText(f.userFuture, 900),
          },
          dialog: {
            voice: clampText(f.voice, 160),
            catchphrase: clampText(f.catchphrase, 160),
            sentence_len: f.sentenceLen,
            completeness: f.completeness,
            tone: f.tone,
            enthusiasm: f.enthusiasm,
            extra: clampText(f.dialogExtra, 900),
          },
          constraints: {
            out_of_world: f.outOfWorld,
            note: clampText(f.outOfWorldNote, 400),
          },
          publish: {
            audience_gender: f.audienceGender,
            author_note: clampText(f.authorNote, 800),
          },
        },
      },
    }

    let insertedId = ''

    const r1 = await supabase.from('characters').insert(payloadV2).select('id').single()
    if (!r1.error && r1.data?.id) insertedId = String(r1.data.id)
    else {
      const msg = r1.error?.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `创建失败：${msg || 'unknown error'}` })
        setCreating(false)
        return
      }

      const payloadLegacy: { user_id: string; name: string; system_prompt: string } = {
        user_id: userId,
        name: f.name.trim(),
        system_prompt: f.systemPrompt.trim(),
      }

      const r2 = await supabase.from('characters').insert(payloadLegacy).select('id').single()
      if (r2.error || !r2.data?.id) {
        setAlert({ type: 'err', text: `创建失败：${r2.error?.message || 'unknown error'}` })
        setCreating(false)
        return
      }
      insertedId = String(r2.data.id)
    }

    if (!insertedId) {
      setAlert({ type: 'err', text: '创建失败：未返回角色 ID。' })
      setCreating(false)
      return
    }

    setCreating(false)
    setAlert({ type: 'ok', text: '创建成功，正在跳转到「我的角色」。' })
    setTimeout(() => router.replace('/characters'), 900)
  }

  return (
    <div className="uiPage">
      <header className="uiTopbar">
        <div className="uiTopbarInner">
          <div>
            <div className="uiTitleRow">
              <h1 className="uiTitle">创建角色</h1>
              <span className="uiBadge">v1</span>
            </div>
            <p className="uiSubtitle">{email}</p>
          </div>
          <div className="uiActions">
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
              广场
            </button>
            <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
              我的角色
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
                <div className="uiPanelTitle">填写信息</div>
                <div className="uiPanelSub">表单维度参考「吧唧捏崽表单」，可以先填关键项，再补细节。</div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="uiBtn uiBtnSecondary" type="button" onClick={generatePromptFromForm}>
                  从表单生成 System Prompt
                </button>
              </div>
            </div>

            <div className="uiForm">
              <label className="uiLabel">
                角色名称
                <input className="uiInput" value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
              </label>

              <label className="uiLabel">
                System Prompt（最终会进入对话）
                <textarea className="uiTextarea" value={f.systemPrompt} onChange={(e) => setF((p) => ({ ...p, systemPrompt: e.target.value }))} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  可见性
                  <select className="uiInput" value={f.visibility} onChange={(e) => setF((p) => ({ ...p, visibility: e.target.value === 'public' ? 'public' : 'private' }))}>
                    <option value="public">公开（出现在广场）</option>
                    <option value="private">私密（仅自己可见）</option>
                  </select>
                </label>

                <label className="uiLabel">
                  性别
                  <select
                    className="uiInput"
                    value={f.gender}
                    onChange={(e) =>
                      setF((p) => ({ ...p, gender: e.target.value === 'male' ? 'male' : e.target.value === 'female' ? 'female' : 'other' }))
                    }
                  >
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                    <option value="other">其他</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  昵称/称呼（可选）
                  <input className="uiInput" value={f.nickname} onChange={(e) => setF((p) => ({ ...p, nickname: e.target.value }))} placeholder="例如：爪哥" />
                </label>
                <label className="uiLabel">
                  年龄
                  <input className="uiInput" value={f.age} onChange={(e) => setF((p) => ({ ...p, age: e.target.value }))} placeholder="例如：23" />
                </label>
                <label className="uiLabel">
                  生日（可选）
                  <input className="uiInput" value={f.birthday} onChange={(e) => setF((p) => ({ ...p, birthday: e.target.value }))} placeholder="例如：02-14" />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  外观
                  <select className="uiInput" value={f.appearance} onChange={(e) => setF((p) => ({ ...p, appearance: e.target.value === 'nonhuman' ? 'nonhuman' : 'human' }))}>
                    <option value="human">人形角色</option>
                    <option value="nonhuman">非人形角色</option>
                  </select>
                </label>
                <label className="uiLabel">
                  职业
                  <input className="uiInput" value={f.occupation} onChange={(e) => setF((p) => ({ ...p, occupation: e.target.value }))} />
                </label>
              </div>

              <label className="uiLabel">
                所属组织（可选）
                <input className="uiInput" value={f.organization} onChange={(e) => setF((p) => ({ ...p, organization: e.target.value }))} />
              </label>

              <div className="uiDivider" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  喜欢的事
                  <textarea className="uiTextarea" value={f.likes} onChange={(e) => setF((p) => ({ ...p, likes: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  不喜欢的事
                  <textarea className="uiTextarea" value={f.dislikes} onChange={(e) => setF((p) => ({ ...p, dislikes: e.target.value }))} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  擅长的技能
                  <textarea className="uiTextarea" value={f.strengths} onChange={(e) => setF((p) => ({ ...p, strengths: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  不擅长的技能
                  <textarea className="uiTextarea" value={f.weaknesses} onChange={(e) => setF((p) => ({ ...p, weaknesses: e.target.value }))} />
                </label>
              </div>

              <label className="uiLabel">
                特殊习惯
                <textarea className="uiTextarea" value={f.habits} onChange={(e) => setF((p) => ({ ...p, habits: e.target.value }))} />
              </label>

              <div className="uiDivider" />

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">性格（7 轴）</div>
                    <div className="uiPanelSub">先选大方向，后续可以继续细化。</div>
                  </div>
                </div>
                <div className="uiForm">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <SelectAxis label="性格1（温和-暴躁）" value={f.personality.axis1} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis1: v } }))} left="温和" right="暴躁" />
                    <SelectAxis label="性格2（内向-外向）" value={f.personality.axis2} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis2: v } }))} left="内向" right="外向" />
                    <SelectAxis label="性格3（理性-感性）" value={f.personality.axis3} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis3: v } }))} left="理性" right="感性" />
                    <SelectAxis label="性格4（独立-依赖）" value={f.personality.axis4} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis4: v } }))} left="独立" right="依赖" />
                    <SelectAxis label="性格5（担当-逃避）" value={f.personality.axis5} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis5: v } }))} left="担当" right="逃避" />
                    <SelectAxis label="性格6（自我-讨好）" value={f.personality.axis6} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis6: v } }))} left="自我" right="讨好" />
                    <SelectAxis label="性格7（坚强-脆弱）" value={f.personality.axis7} onChange={(v) => setF((p) => ({ ...p, personality: { ...p.personality, axis7: v } }))} left="坚强" right="脆弱" />
                  </div>
                </div>
              </div>

              <div className="uiDivider" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  道德程度
                  <select
                    className="uiInput"
                    value={f.moral}
                    onChange={(e) => setF((p) => ({ ...p, moral: e.target.value as FormState['moral'] }))}
                  >
                    <option value="good">善良</option>
                    <option value="neutral">中立</option>
                    <option value="evil">邪恶</option>
                  </select>
                </label>
                <label className="uiLabel">
                  秩序程度
                  <select
                    className="uiInput"
                    value={f.order}
                    onChange={(e) => setF((p) => ({ ...p, order: e.target.value as FormState['order'] }))}
                  >
                    <option value="lawful">守序</option>
                    <option value="neutral">中立</option>
                    <option value="chaotic">混乱</option>
                  </select>
                </label>
              </div>

              <label className="uiLabel">
                价值观补充
                <textarea className="uiTextarea" value={f.valuesExtra} onChange={(e) => setF((p) => ({ ...p, valuesExtra: e.target.value }))} />
              </label>

              <div className="uiDivider" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  恋爱开关
                  <select className="uiInput" value={f.romanceOn ? 'on' : 'off'} onChange={(e) => setF((p) => ({ ...p, romanceOn: e.target.value === 'on' }))}>
                    <option value="on">ROMANCE_ON</option>
                    <option value="off">ROMANCE_OFF</option>
                  </select>
                </label>
                <label className="uiLabel">
                  青少年模式
                  <select className="uiInput" value={f.teenMode ? 'on' : 'off'} onChange={(e) => setF((p) => ({ ...p, teenMode: e.target.value === 'on' }))}>
                    <option value="off">关闭</option>
                    <option value="on">开启</option>
                  </select>
                </label>
              </div>

              <div className="uiDivider" />

              <label className="uiLabel">
                世界观背景设定
                <textarea className="uiTextarea" value={f.worldBackground} onChange={(e) => setF((p) => ({ ...p, worldBackground: e.target.value }))} />
              </label>

              <div className="uiDivider" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  音色
                  <input className="uiInput" value={f.voice} onChange={(e) => setF((p) => ({ ...p, voice: e.target.value }))} />
                </label>
                <label className="uiLabel">
                  口癖 / 口头禅
                  <input className="uiInput" value={f.catchphrase} onChange={(e) => setF((p) => ({ ...p, catchphrase: e.target.value }))} />
                </label>
              </div>

              <div className="uiDivider" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  能否回答超出角色时空的问题
                  <select className="uiInput" value={f.outOfWorld} onChange={(e) => setF((p) => ({ ...p, outOfWorld: e.target.value === 'no' ? 'no' : 'yes' }))}>
                    <option value="yes">可以</option>
                    <option value="no">不可以</option>
                  </select>
                </label>
                <label className="uiLabel">
                  说明（可选）
                  <input className="uiInput" value={f.outOfWorldNote} onChange={(e) => setF((p) => ({ ...p, outOfWorldNote: e.target.value }))} />
                </label>
              </div>
            </div>

            <div className="uiPanelFooter">
              <button className="uiBtn uiBtnPrimary" disabled={!canCreate} onClick={createCharacter}>
                {creating ? '创建中...' : '创建角色'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
