export type VisualAssetRef = {
  path: string
  kind?: string
}

export type VisualPreset = {
  id: string
  label: string
  mood: 'calm' | 'happy' | 'sad' | 'angry' | 'shy' | 'surprised'
  pose: 'closeup' | 'full' | 'action' | 'sitting' | 'standing'
  bgPath: string
  rolePath: string
  outfit: string
  scale: number
  y: number
}

type CueLike = { emotion?: string; sceneTags?: string[] }

function lower(v: string) {
  return String(v || '').toLowerCase()
}

function includesAny(hay: string, keys: string[]) {
  for (const k of keys) {
    if (hay.includes(k)) return true
  }
  return false
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr))
}

function normalizeOutfitName(raw: string) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function scorePathByKeywords(path: string, keys: string[]) {
  const p = lower(path)
  let score = 0
  for (const k of keys) {
    if (p.includes(k)) score += 1
  }
  return score
}

function pickBestAssetByKeywords(list: VisualAssetRef[], keys: string[]) {
  let best: VisualAssetRef | null = null
  let bestScore = 0
  for (const x of list) {
    const score = scorePathByKeywords(x.path, keys)
    if (score > bestScore) {
      best = x
      bestScore = score
    }
  }
  if (best) return best
  return list[0] || null
}

function pickBestOutfit(outfits: string[], keys: string[]) {
  const names = uniq(outfits.map(normalizeOutfitName).filter(Boolean))
  if (!names.length) return ''
  let best = ''
  let bestScore = 0
  for (const n of names) {
    const score = scorePathByKeywords(n, keys)
    if (score > bestScore) {
      best = n
      bestScore = score
    }
  }
  if (best) return best
  return names[0] || ''
}

export function pickBestRolePathForCue(roleAssets: VisualAssetRef[], cue: CueLike) {
  const list = roleAssets.filter((x) => !!String(x.path || '').trim())
  if (!list.length) return { path: '', score: 0 }
  const emotion = lower(String(cue.emotion || 'calm'))
  const sceneTags = Array.isArray(cue.sceneTags) ? cue.sceneTags.map((x) => lower(String(x))).filter(Boolean) : []

  const emotionKeys: Record<string, string[]> = {
    calm: ['calm', 'neutral', 'normal', 'default', '平静', '普通'],
    happy: ['happy', 'smile', 'laugh', 'joy', '开心', '高兴', '笑'],
    sad: ['sad', 'cry', 'tears', 'blue', '难过', '伤心'],
    angry: ['angry', 'rage', 'mad', 'frown', '生气', '愤怒'],
    shy: ['shy', 'blush', 'embarrass', '害羞', '脸红'],
    surprised: ['surprise', 'shock', 'astonish', '惊讶', '吃惊'],
  }
  const sceneKeys: Record<string, string[]> = {
    night: ['night', 'moon', 'neon', '夜', '月'],
    day: ['day', 'sun', 'morning', '晨', '白天'],
    indoor: ['room', 'home', 'indoor', '室内', '房间'],
    outdoor: ['street', 'park', 'beach', 'outdoor', '户外'],
    social: ['cafe', 'bar', 'party', '餐厅', '聚会'],
    training: ['gym', 'fight', 'training', '训练', '格斗'],
    rain: ['rain', 'storm', '雨'],
    snow: ['snow', '雪'],
  }

  let best = ''
  let bestScore = -1
  for (const a of list) {
    const p = lower(a.path)
    let score = 0
    if (includesAny(p, ['full', 'body', 'role', 'character', 'avatar', 'portrait', 'head'])) score += 1
    if (includesAny(p, emotionKeys[emotion] || [])) score += 6
    for (const tag of sceneTags) {
      if (includesAny(p, sceneKeys[tag] || [])) score += 2
    }
    if (score > bestScore) {
      best = a.path
      bestScore = score
    }
  }
  return { path: best, score: Math.max(0, bestScore) }
}

export function buildVisualPresets(args: {
  backgrounds: VisualAssetRef[]
  roleAssets: VisualAssetRef[]
  wardrobeItems?: string[]
}) {
  const backgrounds = (args.backgrounds || []).filter((x) => !!String(x.path || '').trim())
  const roleAssets = (args.roleAssets || []).filter((x) => !!String(x.path || '').trim())
  const outfits = (args.wardrobeItems || []).map(normalizeOutfitName).filter(Boolean)

  if (!backgrounds.length && !roleAssets.length) return [] as VisualPreset[]

  const presetDefs: Array<{
    id: string
    label: string
    mood: VisualPreset['mood']
    pose: VisualPreset['pose']
    bgKeys: string[]
    roleKeys: string[]
    outfitKeys: string[]
    scale: number
    y: number
  }> = [
    {
      id: 'daily-casual',
      label: 'Daily Casual',
      mood: 'calm',
      pose: 'standing',
      bgKeys: ['day', 'sun', 'street', 'city', 'cafe', 'outdoor'],
      roleKeys: ['calm', 'neutral', 'full', 'body', 'standing'],
      outfitKeys: ['casual', 'daily', '日常', '休闲'],
      scale: 104,
      y: 0,
    },
    {
      id: 'cozy-indoor',
      label: 'Cozy Indoor',
      mood: 'shy',
      pose: 'sitting',
      bgKeys: ['room', 'home', 'indoor', 'sofa', 'bed'],
      roleKeys: ['shy', 'blush', 'sit', 'sitting', 'soft', 'head'],
      outfitKeys: ['home', 'sleep', 'nightwear', '家居', '睡衣'],
      scale: 112,
      y: 8,
    },
    {
      id: 'night-date',
      label: 'Night Date',
      mood: 'happy',
      pose: 'closeup',
      bgKeys: ['night', 'moon', 'neon', 'bar', 'restaurant'],
      roleKeys: ['happy', 'smile', 'close', 'portrait', 'head'],
      outfitKeys: ['dress', 'formal', 'party', '晚', '礼服'],
      scale: 122,
      y: 10,
    },
    {
      id: 'action-mode',
      label: 'Action Mode',
      mood: 'angry',
      pose: 'action',
      bgKeys: ['street', 'rain', 'training', 'gym', 'rooftop', 'night'],
      roleKeys: ['action', 'fight', 'angry', 'dynamic', 'full', 'body'],
      outfitKeys: ['sport', 'uniform', 'battle', '运动', '战斗'],
      scale: 106,
      y: 2,
    },
    {
      id: 'soft-closeup',
      label: 'Soft Closeup',
      mood: 'sad',
      pose: 'closeup',
      bgKeys: ['room', 'window', 'rain', 'indoor'],
      roleKeys: ['sad', 'cry', 'close', 'head', 'portrait'],
      outfitKeys: ['coat', 'sweater', 'school', '外套', '学院'],
      scale: 126,
      y: 12,
    },
  ]

  const out: VisualPreset[] = []
  for (const def of presetDefs) {
    const bg = pickBestAssetByKeywords(backgrounds, def.bgKeys)
    const role = pickBestAssetByKeywords(roleAssets, def.roleKeys)
    if (!bg && !role) continue
    out.push({
      id: def.id,
      label: def.label,
      mood: def.mood,
      pose: def.pose,
      bgPath: bg?.path || '',
      rolePath: role?.path || '',
      outfit: pickBestOutfit(outfits, def.outfitKeys),
      scale: def.scale,
      y: def.y,
    })
  }

  return out
}

