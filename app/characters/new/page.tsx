'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type Alert = { type: 'ok' | 'err'; text: string } | null

function clampText(s: string, max: number) {
  const t = (s || '').trim()
  return t.length > max ? t.slice(0, max) : t
}

function buildSystemPromptFromForm(args: {
  name: string
  profile: { nickname: string; gender: string; age: string; occupation: string; organization: string }
  settings: { romance_mode: 'ROMANCE_ON' | 'ROMANCE_OFF'; teen_mode: boolean }
  form: {
    appearance: 'human' | 'nonhuman'
    likes: string
    dislikes: string
    strengths: string
    weaknesses: string
    habits: string
    voice: string
    catchphrase: string
    outOfWorld: string
  }
}) {
  const { name, profile, settings, form } = args

  const header = [
    `你将扮演角色：${name || '（未命名）'}`,
    profile.nickname ? `昵称/称呼：${profile.nickname}` : '',
    profile.gender ? `性别：${profile.gender}` : '',
    profile.age ? `年龄：${profile.age}` : '',
    profile.occupation ? `职业：${profile.occupation}` : '',
    profile.organization ? `所属组织：${profile.organization}` : '',
    `外观类型：${form.appearance === 'nonhuman' ? '非人形' : '人形'}`,
  ]
    .filter(Boolean)
    .join('\n')

  const hardRules = [
    '你必须保持人设一致、行为与情绪连贯',
    '不要自称AI/助手/模型',
    '旁白规则：用户括号内是导演旁白，不要当作台词回应',
    settings.teen_mode
      ? '青少年模式：禁止露骨内容。禁止恋爱与性暗示。语言保持健康克制'
      : '成人模式：允许亲密氛围但禁止露骨性细节、强迫、羞辱、未成年人相关内容',
    settings.romance_mode === 'ROMANCE_OFF'
      ? '恋爱开关：ROMANCE_OFF。禁止表白/官宣/情侣承诺/情侣称呼体系。可发展为知己/搭档/守护/家人感'
      : '恋爱开关：ROMANCE_ON。允许恋爱语义递进，但尊重自愿与边界，用户不接受要能降温收束',
  ].join('\n')

  const parts = [
    '【角色设定】',
    header,
    '',
    '【喜好与习惯】',
    form.likes ? `喜欢：${form.likes}` : '',
    form.dislikes ? `讨厌：${form.dislikes}` : '',
    form.habits ? `习惯：${form.habits}` : '',
    form.strengths ? `擅长：${form.strengths}` : '',
    form.weaknesses ? `短板：${form.weaknesses}` : '',
    '',
    '【对话风格】',
    form.voice ? `音色：${form.voice}` : '',
    form.catchphrase ? `口癖：${form.catchphrase}` : '',
    '',
    '【人设约束】',
    form.outOfWorld ? `超出角色时空的问题：${form.outOfWorld}` : '',
    '',
    '【硬性规则】',
    hardRules,
  ].filter(Boolean)

  return parts.join('\n').trim()
}

