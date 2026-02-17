'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ensureLatestConversationForCharacter } from '@/lib/conversationClient'
import { unlockSquareCharacter } from '@/lib/squareUnlock'
import { fetchWalletSummary } from '@/lib/wallet'
import {
  createSquareComment,
  deleteSquareComment,
  fetchSquareComments,
  fetchSquareReactions,
  saveSquareReaction,
  type SquareComment,
  type SquareReaction,
} from '@/lib/squareSocial'
import AppShell from '@/app/_components/AppShell'

type PubCharacter = {
  id: string
  name: string
  system_prompt: string
  profile?: Record<string, unknown>
  settings?: Record<string, unknown>
  visibility?: string | null
  created_at?: string
}

type CharacterAssetRow = { character_id?: string; kind: string; storage_path: string; created_at?: string | null }
type SquareMetric = {
  unlocked: number
  active: number
  likes: number
  saves: number
  reactions: number
  comments: number
  revenue: number
  sales: number
  hot: number
}
type AudienceTab = 'ALL' | 'MALE' | 'FEMALE' | 'TEEN'

type Alert = { type: 'ok' | 'err'; text: string } | null
const SQUARE_DETAIL_LIVE_POLL_MS = 60 * 1000

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isActivatedBySettings(settings: unknown) {
  const s = asRecord(settings)
  return s.activated !== false && s.home_hidden !== true
}

function getAudienceTab(c: PubCharacter): AudienceTab {
  const p = asRecord(c.profile)
  const s = asRecord(c.settings)
  if (s.age_mode === 'teen' || s.teen_mode === true) return 'TEEN'
  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const hints = [s.target_gender, s.audience_gender, publish.target_gender, p.target_gender, p.audience_gender]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
  if (!hints) return 'ALL'
  if (hints.includes('female') || hints.includes('girl') || hints.includes('女生') || hints.includes('女') || hints.includes('f')) return 'FEMALE'
  if (hints.includes('male') || hints.includes('boy') || hints.includes('男生') || hints.includes('男') || hints.includes('m')) return 'MALE'
  return 'ALL'
}

function audienceLabel(audienceTab: AudienceTab) {
  if (audienceTab === 'MALE') return '男频'
  if (audienceTab === 'FEMALE') return '女频'
  if (audienceTab === 'TEEN') return '青少年'
  return '全部'
}

function pickAssetPath(rows: CharacterAssetRow[]) {
  const byKind: Record<string, CharacterAssetRow[]> = {}
  for (const r of rows) {
    if (!r.kind || !r.storage_path) continue
    if (!byKind[r.kind]) byKind[r.kind] = []
    byKind[r.kind].push(r)
  }
  const prefer = ['cover', 'full_body', 'head']
  for (const k of prefer) {
    const list = byKind[k]
    if (list?.length) return list[0].storage_path
  }
  return ''
}

function unlockPrice(settings: unknown) {
  const s = asRecord(settings)
  const raw = Number(s.unlock_price_coins)
  if (Number.isFinite(raw) && raw > 0) return Math.max(0, Math.min(Math.floor(raw), 200000))
  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const nested = Number(publish.unlock_price_coins)
  if (Number.isFinite(nested) && nested > 0) return Math.max(0, Math.min(Math.floor(nested), 200000))
  return 0
}

function unlockCreatorShareBp(settings: unknown) {
  const s = asRecord(settings)
  const own = Number(s.unlock_creator_share_bp)
  if (Number.isFinite(own)) return Math.max(0, Math.min(Math.floor(own), 10000))
  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const nested = Number(publish.unlock_creator_share_bp)
  if (Number.isFinite(nested)) return Math.max(0, Math.min(Math.floor(nested), 10000))
  return 7000
}

