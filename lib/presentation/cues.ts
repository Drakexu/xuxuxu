export type PresentationCue = {
  emotion: 'calm' | 'happy' | 'sad' | 'angry' | 'shy' | 'surprised'
  sceneTags: string[]
}

function lower(s: string) {
  return String(s || '').toLowerCase()
}

function includesAny(hay: string, needles: string[]) {
  for (const n of needles) {
    if (hay.includes(n)) return true
  }
  return false
}

function uniq(input: string[]) {
  return Array.from(new Set(input))
}

const zh = {
  happy: ['\u5f00\u5fc3', '\u9ad8\u5174', '\u6109\u5feb', '\u7b11', '\u7b11\u5f97'],
  sad: ['\u96be\u8fc7', '\u5931\u843d', '\u4f24\u5fc3', '\u60b2\u4f24'],
  angry: ['\u751f\u6c14', '\u6124\u6012', '\u607c\u706b', '\u706b\u5927'],
  shy: ['\u5bb3\u7f9e', '\u8138\u7ea2', '\u4e0d\u597d\u610f\u601d'],
  surprised: ['\u60ca\u8bb6', '\u9707\u60ca', '\u5403\u60ca', '\u610f\u5916'],
  night: ['\u591c', '\u6df1\u591c', '\u51cc\u6668', '\u6708'],
  rain: ['\u96e8', '\u4e0b\u96e8', '\u96e8\u591c'],
  snow: ['\u96ea', '\u4e0b\u96ea'],
  day: ['\u767d\u5929', '\u65e9\u6668', '\u6e05\u6668', '\u9633\u5149'],
  indoor: ['\u5ba4\u5185', '\u623f\u95f4', '\u5ba2\u5385', '\u5367\u5ba4'],
  outdoor: ['\u6237\u5916', '\u8857\u9053', '\u516c\u56ed', '\u6d77\u8fb9', '\u5e7f\u573a'],
  social: ['\u5496\u5561', '\u9910\u5385', '\u9152\u5427', '\u805a\u4f1a'],
  training: ['\u8bad\u7ec3', '\u5065\u8eab', '\u5bf9\u7ec3', '\u683c\u6597'],
}

export function inferPresentationCue(text: string): PresentationCue {
  const t = lower(text)

  let emotion: PresentationCue['emotion'] = 'calm'
  if (includesAny(t, [...zh.happy, 'happy', 'smile', 'joy'])) emotion = 'happy'
  else if (includesAny(t, [...zh.sad, 'sad', 'cry', 'depressed'])) emotion = 'sad'
  else if (includesAny(t, [...zh.angry, 'angry', 'mad', 'rage'])) emotion = 'angry'
  else if (includesAny(t, [...zh.shy, 'shy', 'blush', 'embarrassed'])) emotion = 'shy'
  else if (includesAny(t, [...zh.surprised, 'surprised', 'shock', 'astonished'])) emotion = 'surprised'

  const tags: string[] = []
  if (includesAny(t, [...zh.night, 'night', 'moon'])) tags.push('night')
  if (includesAny(t, [...zh.rain, 'rain', 'storm'])) tags.push('rain')
  if (includesAny(t, [...zh.snow, 'snow'])) tags.push('snow')
  if (includesAny(t, [...zh.day, 'day', 'sun', 'morning'])) tags.push('day')
  if (includesAny(t, [...zh.indoor, 'indoor', 'room', 'home'])) tags.push('indoor')
  if (includesAny(t, [...zh.outdoor, 'outdoor', 'street', 'park', 'beach'])) tags.push('outdoor')
  if (includesAny(t, [...zh.social, 'cafe', 'bar', 'restaurant', 'party'])) tags.push('social')
  if (includesAny(t, [...zh.training, 'gym', 'fight', 'training'])) tags.push('training')

  return { emotion, sceneTags: uniq(tags).slice(0, 4) }
}

export function scoreAssetPathForCue(path: string, cue: PresentationCue) {
  const p = lower(path)
  let score = 0

  const emotionWords: Record<PresentationCue['emotion'], string[]> = {
    calm: ['calm', 'neutral', '\u5e73\u9759'],
    happy: ['happy', 'smile', '\u5f00\u5fc3', '\u5fae\u7b11'],
    sad: ['sad', 'cry', '\u96be\u8fc7', '\u4f24\u5fc3'],
    angry: ['angry', 'rage', '\u751f\u6c14', '\u6124\u6012'],
    shy: ['shy', 'blush', '\u5bb3\u7f9e'],
    surprised: ['surprise', 'shock', '\u60ca\u8bb6'],
  }
  if (includesAny(p, emotionWords[cue.emotion])) score += 6

  for (const tag of cue.sceneTags) {
    if (tag === 'night' && includesAny(p, ['night', 'moon', '\u591c'])) score += 3
    if (tag === 'rain' && includesAny(p, ['rain', 'storm', '\u96e8'])) score += 3
    if (tag === 'snow' && includesAny(p, ['snow', '\u96ea'])) score += 3
    if (tag === 'day' && includesAny(p, ['day', 'sun', 'morning', '\u6668'])) score += 2
    if (tag === 'indoor' && includesAny(p, ['indoor', 'room', 'home', '\u5ba4\u5185'])) score += 2
    if (tag === 'outdoor' && includesAny(p, ['outdoor', 'street', 'park', 'beach', '\u6237\u5916'])) score += 2
    if (tag === 'social' && includesAny(p, ['cafe', 'bar', 'restaurant', 'party', '\u805a\u4f1a'])) score += 2
    if (tag === 'training' && includesAny(p, ['gym', 'fight', 'training', '\u8bad\u7ec3'])) score += 2
  }

  if (includesAny(p, ['cover', 'bg', 'background', 'scene', '\u573a\u666f'])) score += 1
  return score
}

export function pickBestBackgroundPath<T extends { path: string }>(assets: T[], cue: PresentationCue) {
  let best = ''
  let bestScore = 0
  for (const a of assets) {
    const score = scoreAssetPathForCue(a.path, cue)
    if (score > bestScore) {
      bestScore = score
      best = a.path
    }
  }
  return { path: best, score: bestScore }
}