export default function NewCharacterPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [email, setEmail] = useState('')
  const [userId, setUserId] = useState('')

  const [creating, setCreating] = useState(false)

  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')

  const [nickname, setNickname] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('other')
  const [age, setAge] = useState('')
  const [occupation, setOccupation] = useState('')
  const [organization, setOrganization] = useState('')

  const [romanceOn, setRomanceOn] = useState(true)
  const [teenMode, setTeenMode] = useState(false)

  // Lightweight “捏崽表单” (kept small on web for now).
  const [appearance, setAppearance] = useState<'human' | 'nonhuman'>('human')
  const [likes, setLikes] = useState('')
  const [dislikes, setDislikes] = useState('')
  const [strengths, setStrengths] = useState('')
  const [weaknesses, setWeaknesses] = useState('')
  const [habits, setHabits] = useState('')
  const [voiceHint, setVoiceHint] = useState('')
  const [catchphrase, setCatchphrase] = useState('')
  const [outOfWorld, setOutOfWorld] = useState('可以回答，但会以角色口吻解释，不直接暴露元信息')

  const canCreate = useMemo(() => {
    return !loading && !!userId && name.trim().length > 0 && prompt.trim().length > 0 && !creating
  }, [loading, userId, name, prompt, creating])

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
    const gen = buildSystemPromptFromForm({
      name: name.trim(),
      profile: {
        nickname: nickname.trim(),
        gender,
        age: age.trim(),
        occupation: occupation.trim(),
        organization: organization.trim(),
      },
      settings: {
        romance_mode: romanceOn ? 'ROMANCE_ON' : 'ROMANCE_OFF',
        teen_mode: teenMode,
      },
      form: {
        appearance,
        likes: likes.trim(),
        dislikes: dislikes.trim(),
        strengths: strengths.trim(),
        weaknesses: weaknesses.trim(),
        habits: habits.trim(),
        voice: voiceHint.trim(),
        catchphrase: catchphrase.trim(),
        outOfWorld: outOfWorld.trim(),
      },
    })
    setPrompt(gen)
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
      name: name.trim(),
      system_prompt: prompt.trim(),
      visibility,
      profile: {
        nickname: clampText(nickname, 60),
        gender,
        age: clampText(age, 20),
        occupation: clampText(occupation, 80),
        organization: clampText(organization, 80),
      },
      settings: {
        romance_mode: romanceOn ? 'ROMANCE_ON' : 'ROMANCE_OFF',
        teen_mode: teenMode,
        creation_form: {
          appearance,
          likes: clampText(likes, 500),
          dislikes: clampText(dislikes, 500),
          strengths: clampText(strengths, 500),
          weaknesses: clampText(weaknesses, 500),
          habits: clampText(habits, 500),
          dialog: { voice: clampText(voiceHint, 120), catchphrase: clampText(catchphrase, 120) },
          constraints: { out_of_world: clampText(outOfWorld, 260) },
        },
      },
    }

    let insertedId = ''
    {
      const { data, error } = await supabase.from('characters').insert(payloadV2).select('id').single()
      if (!error && data?.id) insertedId = data.id
      else {
        const msg = error?.message || ''
        const looksLikeLegacy =
          msg.includes('column') && (msg.includes('profile') || msg.includes('settings') || msg.includes('visibility'))
        if (!looksLikeLegacy) {
          setAlert({ type: 'err', text: `创建失败：${msg || 'unknown error'}` })
          setCreating(false)
          return
        }

        const payloadLegacy: { user_id: string; name: string; system_prompt: string } = {
          user_id: userId,
          name: name.trim(),
          system_prompt: prompt.trim(),
        }
        const r2 = await supabase.from('characters').insert(payloadLegacy).select('id').single()
        if (r2.error || !r2.data?.id) {
          setAlert({ type: 'err', text: `创建失败：${r2.error?.message || 'unknown error'}` })
          setCreating(false)
          return
        }
        insertedId = r2.data.id
      }
    }

    if (!insertedId) {
      setAlert({ type: 'err', text: '创建失败：未返回角色ID。' })
      setCreating(false)
      return
    }

    setCreating(false)
    setAlert({ type: 'ok', text: '创建成功，正在跳转到「我的角色」…' })
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
                <div className="uiPanelSub">创建成功后提示并跳转到「我的角色」。</div>
              </div>
            </div>

            <div className="uiForm">
              <label className="uiLabel">
                角色名称
                <input className="uiInput" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：孟雅 / 白厄 / 你的原创角色" />
              </label>

              <label className="uiLabel">
                System Prompt
                <textarea className="uiTextarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="尽量写清楚人设、边界、口癖、关系定位、输出风格。" />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  可见性
                  <select className="uiInput" value={visibility} onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'private')}>
                    <option value="private">私密（仅自己可见）</option>
                    <option value="public">公开（可出现在广场）</option>
                  </select>
                </label>
                <label className="uiLabel">
                  性别
                  <select className="uiInput" value={gender} onChange={(e) => setGender(e.target.value === 'male' ? 'male' : e.target.value === 'female' ? 'female' : 'other')}>
                    <option value="male">男性</option>
                    <option value="female">女性</option>
                    <option value="other">其他</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  年龄
                  <input className="uiInput" value={age} onChange={(e) => setAge(e.target.value)} placeholder="例如：23" />
                </label>
                <label className="uiLabel">
                  职业
                  <input className="uiInput" value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="例如：集团总裁专职秘书" />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  昵称/称呼（可选）
                  <input className="uiInput" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="例如：爪哥" />
                </label>
                <label className="uiLabel">
                  所属组织（可选）
                  <input className="uiInput" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="例如：第九科 / 学院 / 事务所" />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <label className="uiLabel">
                  恋爱开关
                  <select className="uiInput" value={romanceOn ? 'on' : 'off'} onChange={(e) => setRomanceOn(e.target.value === 'on')}>
                    <option value="on">ROMANCE_ON</option>
                    <option value="off">ROMANCE_OFF</option>
                  </select>
                </label>
                <label className="uiLabel">
                  青少年模式
                  <select className="uiInput" value={teenMode ? 'on' : 'off'} onChange={(e) => setTeenMode(e.target.value === 'on')}>
                    <option value="off">关闭</option>
                    <option value="on">开启</option>
                  </select>
                </label>
              </div>

              <div className="uiPanel" style={{ marginTop: 6 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">快速生成 Prompt（简化版）</div>
                    <div className="uiPanelSub">填一些关键字段，然后点“生成 System Prompt”。你也可以直接手写 Prompt。</div>
                  </div>
                  <button className="uiBtn uiBtnSecondary" type="button" onClick={generatePromptFromForm}>
                    生成 System Prompt
                  </button>
                </div>

                <div className="uiForm">
                  <label className="uiLabel">
                    外观类型
                    <select className="uiInput" value={appearance} onChange={(e) => setAppearance(e.target.value === 'nonhuman' ? 'nonhuman' : 'human')}>
                      <option value="human">人形</option>
                      <option value="nonhuman">非人形</option>
                    </select>
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <label className="uiLabel">
                      喜欢
                      <textarea className="uiTextarea" value={likes} onChange={(e) => setLikes(e.target.value)} />
                    </label>
                    <label className="uiLabel">
                      讨厌
                      <textarea className="uiTextarea" value={dislikes} onChange={(e) => setDislikes(e.target.value)} />
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <label className="uiLabel">
                      擅长
                      <textarea className="uiTextarea" value={strengths} onChange={(e) => setStrengths(e.target.value)} />
                    </label>
                    <label className="uiLabel">
                      短板
                      <textarea className="uiTextarea" value={weaknesses} onChange={(e) => setWeaknesses(e.target.value)} />
                    </label>
                  </div>

                  <label className="uiLabel">
                    习惯
                    <textarea className="uiTextarea" value={habits} onChange={(e) => setHabits(e.target.value)} />
                  </label>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <label className="uiLabel">
                      音色提示
                      <input className="uiInput" value={voiceHint} onChange={(e) => setVoiceHint(e.target.value)} placeholder="例如：清冷、低沉、御姐" />
                    </label>
                    <label className="uiLabel">
                      口癖
                      <input className="uiInput" value={catchphrase} onChange={(e) => setCatchphrase(e.target.value)} placeholder="例如：啧、别闹" />
                    </label>
                  </div>

                  <label className="uiLabel">
                    超出角色时空的问题（约束）
                    <input className="uiInput" value={outOfWorld} onChange={(e) => setOutOfWorld(e.target.value)} />
                  </label>
                </div>
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