export default function SquareDetailPage() {
  const router = useRouter()
  const params = useParams<{ characterId: string }>()
  const id = params.characterId

  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [item, setItem] = useState<PubCharacter | null>(null)
  const [unlockedCharId, setUnlockedCharId] = useState<string>('') // user's local character id
  const [unlockedActive, setUnlockedActive] = useState<boolean>(false)
  const [imgUrl, setImgUrl] = useState('')
  const [assetUrls, setAssetUrls] = useState<Array<{ kind: string; url: string; path: string }>>([])
  const [relatedItems, setRelatedItems] = useState<PubCharacter[]>([])
  const [relatedImgById, setRelatedImgById] = useState<Record<string, string>>({})
  const [squareMetricsBySourceId, setSquareMetricsBySourceId] = useState<Record<string, SquareMetric>>({})
  const [myUnlockedBySourceId, setMyUnlockedBySourceId] = useState<Record<string, { localId: string; active: boolean }>>({})
  const [busy, setBusy] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletSpent, setWalletSpent] = useState(0)
  const [walletUnlocked, setWalletUnlocked] = useState(0)
  const [squareReactionTableReady, setSquareReactionTableReady] = useState(true)
  const [squareCommentTableReady, setSquareCommentTableReady] = useState(true)
  const [mySquareReaction, setMySquareReaction] = useState<SquareReaction>({})
  const [squareComments, setSquareComments] = useState<SquareComment[]>([])
  const [reactionBusy, setReactionBusy] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [commentDeletingId, setCommentDeletingId] = useState('')
  const [detailLiveRefresh, setDetailLiveRefresh] = useState(true)
  const [detailLiveSyncAt, setDetailLiveSyncAt] = useState('')
  const currentSquareMetrics = useMemo(() => (item ? squareMetricsBySourceId[item.id] : undefined), [item, squareMetricsBySourceId])
  const insufficientCoins = useMemo(() => {
    if (!item || !!unlockedCharId || !isLoggedIn || !walletReady) return false
    const price = unlockPrice(item.settings)
    if (price <= 0) return false
    return walletBalance < price
  }, [item, unlockedCharId, isLoggedIn, walletReady, walletBalance])

  const canUnlock = useMemo(() => {
    if (!item || busy || !!unlockedCharId || !isLoggedIn) return false
    if (!walletReady) return true
    return !insufficientCoins
  }, [item, busy, unlockedCharId, isLoggedIn, walletReady, insufficientCoins])
  const detailMeta = useMemo(() => {
    if (!item) {
      return {
        summary: '',
        teen: false,
        audience: 'ALL' as AudienceTab,
        romanceLabel: '',
        authorNote: '',
        unlockPrice: 0,
        creatorShareBp: 7000,
      }
    }
    const p = asRecord(item.profile)
    const s = asRecord(item.settings)
    const age = typeof p.age === 'string' ? p.age.trim() : ''
    const occupation = typeof p.occupation === 'string' ? p.occupation.trim() : ''
    const org = typeof p.organization === 'string' ? p.organization.trim() : ''
    const teen = !!s.teen_mode || s.age_mode === 'teen'
    const romance = typeof s.romance_mode === 'string' ? s.romance_mode : ''
    const romanceLabel = teen ? '恋爱关闭' : romance === 'ROMANCE_OFF' ? '恋爱关闭' : romance === 'ROMANCE_ON' || !romance ? '恋爱开启' : romance
    const authorNote = (() => {
      const cf = asRecord(s.creation_form)
      const pub = asRecord(cf.publish)
      return typeof pub.author_note === 'string' ? pub.author_note.trim() : ''
    })()
    return {
      summary: [age ? `${age}岁` : '', occupation, org].filter(Boolean).join(' · '),
      teen,
      audience: getAudienceTab(item),
      romanceLabel,
      authorNote,
      unlockPrice: unlockPrice(item.settings),
      creatorShareBp: unlockCreatorShareBp(item.settings),
    }
  }, [item])

  const refreshDetailSignals = useCallback(async () => {
    if (!item) return
    const metricIds = [item.id, ...relatedItems.map((x) => x.id)].filter(Boolean).slice(0, 80)
    if (metricIds.length) {
      try {
        const resp = await fetch(`/api/square/metrics?ids=${encodeURIComponent(metricIds.join(','))}`)
        if (resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
          const m = asRecord(data.metrics)
          const nextMetrics: Record<string, SquareMetric> = {}
          for (const sourceId of metricIds) {
            const row = asRecord(m[sourceId])
            nextMetrics[sourceId] = {
              unlocked: Number(row.unlocked || 0),
              active: Number(row.active || 0),
              likes: Number(row.likes || 0),
              saves: Number(row.saves || 0),
              reactions: Number(row.reactions || 0),
              comments: Number(row.comments || 0),
              revenue: Number(row.revenue || 0),
              sales: Number(row.sales || 0),
              hot: Number(row.hot || 0),
            }
          }
          setSquareMetricsBySourceId(nextMetrics)
        }
      } catch {
        // ignore
      }
    }

    let token = ''
    if (isLoggedIn) {
      try {
        const { data: sess } = await supabase.auth.getSession()
        token = sess.session?.access_token || ''
      } catch {
        // ignore
      }
    }

    try {
      const reactionOut = token
        ? await fetchSquareReactions({ token, sourceCharacterIds: [item.id] })
        : { tableReady: true, reactions: {} as Record<string, SquareReaction> }
      setSquareReactionTableReady(reactionOut.tableReady)
      setMySquareReaction(reactionOut.reactions[item.id] || {})
    } catch {
      // ignore
    }

    try {
      const commentsOut = await fetchSquareComments({
        sourceCharacterId: item.id,
        limit: 24,
        token: token || undefined,
      })
      setSquareCommentTableReady(commentsOut.tableReady)
      setSquareComments(commentsOut.comments)
    } catch {
      // ignore
    }

    setDetailLiveSyncAt(new Date().toISOString())
  }, [item, relatedItems, isLoggedIn])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setAlert(null)
      setItem(null)
      setUnlockedCharId('')
      setImgUrl('')
      setAssetUrls([])
      setRelatedItems([])
      setRelatedImgById({})
      setSquareMetricsBySourceId({})
      setMyUnlockedBySourceId({})
      setWalletReady(false)
      setWalletBalance(0)
      setWalletSpent(0)
      setWalletUnlocked(0)
      setSquareReactionTableReady(true)
      setSquareCommentTableReady(true)
      setMySquareReaction({})
      setSquareComments([])
      setReactionBusy(false)
      setCommentDraft('')
      setCommentSaving(false)
      setCommentDeletingId('')

      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      setIsLoggedIn(!!userId)
      let sessionToken = ''

      if (userId) {
        try {
          const { data: sess } = await supabase.auth.getSession()
          const token = sess.session?.access_token || ''
          sessionToken = token
          if (token) {
            const wallet = await fetchWalletSummary(token)
            setWalletReady(wallet.walletReady)
            setWalletBalance(wallet.balance)
            setWalletSpent(wallet.totalSpent)
            setWalletUnlocked(wallet.totalUnlocked)
          }
        } catch {
          // ignore wallet loading errors
        }
      }

      const r = await supabase
        .from('characters')
        .select('id,name,system_prompt,profile,settings,visibility,created_at')
        .eq('id', id)
        .maybeSingle()

      if (r.error || !r.data) {
        setAlert({ type: 'err', text: r.error?.message || '角色不存在。' })
        setLoading(false)
        return
      }

      const c = r.data as PubCharacter
      if (c.visibility !== 'public') {
        setAlert({ type: 'err', text: '该角色不是公开角色，无法在广场查看。' })
        setLoading(false)
        return
      }

      setItem(c)
      const metricIds = new Set<string>([id])

      try {
        const reactionOut = sessionToken
          ? await fetchSquareReactions({ token: sessionToken, sourceCharacterIds: [id] })
          : { tableReady: true, reactions: {} as Record<string, SquareReaction> }
        setSquareReactionTableReady(reactionOut.tableReady)
        setMySquareReaction(reactionOut.reactions[id] || {})
      } catch {
        // ignore
      }
      try {
        const commentsOut = await fetchSquareComments({
          sourceCharacterId: id,
          limit: 24,
          token: sessionToken || undefined,
        })
        setSquareCommentTableReady(commentsOut.tableReady)
        setSquareComments(commentsOut.comments)
      } catch {
        // ignore
      }

      // Already unlocked?
      if (userId) {
        try {
          const me = await supabase
            .from('characters')
            .select('id,settings,created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(400)
          if (!me.error) {
            const rows = (me.data ?? []) as Array<{ id: string; settings?: unknown }>
            const unlockedMap: Record<string, { localId: string; active: boolean }> = {}
            for (const row of rows) {
              const s = asRecord(row.settings)
              const src = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
              if (!src) continue
              unlockedMap[src] = { localId: row.id, active: isActivatedBySettings(row.settings) }
            }
            setMyUnlockedBySourceId(unlockedMap)
            const found = rows.find((x) => {
              const s = asRecord(x.settings)
              return typeof s.source_character_id === 'string' && s.source_character_id === id
            })
            if (found?.id) {
              setUnlockedCharId(found.id)
              setUnlockedActive(isActivatedBySettings(found.settings))
            }
          }
        } catch {
          // ignore
        }
      }

      // Media
      try {
        const assets = await supabase
          .from('character_assets')
          .select('kind,storage_path,created_at')
          .eq('character_id', id)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(20)

        if (!assets.error && (assets.data ?? []).length) {
          const rows = (assets.data ?? []) as CharacterAssetRow[]
          const uniquePaths = new Set<string>()
          const picks = rows
            .filter((r) => !!r.storage_path)
            .filter((r) => {
              if (uniquePaths.has(r.storage_path)) return false
              uniquePaths.add(r.storage_path)
              return true
            })
            .slice(0, 10)

          const signed = await Promise.all(
            picks.map(async (r) => {
              const s = await supabase.storage.from('character-assets').createSignedUrl(r.storage_path, 60 * 60)
              return { kind: r.kind, path: r.storage_path, url: s.data?.signedUrl || '' }
            }),
          )
          const filtered = signed.filter((x) => !!x.url)
          setAssetUrls(filtered)
          const coverPath = pickAssetPath(rows)
          const coverPick = filtered.find((x) => x.path === coverPath) || filtered[0]
          if (coverPick?.url) setImgUrl(coverPick.url)
        }
      } catch {
        // ignore
      }

      // Related public roles: prioritize same audience channel, then fill by recency.
      try {
        const rel = await supabase
          .from('characters')
          .select('id,name,system_prompt,profile,settings,visibility,created_at')
          .eq('visibility', 'public')
          .neq('id', id)
          .order('created_at', { ascending: false })
          .limit(36)

        if (!rel.error) {
          const all = (rel.data ?? []) as PubCharacter[]
          const channel = getAudienceTab(c)
          const sameChannel = all.filter((x) => getAudienceTab(x) === channel)
          const others = all.filter((x) => getAudienceTab(x) !== channel)
          const picks = [...sameChannel, ...others].slice(0, 6)
          setRelatedItems(picks)

          const relIds = picks.map((x) => x.id).filter(Boolean)
          for (const relId of relIds) metricIds.add(relId)
          if (relIds.length) {
            const relAssets = await supabase
              .from('character_assets')
              .select('character_id,kind,storage_path,created_at')
              .in('character_id', relIds)
              .in('kind', ['cover', 'full_body', 'head'])
              .order('created_at', { ascending: false })
              .limit(240)

            if (!relAssets.error) {
              const grouped: Record<string, CharacterAssetRow[]> = {}
              for (const row of (relAssets.data ?? []) as CharacterAssetRow[]) {
                const charId = String(row.character_id || '').trim()
                if (!charId) continue
                if (!grouped[charId]) grouped[charId] = []
                grouped[charId].push({ kind: row.kind, storage_path: row.storage_path, created_at: row.created_at })
              }

              const entries = Object.entries(grouped)
                .map(([characterId, rows]) => [characterId, pickAssetPath(rows)] as const)
                .filter(([, path]) => !!path)

              if (entries.length) {
                const signed = await Promise.all(
                  entries.map(async ([characterId, path]) => {
                    const s = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
                    return [characterId, s.data?.signedUrl || ''] as const
                  }),
                )

                const map: Record<string, string> = {}
                for (const [characterId, url] of signed) {
                  if (!url) continue
                  map[characterId] = url
                }
                setRelatedImgById(map)
              }
            }
          }
        }
      } catch {
        // ignore
      }

      // Best-effort: global popularity hints for current + related roles.
      try {
        const ids = Array.from(metricIds).filter(Boolean).slice(0, 80)
        if (ids.length) {
          const resp = await fetch(`/api/square/metrics?ids=${encodeURIComponent(ids.join(','))}`)
          if (resp.ok) {
            const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
            const m = asRecord(data.metrics)
            const nextMetrics: Record<string, SquareMetric> = {}
            for (const sourceId of ids) {
              const row = asRecord(m[sourceId])
              nextMetrics[sourceId] = {
                unlocked: Number(row.unlocked || 0),
                active: Number(row.active || 0),
                likes: Number(row.likes || 0),
                saves: Number(row.saves || 0),
                reactions: Number(row.reactions || 0),
                comments: Number(row.comments || 0),
                revenue: Number(row.revenue || 0),
                sales: Number(row.sales || 0),
                hot: Number(row.hot || 0),
              }
            }
            setSquareMetricsBySourceId(nextMetrics)
          }
        }
      } catch {
        // ignore
      }

      setLoading(false)
    }

    load()
  }, [id, router])

  useEffect(() => {
    if (loading || !item || !detailLiveRefresh) return
    let canceled = false
    const run = async () => {
      if (canceled) return
      await refreshDetailSignals()
    }
    const timer = setInterval(() => {
      void run()
    }, SQUARE_DETAIL_LIVE_POLL_MS)
    void run()
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [loading, item, detailLiveRefresh, refreshDetailSignals])

  const unlock = async (options?: { startChat?: boolean }) => {
    if (!item || busy) return
    setBusy(true)
    setAlert(null)

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) {
      setBusy(false)
      router.push('/login')
      return
    }
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        setBusy(false)
        return
      }

      const result = await unlockSquareCharacter(token, item.id)
      if (!result.ok) {
        if (result.error === 'INSUFFICIENT_COINS') {
          const need = Number(result.priceCoins || unlockPrice(item.settings))
          const have = Number(result.balance ?? walletBalance)
          setAlert({ type: 'err', text: `余额不足：需要 ${need} 币，当前 ${have} 币。` })
          setBusy(false)
          return
        }
        if (result.error === 'SOURCE_NOT_PUBLIC') {
          setAlert({ type: 'err', text: '该角色不再公开，无法解锁。' })
          setBusy(false)
          return
        }
        setAlert({ type: 'err', text: `解锁失败：${result.error || 'unknown error'}` })
        setBusy(false)
        return
      }

      const localId = String(result.localCharacterId || '').trim()
      if (!localId) {
        setAlert({ type: 'err', text: '解锁成功但未返回角色 ID，请刷新后重试。' })
        setBusy(false)
        return
      }

      setUnlockedCharId(localId)
      setUnlockedActive(true)
      setMyUnlockedBySourceId((prev) => ({ ...prev, [item.id]: { localId, active: true } }))
      if (result.balanceAfter != null) setWalletBalance(Math.max(0, Number(result.balanceAfter || 0)))
      if (!result.alreadyUnlocked) setWalletUnlocked((prev) => prev + 1)
      if (result.chargedCoins > 0) setWalletSpent((prev) => prev + result.chargedCoins)
      if (result.walletReady) setWalletReady(true)

      try {
        await ensureLatestConversationForCharacter({
          userId,
          characterId: localId,
          title: item.name || '对话',
        })
      } catch {
        // Best-effort only.
      }

      const chargedText = result.chargedCoins > 0 ? `（消耗 ${result.chargedCoins} 币）` : ''
      const creatorText = result.creatorGain > 0 ? ` 创作者分成 ${result.creatorGain} 币。` : ''
      setAlert({
        type: 'ok',
        text: options?.startChat
          ? `${result.alreadyUnlocked ? '已在队列中，正在进入聊天。' : '已解锁，正在进入聊天。'}${chargedText}${creatorText}`
          : `${result.alreadyUnlocked ? '角色已在你的队列中。' : '已解锁。'}${chargedText}${creatorText}`,
      })
      if (options?.startChat) router.push(`/chat/${localId}`)
      setBusy(false)
      return
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? `解锁失败：${e.message}` : String(e) })
      setBusy(false)
      return
    }
  }

  const toggleActivation = async (nextActive: boolean) => {
    if (!unlockedCharId || busy) return
    setBusy(true)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.push('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .select('settings')
        .eq('id', unlockedCharId)
        .eq('user_id', userId)
        .maybeSingle()
      if (r.error) throw new Error(r.error.message)
      const s = asRecord(r.data?.settings)
      const nextSettings = {
        ...s,
        activated: nextActive,
        home_hidden: nextActive ? false : s.home_hidden,
        activated_at: nextActive ? new Date().toISOString() : s.activated_at,
        activated_order: nextActive ? Date.now() : s.activated_order,
      }
      const upd = await supabase
        .from('characters')
        .update({ settings: nextSettings })
        .eq('id', unlockedCharId)
        .eq('user_id', userId)
      if (upd.error) throw new Error(upd.error.message)
      setUnlockedActive(nextActive)
      setMyUnlockedBySourceId((prev) => (item ? { ...prev, [item.id]: { localId: unlockedCharId, active: nextActive } } : prev))
      setAlert({ type: 'ok', text: nextActive ? '已激活到首页队列。' : '已取消激活。' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  const toggleSquareReaction = async (key: 'liked' | 'saved') => {
    if (!item?.id || reactionBusy) return
    if (!isLoggedIn) {
      router.push('/login')
      return
    }
    setReactionBusy(true)
    const prev = mySquareReaction || {}
    const nextLiked = key === 'liked' ? !prev.liked : !!prev.liked
    const nextSaved = key === 'saved' ? !prev.saved : !!prev.saved
    const nextReaction = nextLiked || nextSaved ? { liked: nextLiked, saved: nextSaved } : {}
    setMySquareReaction(nextReaction)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        throw new Error('未登录')
      }
      const out = await saveSquareReaction({
        token,
        sourceCharacterId: item.id,
        liked: nextLiked,
        saved: nextSaved,
      })
      if (!out.tableReady) setSquareReactionTableReady(false)
      setSquareMetricsBySourceId((prevMap) => {
        const m = prevMap[item.id]
        if (!m) return prevMap
        const oldLiked = prev.liked === true ? 1 : 0
        const oldSaved = prev.saved === true ? 1 : 0
        const newLiked = nextLiked ? 1 : 0
        const newSaved = nextSaved ? 1 : 0
        const next = {
          ...m,
          likes: Math.max(0, m.likes - oldLiked + newLiked),
          saves: Math.max(0, m.saves - oldSaved + newSaved),
        }
        next.reactions = next.likes + next.saves * 2
        next.hot = next.unlocked * 2 + next.active * 3 + next.likes + next.saves * 2 + next.comments * 2 + next.sales * 2 + Math.floor(next.revenue / 50)
        return { ...prevMap, [item.id]: next }
      })
    } catch (e: unknown) {
      setMySquareReaction(prev)
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== '未登录') setAlert({ type: 'err', text: `互动失败：${msg}` })
    } finally {
      setReactionBusy(false)
    }
  }

  const submitSquareComment = async () => {
    if (!item?.id || !isLoggedIn || commentSaving) return
    const content = String(commentDraft || '').trim()
    if (!content) return
    setCommentSaving(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        return
      }
      const out = await createSquareComment({
        token,
        sourceCharacterId: item.id,
        content,
      })
      if (!out.tableReady) setSquareCommentTableReady(false)
      if (out.comment) {
        setSquareComments((prev) => [out.comment!, ...prev.filter((x) => x.id !== out.comment!.id)].slice(0, 40))
        setCommentDraft('')
        setSquareMetricsBySourceId((prevMap) => {
          const m = prevMap[item.id]
          if (!m) return prevMap
          const next = { ...m, comments: m.comments + 1 }
          next.hot = next.unlocked * 2 + next.active * 3 + next.likes + next.saves * 2 + next.comments * 2 + next.sales * 2 + Math.floor(next.revenue / 50)
          return { ...prevMap, [item.id]: next }
        })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlert({ type: 'err', text: `评论失败：${msg}` })
    } finally {
      setCommentSaving(false)
    }
  }

  const removeSquareComment = async (commentId: string) => {
    if (!commentId || commentDeletingId) return
    setCommentDeletingId(commentId)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        return
      }
      const out = await deleteSquareComment({ token, commentId })
      if (!out.tableReady) setSquareCommentTableReady(false)
      const removed = squareComments.some((c) => c.id === commentId)
      setSquareComments((prev) => prev.filter((c) => c.id !== commentId))
      if (removed && item?.id) {
        setSquareMetricsBySourceId((prevMap) => {
          const m = prevMap[item.id]
          if (!m) return prevMap
          const next = { ...m, comments: Math.max(0, m.comments - 1) }
          next.hot = next.unlocked * 2 + next.active * 3 + next.likes + next.saves * 2 + next.comments * 2 + next.sales * 2 + Math.floor(next.revenue / 50)
          return { ...prevMap, [item.id]: next }
        })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAlert({ type: 'err', text: `删除评论失败：${msg}` })
    } finally {
      setCommentDeletingId('')
    }
  }

  return (
    <div className="uiPage">
      <AppShell
        title="角色详情"
        badge="square"
        subtitle="查看公开角色，并解锁/激活到你的首页队列。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/square')}>
            返回广场
          </button>
        }
      >
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}
        {!loading && !isLoggedIn && <div className="uiAlert uiAlertOk">当前为游客浏览模式。登录后可解锁该角色并发起对话。</div>}

        {!loading && item && (
          <div style={{ display: 'grid', gap: 14 }}>
            <section className="uiHero">
              <div>
                <span className="uiBadge">公开角色详情</span>
                <h2 className="uiHeroTitle">{item.name}</h2>
                <p className="uiHeroSub">先浏览设定和视觉资产，再决定是否解锁到你的角色队列。若为付费角色，会在解锁时消耗星币。</p>
              </div>
              <div className="uiKpiGrid">
                <div className="uiKpi">
                  <b>{isLoggedIn ? (unlockedCharId ? '是' : '否') : '-'}</b>
                  <span>已解锁</span>
                </div>
                <div className="uiKpi">
                  <b>{isLoggedIn ? (unlockedCharId ? (unlockedActive ? '是' : '否') : '-') : '-'}</b>
                  <span>已激活到首页</span>
                </div>
                <div className="uiKpi">
                  <b>{assetUrls.length}</b>
                  <span>可预览资产</span>
                </div>
                <div className="uiKpi">
                  <b>{detailMeta.teen ? '未成年' : '成人'}</b>
                  <span>年龄模式</span>
                </div>
                <div className="uiKpi">
                  <b>{audienceLabel(detailMeta.audience)}</b>
                  <span>频道</span>
                </div>
                <div className="uiKpi">
                  <b>{detailMeta.romanceLabel || '默认开启'}</b>
                  <span>恋爱模式</span>
                </div>
                <div className="uiKpi">
                  <b>{detailMeta.unlockPrice > 0 ? `${detailMeta.unlockPrice} 币` : '免费'}</b>
                  <span>解锁价格</span>
                </div>
                <div className="uiKpi">
                  <b>{detailMeta.unlockPrice > 0 ? `${Math.floor(detailMeta.creatorShareBp / 100)}%` : '-'}</b>
                  <span>创作者分成</span>
                </div>
                <div className="uiKpi">
                  <b>{Number(currentSquareMetrics?.unlocked || 0)}</b>
                  <span>全站解锁</span>
                </div>
                <div className="uiKpi">
                  <b>{Number(currentSquareMetrics?.active || 0)}</b>
                  <span>全站激活</span>
                </div>
                <div className="uiKpi">
                  <b>{Number(currentSquareMetrics?.hot || 0)}</b>
                  <span>全站热度</span>
                </div>
                <div className="uiKpi">
                  <b>{Number(currentSquareMetrics?.comments || 0)}</b>
                  <span>全站评论</span>
                </div>
                <div className="uiKpi">
                  <b>{Number(currentSquareMetrics?.revenue || 0)}</b>
                  <span>解锁营收(币)</span>
                </div>
                <div className="uiKpi">
                  <b>{isLoggedIn ? walletBalance : '-'}</b>
                  <span>我的星币</span>
                </div>
              </div>
            </section>

            <div className="uiSquareDetailWorkspace">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">{item.name}</div>
                    <div className="uiPanelSub">公开角色{item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString()}` : ''}</div>
                  </div>
                </div>

                <div className="uiForm">
                  <div className="uiSplit">
                    <div className="uiCard" style={{ margin: 0 }}>
                      <div className="uiCardMedia" style={{ height: 260 }}>
                        {imgUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgUrl} alt="" />
                        ) : (
                          <div className="uiCardMediaFallback">暂无图片</div>
                        )}
                      </div>
                      <div className="uiCardTitle">角色主视觉</div>
                      <div className="uiCardMeta">cover / full_body / head</div>
                    </div>
                    <div className="uiThumbGrid">
                      {assetUrls.slice(0, 8).map((a, idx) => (
                        <button key={`${a.kind}:${idx}`} className="uiCard" style={{ margin: 0, padding: 10, cursor: 'pointer' }} onClick={() => setImgUrl(a.url)}>
                          <div className="uiCardMedia" style={{ height: 84 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.url} alt="" />
                          </div>
                          <div className="uiCardMeta" style={{ marginTop: 8 }}>
                            {a.kind}
                          </div>
                        </button>
                      ))}
                      {assetUrls.length === 0 && <div className="uiHint">暂无可预览资产</div>}
                    </div>
                  </div>

                  {detailMeta.summary && <div className="uiHint">{detailMeta.summary}</div>}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
                    <span className="uiBadge">{detailMeta.teen ? '未成年模式' : '成人模式'}</span>
                    <span className="uiBadge">{audienceLabel(detailMeta.audience)}</span>
                    <span className="uiBadge">{detailMeta.romanceLabel || '恋爱开启'}</span>
                    <span className="uiBadge">{detailMeta.unlockPrice > 0 ? `${detailMeta.unlockPrice} 币` : '免费解锁'}</span>
                    {detailMeta.unlockPrice > 0 ? <span className="uiBadge">创作者 {Math.floor(detailMeta.creatorShareBp / 100)}%</span> : null}
                    {unlockedCharId ? <span className="uiBadge">已解锁</span> : null}
                    {unlockedCharId && unlockedActive ? <span className="uiBadge">已激活</span> : null}
                    {!unlockedCharId && isLoggedIn && walletReady && detailMeta.unlockPrice > walletBalance ? <span className="uiBadge">余额不足</span> : null}
                    {currentSquareMetrics && (currentSquareMetrics.unlocked > 0 || currentSquareMetrics.active > 0) ? (
                      <span className="uiBadge">
                        解锁 {currentSquareMetrics.unlocked} · 激活 {currentSquareMetrics.active}
                      </span>
                    ) : null}
                    {currentSquareMetrics && currentSquareMetrics.hot > 0 ? <span className="uiBadge">热度 {currentSquareMetrics.hot}</span> : null}
                    {currentSquareMetrics && currentSquareMetrics.comments > 0 ? <span className="uiBadge">评论 {currentSquareMetrics.comments}</span> : null}
                    {currentSquareMetrics && currentSquareMetrics.revenue > 0 ? <span className="uiBadge">营收 {currentSquareMetrics.revenue} 币</span> : null}
                  </div>

                  {detailMeta.authorNote && (
                    <div className="uiPanel" style={{ marginTop: 12 }}>
                      <div className="uiPanelHeader">
                        <div>
                          <div className="uiPanelTitle">创作者备注</div>
                          <div className="uiPanelSub">角色发布说明</div>
                        </div>
                      </div>
                      <div className="uiForm">
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{detailMeta.authorNote}</div>
                      </div>
                    </div>
                  )}

                  <div className="uiHint" style={{ marginTop: 12 }}>
                    角色设定提示词（仅展示前 600 字）
                  </div>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                      border: '1px solid rgba(255,255,255,.14)',
                      borderRadius: 14,
                      padding: 12,
                      background: 'rgba(19,19,19,.84)',
                      color: 'rgba(255,255,255,.92)',
                    }}
                  >
                    {(item.system_prompt || '').slice(0, 600)}
                    {(item.system_prompt || '').length > 600 ? '...' : ''}
                  </div>
                </div>
              </div>

              <aside className="uiSquareDetailAside">
                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">操作台</div>
                      <div className="uiPanelSub">解锁、激活、跳转聊天与动态中心（支持星币解锁）</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    {unlockedCharId ? (
                      <>
                        <button className="uiBtn uiBtnPrimary" onClick={() => router.push(`/chat/${unlockedCharId}`)}>
                          发起对话
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${unlockedCharId}`)}>
                          动态中心
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/${unlockedCharId}/assets`)}>
                          查看资产
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/new?from=${encodeURIComponent(item.id)}`)}>
                          衍生创建
                        </button>
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push('/wallet')}>
                          钱包中心
                        </button>
                        <button className="uiBtn uiBtnSecondary" disabled={busy} onClick={() => toggleActivation(!unlockedActive)}>
                          {busy ? '处理中...' : unlockedActive ? '取消激活' : '激活到首页'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="uiBtn uiBtnPrimary" disabled={!canUnlock || busy} onClick={() => void unlock({ startChat: true })}>
                          {busy
                            ? '解锁中...'
                            : !isLoggedIn
                              ? detailMeta.unlockPrice > 0
                                ? `登录后解锁（${detailMeta.unlockPrice}币）`
                                : '登录后解锁'
                              : insufficientCoins
                                ? `余额不足（${detailMeta.unlockPrice}币）`
                                : detailMeta.unlockPrice > 0
                                  ? `解锁并开聊（${detailMeta.unlockPrice}币）`
                                  : '解锁并开聊'}
                        </button>
                        {isLoggedIn ? (
                          <button className="uiBtn uiBtnGhost" disabled={!canUnlock || busy} onClick={() => void unlock()}>
                            {detailMeta.unlockPrice > 0 ? `仅解锁（${detailMeta.unlockPrice}币）` : '仅解锁'}
                          </button>
                        ) : null}
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/characters/new?from=${encodeURIComponent(item.id)}`)}>
                          衍生创建
                        </button>
                        {isLoggedIn ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/wallet')}>
                            钱包中心
                          </button>
                        ) : null}
                        {!isLoggedIn ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push('/login')}>
                            去登录
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">状态</div>
                      <div className="uiPanelSub">当前账号与角色状态摘要</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    <span className="uiBadge">{isLoggedIn ? '已登录' : '游客模式'}</span>
                    <span className="uiBadge">{unlockedCharId ? '已解锁' : '未解锁'}</span>
                    <span className="uiBadge">{unlockedCharId ? (unlockedActive ? '已激活' : '未激活') : '-'}</span>
                    <span className="uiBadge">价格 {detailMeta.unlockPrice > 0 ? `${detailMeta.unlockPrice} 币` : '免费'}</span>
                    <span className="uiBadge">全站解锁 {Number(currentSquareMetrics?.unlocked || 0)}</span>
                    <span className="uiBadge">全站激活 {Number(currentSquareMetrics?.active || 0)}</span>
                    <span className="uiBadge">全站热度 {Number(currentSquareMetrics?.hot || 0)}</span>
                    <span className="uiBadge">全站评论 {Number(currentSquareMetrics?.comments || 0)}</span>
                    <span className="uiBadge">解锁营收 {Number(currentSquareMetrics?.revenue || 0)} 币</span>
                    {isLoggedIn ? <span className="uiBadge">我的星币 {walletBalance}</span> : null}
                    {isLoggedIn ? <span className="uiBadge">累计消费 {walletSpent}</span> : null}
                    {isLoggedIn ? <span className="uiBadge">累计解锁 {walletUnlocked}</span> : null}
                    {isLoggedIn && !walletReady ? <span className="uiBadge">钱包未初始化（可继续免费解锁）</span> : null}
                  </div>
                </div>

                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">广场互动</div>
                      <div className="uiPanelSub">可直接点赞、收藏和评论，影响推荐与热度。</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    {!squareReactionTableReady ? <div className="uiHint">互动表未启用（请执行 `schema_square_social.sql`）。</div> : null}
                    {!squareCommentTableReady ? <div className="uiHint">评论表未启用（请执行 `schema_square_social.sql`）。</div> : null}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className={`uiBtn uiBtnGhost ${mySquareReaction.liked ? 'uiPillActive' : ''}`} disabled={reactionBusy} onClick={() => void toggleSquareReaction('liked')}>
                        {reactionBusy ? '处理中...' : mySquareReaction.liked ? '取消喜欢' : '喜欢'}
                      </button>
                      <button className={`uiBtn uiBtnGhost ${mySquareReaction.saved ? 'uiPillActive' : ''}`} disabled={reactionBusy} onClick={() => void toggleSquareReaction('saved')}>
                        {reactionBusy ? '处理中...' : mySquareReaction.saved ? '取消收藏' : '收藏'}
                      </button>
                      {!isLoggedIn ? (
                        <button className="uiBtn uiBtnGhost" onClick={() => router.push('/login')}>
                          登录后互动
                        </button>
                      ) : null}
                      <button className={`uiBtn uiBtnGhost ${detailLiveRefresh ? 'uiPillActive' : ''}`} onClick={() => setDetailLiveRefresh((v) => !v)}>
                        自动刷新 {detailLiveRefresh ? '开' : '关'}
                      </button>
                    </div>
                    {detailLiveRefresh ? <div className="uiHint">自动刷新中（60 秒）{detailLiveSyncAt ? ` · 最近同步 ${new Date(detailLiveSyncAt).toLocaleTimeString()}` : ''}</div> : null}
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="uiHint">最新评论</div>
                      {squareComments.length === 0 ? <div className="uiHint">还没有评论。</div> : null}
                      {squareComments.map((c) => (
                        <div key={c.id} className="uiRow" style={{ alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.content}</div>
                            <div className="uiHint" style={{ marginTop: 4 }}>
                              {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                              {c.mine ? ' · 我' : ''}
                            </div>
                          </div>
                          {c.mine ? (
                            <button className="uiBtn uiBtnGhost" disabled={commentDeletingId === c.id} onClick={() => void removeSquareComment(c.id)}>
                              {commentDeletingId === c.id ? '删除中...' : '删除'}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    {isLoggedIn ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <textarea
                          className="uiTextarea"
                          placeholder="写下你的看法（最多 300 字）"
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          maxLength={300}
                          rows={3}
                        />
                        <button className="uiBtn uiBtnPrimary" disabled={commentSaving} onClick={() => void submitSquareComment()}>
                          {commentSaving ? '发送中...' : '发表评论'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="uiPanel" style={{ marginTop: 0 }}>
                  <div className="uiPanelHeader">
                    <div>
                      <div className="uiPanelTitle">同频道推荐</div>
                      <div className="uiPanelSub">继续发现相似角色，支持直接跳转详情</div>
                    </div>
                  </div>
                  <div className="uiForm" style={{ paddingTop: 14 }}>
                    {relatedItems.length === 0 && <div className="uiHint">暂无推荐角色</div>}
                    {relatedItems.map((r) => {
                      const p = asRecord(r.profile)
                      const brief = [String(p.occupation || '').trim(), String(p.organization || '').trim()].filter(Boolean).join(' · ')
                      const unlocked = myUnlockedBySourceId[r.id]
                      const metrics = squareMetricsBySourceId[r.id]
                      const price = unlockPrice(r.settings)
                      return (
                        <div key={r.id} className="uiRow" style={{ alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: 12,
                                overflow: 'hidden',
                                border: '1px solid rgba(255,255,255,.14)',
                                background: 'rgba(19,19,19,.8)',
                                display: 'grid',
                                placeItems: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {relatedImgById[r.id] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={relatedImgById[r.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <span style={{ color: 'rgba(255,255,255,.8)', fontWeight: 600 }}>{r.name.slice(0, 1)}</span>
                              )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                              <div className="uiHint" style={{ marginTop: 2 }}>
                                {brief || audienceLabel(getAudienceTab(r))}
                                {price > 0 ? ` · ${price}币` : ' · 免费'}
                                {metrics ? ` · 解锁${Number(metrics.unlocked || 0)} 激活${Number(metrics.active || 0)}` : ''}
                                {metrics ? ` · 热度${Number(metrics.hot || 0)} 评论${Number(metrics.comments || 0)}` : ''}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {unlocked ? (
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${unlocked.localId}`)}>
                                对话
                              </button>
                            ) : (
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${r.id}`)}>
                                查看
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}

