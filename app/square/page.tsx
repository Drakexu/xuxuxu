'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { ensureLatestConversationForCharacter } from '@/lib/conversationClient'
import { unlockSquareCharacter } from '@/lib/squareUnlock'
import { fetchWalletSummary } from '@/lib/wallet'
import { fetchSquareReactions, mergeSquareReactionMap, saveSquareReaction, type SquareReactionMap } from '@/lib/squareSocial'
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

type CharacterAssetRow = { character_id: string; kind: string; storage_path: string; created_at?: string | null }
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

type Alert = { type: 'ok' | 'err'; text: string } | null
type AudienceTab = 'ALL' | 'MALE' | 'FEMALE' | 'TEEN'
type SquareSort = 'RECOMMENDED' | 'POPULAR' | 'HOT' | 'REVENUE' | 'NEWEST' | 'UNLOCKED_FIRST' | 'ACTIVE_FIRST' | 'NAME'
type PriceFilter = 'ALL' | 'FREE' | 'PAID'
const SQUARE_LIVE_POLL_MS = 90 * 1000

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function isActivatedBySettings(settings: unknown) {
  const s = asRecord(settings)
  if (s.activated === false) return false
  if (s.home_hidden === true) return false
  return true
}

function getStr(r: Record<string, unknown>, k: string) {
  const v = r[k]
  return typeof v === 'string' ? v : ''
}

function getAudienceTab(c: PubCharacter): AudienceTab {
  const p = asRecord(c.profile)
  const s = asRecord(c.settings)
  if (s.age_mode === 'teen' || s.teen_mode === true) return 'TEEN'

  const cf = asRecord(s.creation_form)
  const publish = asRecord(cf.publish)
  const hints = [
    s.target_gender,
    s.audience_gender,
    publish.target_gender,
    p.target_gender,
    p.audience_gender,
  ]
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

function isMissingFeedReactionsTableError(msg: string) {
  const s = String(msg || '').toLowerCase()
  return s.includes('feed_reactions') && (s.includes('does not exist') || s.includes('relation') || s.includes('schema cache'))
}

function pickAssetPath(rows: CharacterAssetRow[]) {
  // Prefer cover > full_body > head.
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

function squareReactionScore(v: { liked?: boolean; saved?: boolean } | undefined) {
  if (!v) return 0
  return (v.saved ? 2 : 0) + (v.liked ? 1 : 0)
}

export default function SquarePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState('')
  const [unlockingId, setUnlockingId] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'LOCKED' | 'UNLOCKED' | 'ACTIVE'>('ALL')
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('ALL')
  const [audienceTab, setAudienceTab] = useState<AudienceTab>('ALL')
  const [sortBy, setSortBy] = useState<SquareSort>('RECOMMENDED')
  const [items, setItems] = useState<PubCharacter[]>([])
  const [imgById, setImgById] = useState<Record<string, string>>({})
  const [unlockedInfoBySourceId, setUnlockedInfoBySourceId] = useState<Record<string, { localId: string; active: boolean }>>({})
  const [squareMetricsBySourceId, setSquareMetricsBySourceId] = useState<Record<string, SquareMetric>>({})
  const [reactionScoreBySourceId, setReactionScoreBySourceId] = useState<Record<string, number>>({})
  const [audienceAffinity, setAudienceAffinity] = useState<Record<AudienceTab, number>>({ ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 })
  const [hasPreferenceSignal, setHasPreferenceSignal] = useState(false)
  const [alert, setAlert] = useState<Alert>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [walletSpent, setWalletSpent] = useState(0)
  const [walletUnlocked, setWalletUnlocked] = useState(0)
  const [squareReactions, setSquareReactions] = useState<SquareReactionMap>({})
  const [squareReactionTableReady, setSquareReactionTableReady] = useState(true)
  const [reactionBusyKey, setReactionBusyKey] = useState('')
  const [squareLiveRefresh, setSquareLiveRefresh] = useState(true)
  const [squareLiveSyncAt, setSquareLiveSyncAt] = useState('')

  const canRefresh = useMemo(() => !loading, [loading])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  useEffect(() => {
    setHasPreferenceSignal(Object.keys(reactionScoreBySourceId).length > 0)
  }, [reactionScoreBySourceId])

  const load = async () => {
    setLoading(true)
    setAlert(null)
    setImgById({})
    setUnlockedInfoBySourceId({})
    setSquareMetricsBySourceId({})
    setReactionScoreBySourceId({})
    setAudienceAffinity({ ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 })
    setHasPreferenceSignal(false)
    setWalletReady(false)
    setWalletBalance(0)
    setWalletSpent(0)
    setWalletUnlocked(0)
    setSquareReactions({})
    setSquareReactionTableReady(true)
    setReactionBusyKey('')

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    setIsLoggedIn(!!userId)

    if (userId) {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (token) {
          const wallet = await fetchWalletSummary(token)
          setWalletReady(wallet.walletReady)
          setWalletBalance(wallet.balance)
          setWalletSpent(wallet.totalSpent)
          setWalletUnlocked(wallet.totalUnlocked)
        }
      } catch {
        // ignore wallet loading failures
      }
    }

    const r1 = await supabase
      .from('characters')
      .select('id,name,system_prompt,profile,settings,visibility,created_at')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(60)

    if (r1.error) {
      const msg = r1.error.message || ''
      const looksLikeLegacy = msg.includes('column') && (msg.includes('visibility') || msg.includes('profile') || msg.includes('settings'))
      if (!looksLikeLegacy) {
        setAlert({ type: 'err', text: `加载失败：${msg}` })
        setItems([])
      } else {
        // Legacy schema has no "public" concept.
        setItems([])
      }
      setLoading(false)
      return
    }

    const nextItems = (r1.data ?? []) as PubCharacter[]
    setItems(nextItems)
    const itemById: Record<string, PubCharacter> = {}
    for (const it of nextItems) {
      if (it.id) itemById[it.id] = it
    }

    // Best-effort square metrics for popularity hints (global unlocked/active counts).
    try {
      const ids = nextItems.map((x) => x.id).filter(Boolean).slice(0, 80)
      if (ids.length) {
        const resp = await fetch(`/api/square/metrics?ids=${encodeURIComponent(ids.join(','))}`)
        if (resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>
          const m = asRecord(data.metrics)
          const nextMetrics: Record<string, SquareMetric> = {}
          for (const id of ids) {
            const row = asRecord(m[id])
            nextMetrics[id] = {
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

    // Best-effort: show "已解锁" badges by checking user's copied characters.
    if (userId) {
      try {
        const mine = await supabase
          .from('characters')
          .select('id,settings')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(600)
        if (!mine.error) {
          const map: Record<string, { localId: string; active: boolean }> = {}
          const localToSource: Record<string, string> = {}
          for (const row of (mine.data ?? []) as Array<{ id: string; settings?: unknown }>) {
            const s = asRecord(row.settings)
            const src = typeof s.source_character_id === 'string' ? s.source_character_id.trim() : ''
            if (!src) continue
            map[src] = { localId: row.id, active: isActivatedBySettings(row.settings) }
            localToSource[row.id] = src
          }
          setUnlockedInfoBySourceId(map)

          const sourceIds = nextItems.map((x) => x.id).filter(Boolean).slice(0, 120)
          const scoreBySourceId: Record<string, number> = {}
          let squareTableReady = true
          try {
            const { data: sess } = await supabase.auth.getSession()
            const token = sess.session?.access_token || ''
            if (token && sourceIds.length) {
              const out = await fetchSquareReactions({ token, sourceCharacterIds: sourceIds })
              squareTableReady = out.tableReady
              setSquareReactionTableReady(out.tableReady)
              setSquareReactions(out.reactions)
              for (const [sourceId, reaction] of Object.entries(out.reactions)) {
                const w = squareReactionScore(reaction)
                if (w > 0) scoreBySourceId[sourceId] = Number(scoreBySourceId[sourceId] || 0) + w
              }
            }
          } catch {
            // ignore; fallback below
          }

          if (!squareTableReady || Object.keys(scoreBySourceId).length === 0) {
            try {
              const rr = await supabase
                .from('feed_reactions')
                .select('character_id,liked,saved')
                .eq('user_id', userId)
                .order('updated_at', { ascending: false })
                .limit(1200)
              if (!rr.error) {
                for (const row of rr.data ?? []) {
                  const r = asRecord(row)
                  const localCharId = String(r.character_id || '').trim()
                  const sourceId = localToSource[localCharId] || ''
                  if (!sourceId) continue
                  const w = (r.saved === true ? 2 : 0) + (r.liked === true ? 1 : 0)
                  if (w <= 0) continue
                  scoreBySourceId[sourceId] = Number(scoreBySourceId[sourceId] || 0) + w
                }
              } else if (!isMissingFeedReactionsTableError(rr.error.message || '')) {
                throw new Error(rr.error.message)
              }
            } catch {
              // ignore
            }
          }

          const nextAffinity: Record<AudienceTab, number> = { ALL: 0, MALE: 0, FEMALE: 0, TEEN: 0 }
          for (const [sourceId, score] of Object.entries(scoreBySourceId)) {
            const it = itemById[sourceId]
            if (!it) continue
            const a = getAudienceTab(it)
            if (a !== 'ALL') nextAffinity[a] = Number(nextAffinity[a] || 0) + score
          }

          setReactionScoreBySourceId(scoreBySourceId)
          setAudienceAffinity(nextAffinity)
          setHasPreferenceSignal(Object.keys(scoreBySourceId).length > 0)
        }
      } catch {
        // ignore
      }
    }

    // Best-effort media: sign latest cover/full_body/head per character.
    try {
      const ids = nextItems.map((c) => c.id).filter(Boolean)
      if (ids.length) {
        const assets = await supabase
          .from('character_assets')
          .select('character_id,kind,storage_path,created_at')
          .in('character_id', ids)
          .in('kind', ['cover', 'full_body', 'head'])
          .order('created_at', { ascending: false })
          .limit(400)

        if (!assets.error) {
          const grouped: Record<string, CharacterAssetRow[]> = {}
          for (const row of (assets.data ?? []) as CharacterAssetRow[]) {
            if (!row.character_id) continue
            if (!grouped[row.character_id]) grouped[row.character_id] = []
            grouped[row.character_id].push(row)
          }

          const entries = Object.entries(grouped)
            .map(([characterId, rows]) => [characterId, pickAssetPath(rows)] as const)
            .filter(([, path]) => !!path)

          if (entries.length) {
            const signed = await Promise.all(
              entries.map(async ([characterId, path]) => {
                const r = await supabase.storage.from('character-assets').createSignedUrl(path, 60 * 60)
                return [characterId, r.data?.signedUrl || ''] as const
              }),
            )

            const map: Record<string, string> = {}
            for (const [characterId, url] of signed) {
              if (url) map[characterId] = url
            }
            setImgById(map)
          }
        }
      }
    } catch {
      // ignore: media is optional
    }

    setLoading(false)
  }

  const refreshSquareSignals = useCallback(async () => {
    if (loading || !items.length) return
    const ids = items.map((x) => x.id).filter(Boolean).slice(0, 80)
    if (!ids.length) return

    try {
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
    } catch {
      // ignore
    }

    if (isLoggedIn) {
      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token || ''
        if (token) {
          const out = await fetchSquareReactions({ token, sourceCharacterIds: ids })
          setSquareReactionTableReady(out.tableReady)
          setSquareReactions((prev) => mergeSquareReactionMap(prev, out.reactions))
          const scoreBySourceId: Record<string, number> = {}
          for (const [sourceId, reaction] of Object.entries(out.reactions)) {
            const w = squareReactionScore(reaction)
            if (w > 0) scoreBySourceId[sourceId] = w
          }
          if (Object.keys(scoreBySourceId).length) {
            setReactionScoreBySourceId((prev) => ({ ...prev, ...scoreBySourceId }))
          }
        }
      } catch {
        // ignore
      }
    }

    setSquareLiveSyncAt(new Date().toISOString())
  }, [loading, items, isLoggedIn])

  const toggleActivation = async (sourceCharacterId: string, nextActive: boolean) => {
    const info = unlockedInfoBySourceId[sourceCharacterId]
    if (!info?.localId || togglingId) return
    setTogglingId(info.localId)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.replace('/login')
        return
      }

      const r = await supabase
        .from('characters')
        .select('settings')
        .eq('id', info.localId)
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
        .eq('id', info.localId)
        .eq('user_id', userId)
      if (upd.error) throw new Error(upd.error.message)

      setUnlockedInfoBySourceId((prev) => ({
        ...prev,
        [sourceCharacterId]: {
          ...info,
          active: nextActive,
        },
      }))
      setAlert({ type: 'ok', text: nextActive ? '已激活到首页队列。' : '已取消激活。' })
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTogglingId('')
    }
  }

  const unlockCharacterFromCard = async (source: PubCharacter, options?: { startChat?: boolean }) => {
    if (!source?.id || unlockingId) return
    setUnlockingId(source.id)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) {
        router.push('/login')
        return
      }

      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        return
      }

      const unlock = await unlockSquareCharacter(token, source.id)
      if (!unlock.ok) {
        if (unlock.error === 'INSUFFICIENT_COINS') {
          const need = Number(unlock.priceCoins || unlockPrice(source.settings))
          const have = Number(unlock.balance ?? walletBalance)
          setAlert({ type: 'err', text: `余额不足：需要 ${need} 币，当前 ${have} 币。` })
          return
        }
        if (unlock.error === 'SOURCE_NOT_PUBLIC') {
          setAlert({ type: 'err', text: '该角色不再公开，无法解锁。' })
          return
        }
        setAlert({ type: 'err', text: `解锁失败：${unlock.error || 'unknown error'}` })
        return
      }

      const localId = String(unlock.localCharacterId || '').trim()
      if (!localId) {
        setAlert({ type: 'err', text: '解锁成功但未返回角色 ID，请刷新后重试。' })
        return
      }

      setUnlockedInfoBySourceId((prev) => ({ ...prev, [source.id]: { localId, active: true } }))
      if (unlock.balanceAfter != null) setWalletBalance(Math.max(0, Number(unlock.balanceAfter || 0)))
      if (!unlock.alreadyUnlocked) setWalletUnlocked((prev) => prev + 1)
      if (unlock.chargedCoins > 0) setWalletSpent((prev) => prev + unlock.chargedCoins)
      if (unlock.walletReady) setWalletReady(true)

      try {
        await ensureLatestConversationForCharacter({
          userId,
          characterId: localId,
          title: source.name || '对话',
        })
      } catch {
        // Best-effort: unlock should not fail if conversation bootstrap fails.
      }

      const chargedText = unlock.chargedCoins > 0 ? `（消耗 ${unlock.chargedCoins} 币）` : ''
      const creatorText = unlock.creatorGain > 0 ? ` 创作者分成 ${unlock.creatorGain} 币。` : ''
      setAlert({
        type: 'ok',
        text: options?.startChat
          ? `${unlock.alreadyUnlocked ? '已在队列中，正在跳转聊天。' : '已解锁并激活，正在跳转聊天。'}${chargedText}${creatorText}`
          : `${unlock.alreadyUnlocked ? '角色已在你的队列中。' : '已解锁并激活到首页队列。'}${chargedText}${creatorText}`,
      })
      if (options?.startChat) {
        router.push(`/chat/${localId}`)
      }
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? `解锁失败：${e.message}` : String(e) })
    } finally {
      setUnlockingId('')
    }
  }

  const toggleSquareReaction = async (sourceCharacterId: string, key: 'liked' | 'saved') => {
    const sourceId = String(sourceCharacterId || '').trim()
    if (!sourceId || reactionBusyKey) return
    if (!isLoggedIn) {
      router.push('/login')
      return
    }

    const prev = squareReactions[sourceId] || {}
    const nextLiked = key === 'liked' ? !prev.liked : !!prev.liked
    const nextSaved = key === 'saved' ? !prev.saved : !!prev.saved
    const nextWeight = (nextSaved ? 2 : 0) + (nextLiked ? 1 : 0)
    const prevWeight = squareReactionScore(prev)
    const busyKey = `${sourceId}:${key}`
    setReactionBusyKey(busyKey)

    setSquareReactions((old) => {
      const out = { ...old }
      if (!nextLiked && !nextSaved) delete out[sourceId]
      else out[sourceId] = { liked: nextLiked, saved: nextSaved }
      return out
    })
    setReactionScoreBySourceId((old) => {
      const out = { ...old }
      if (nextWeight <= 0) delete out[sourceId]
      else out[sourceId] = nextWeight
      return out
    })

    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.push('/login')
        throw new Error('未登录')
      }
      const out = await saveSquareReaction({
        token,
        sourceCharacterId: sourceId,
        liked: nextLiked,
        saved: nextSaved,
      })
      if (!out.tableReady) setSquareReactionTableReady(false)
    } catch (e: unknown) {
      // rollback optimistic state on failure.
      setSquareReactions((old) => {
        const out = { ...old }
        if (!prev.liked && !prev.saved) delete out[sourceId]
        else out[sourceId] = { liked: !!prev.liked, saved: !!prev.saved }
        return out
      })
      setReactionScoreBySourceId((old) => {
        const out = { ...old }
        if (prevWeight <= 0) delete out[sourceId]
        else out[sourceId] = prevWeight
        return out
      })
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== '未登录') setAlert({ type: 'err', text: `互动失败：${msg}` })
    } finally {
      setReactionBusyKey('')
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!squareLiveRefresh || loading || !items.length) return
    let canceled = false
    const run = async () => {
      if (canceled) return
      await refreshSquareSignals()
    }
    const timer = setInterval(() => {
      void run()
    }, SQUARE_LIVE_POLL_MS)
    void run()
    return () => {
      canceled = true
      clearInterval(timer)
    }
  }, [squareLiveRefresh, loading, items, refreshSquareSignals])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const arr = items.filter((c) => {
      const info = unlockedInfoBySourceId[c.id]
      const unlocked = !!info
      const active = !!info?.active
      const audience = getAudienceTab(c)
      const price = unlockPrice(c.settings)

      if (filter === 'LOCKED' && unlocked) return false
      if (filter === 'UNLOCKED' && !unlocked) return false
      if (filter === 'ACTIVE' && !active) return false
      if (audienceTab !== 'ALL' && audience !== audienceTab) return false
      if (priceFilter === 'FREE' && price > 0) return false
      if (priceFilter === 'PAID' && price <= 0) return false

      if (!q) return true
      const p = asRecord(c.profile)
      const hay = [
        c.name || '',
        getStr(p, 'occupation'),
        getStr(p, 'organization'),
        getStr(p, 'summary'),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    const score = (c: PubCharacter) => {
      const info = unlockedInfoBySourceId[c.id]
      const active = info?.active ? 1 : 0
      const unlocked = info ? 1 : 0
      const ts = c.created_at ? Date.parse(c.created_at) : 0
      const name = (c.name || '').toLowerCase()
      const reaction = Number(reactionScoreBySourceId[c.id] || 0)
      const audience = getAudienceTab(c)
      const affinity = audience === 'ALL' ? 0 : Number(audienceAffinity[audience] || 0)
      const metrics = squareMetricsBySourceId[c.id]
      const hot = Number(metrics?.hot || 0)
      const revenue = Number(metrics?.revenue || 0)
      const social = Number(metrics?.likes || 0) + Number(metrics?.saves || 0) * 2 + Number(metrics?.comments || 0) * 2
      const rec = reaction * 3 + affinity + hot
      const pop = Number(metrics?.unlocked || 0) * 2 + Number(metrics?.active || 0) * 3 + social
      const sales = Number(metrics?.sales || 0)
      return { active, unlocked, ts, name, rec, pop, hot, revenue, sales }
    }
    arr.sort((a, b) => {
      const sa = score(a)
      const sb = score(b)
      if (sortBy === 'RECOMMENDED') {
        if (sb.rec !== sa.rec) return sb.rec - sa.rec
        if (sb.active !== sa.active) return sb.active - sa.active
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        return sb.ts - sa.ts
      }
      if (sortBy === 'POPULAR') {
        if (sb.pop !== sa.pop) return sb.pop - sa.pop
        if (sb.hot !== sa.hot) return sb.hot - sa.hot
        return sb.ts - sa.ts
      }
      if (sortBy === 'HOT') {
        if (sb.hot !== sa.hot) return sb.hot - sa.hot
        if (sb.pop !== sa.pop) return sb.pop - sa.pop
        return sb.ts - sa.ts
      }
      if (sortBy === 'REVENUE') {
        if (sb.revenue !== sa.revenue) return sb.revenue - sa.revenue
        if (sb.sales !== sa.sales) return sb.sales - sa.sales
        if (sb.rec !== sa.rec) return sb.rec - sa.rec
        return sb.ts - sa.ts
      }
      if (sortBy === 'ACTIVE_FIRST') {
        if (sb.active !== sa.active) return sb.active - sa.active
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        return sb.ts - sa.ts
      }
      if (sortBy === 'UNLOCKED_FIRST') {
        if (sb.unlocked !== sa.unlocked) return sb.unlocked - sa.unlocked
        if (sb.active !== sa.active) return sb.active - sa.active
        return sb.ts - sa.ts
      }
      if (sortBy === 'NAME') return sa.name.localeCompare(sb.name, 'zh-Hans-CN')
      return sb.ts - sa.ts
    })
    return arr
  }, [items, unlockedInfoBySourceId, squareMetricsBySourceId, reactionScoreBySourceId, audienceAffinity, filter, priceFilter, query, sortBy, audienceTab])

  const stats = useMemo(() => {
    let unlocked = 0
    let active = 0
    let male = 0
    let female = 0
    let teen = 0
    let free = 0
    let paid = 0
    for (const it of items) {
      const info = unlockedInfoBySourceId[it.id]
      if (info) unlocked += 1
      if (info?.active) active += 1
      if (unlockPrice(it.settings) > 0) paid += 1
      else free += 1
      const audience = getAudienceTab(it)
      if (audience === 'MALE') male += 1
      else if (audience === 'FEMALE') female += 1
      else if (audience === 'TEEN') teen += 1
    }
    return {
      total: items.length,
      unlocked,
      active,
      locked: Math.max(0, items.length - unlocked),
      male,
      female,
      teen,
      free,
      paid,
    }
  }, [items, unlockedInfoBySourceId])
  const queuePreview = useMemo(() => {
    return items
      .filter((it) => !!unlockedInfoBySourceId[it.id])
      .map((it) => {
        const info = unlockedInfoBySourceId[it.id]
        const metrics = squareMetricsBySourceId[it.id]
        const ts = it.created_at ? Date.parse(it.created_at) : 0
        return {
          sourceId: it.id,
          localId: String(info?.localId || ''),
          name: it.name || '角色',
          active: !!info?.active,
          price: unlockPrice(it.settings),
          hot: Number(metrics?.hot || 0),
          ts: Number.isFinite(ts) ? ts : 0,
        }
      })
      .sort((a, b) => {
        if (Number(b.active) !== Number(a.active)) return Number(b.active) - Number(a.active)
        if (b.hot !== a.hot) return b.hot - a.hot
        return b.ts - a.ts
      })
      .slice(0, 8)
  }, [items, unlockedInfoBySourceId, squareMetricsBySourceId])
  const marketStats = useMemo(() => {
    let totalHot = 0
    let totalRevenue = 0
    let totalComments = 0
    let totalSales = 0
    for (const it of items) {
      const m = squareMetricsBySourceId[it.id]
      if (!m) continue
      totalHot += Number(m.hot || 0)
      totalRevenue += Number(m.revenue || 0)
      totalComments += Number(m.comments || 0)
      totalSales += Number(m.sales || 0)
    }
    return {
      totalHot,
      totalRevenue,
      totalComments,
      totalSales,
    }
  }, [items, squareMetricsBySourceId])
  const spotlightItems = useMemo(() => filteredItems.slice(0, 3), [filteredItems])
  const gridItems = useMemo(() => filteredItems.slice(3), [filteredItems])

  const renderCard = (c: PubCharacter, featured = false) => {
    const p = asRecord(c.profile)
    const s = asRecord(c.settings)
    const age = getStr(p, 'age').trim()
    const occupation = getStr(p, 'occupation').trim()
    const org = getStr(p, 'organization').trim()
    const meta = [age ? `${age}岁` : '', occupation, org].filter(Boolean).join(' · ')
    const ageMode = s.age_mode === 'teen' || s.teen_mode === true ? '未成年模式' : '成人模式'
    const romance = typeof s.romance_mode === 'string' ? s.romance_mode : ''
    const romanceLabel = ageMode === '未成年模式' ? '恋爱关闭' : romance === 'ROMANCE_OFF' ? '恋爱关闭' : '恋爱开启'
    const audience = getAudienceTab(c)
    const info = unlockedInfoBySourceId[c.id]
    const priceCoins = unlockPrice(c.settings)
    const shareBp = unlockCreatorShareBp(c.settings)
    const paidRole = priceCoins > 0
    const insufficientCoins = !info && isLoggedIn && walletReady && paidRole && walletBalance < priceCoins
    const recScore = Number(reactionScoreBySourceId[c.id] || 0)
    const metrics = squareMetricsBySourceId[c.id]
    const myReaction = squareReactions[c.id] || {}
    const reactionBusy = reactionBusyKey.startsWith(`${c.id}:`)

    return (
      <div key={c.id} className="uiCard" style={{ cursor: 'pointer', borderColor: featured ? 'rgba(249,217,142,.32)' : undefined }} onClick={() => router.push(`/square/${c.id}`)}>
        <div className="uiCardMedia">
          {imgById[c.id] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgById[c.id]} alt="" />
          ) : (
            <div className="uiCardMediaFallback">暂无图片</div>
          )}
        </div>
        <div className="uiCardTitle">{c.name}</div>
        <div className="uiCardMeta">
          {meta || '公开角色'}
          {info ? ` · 已解锁${info.active ? ' · 已激活' : ''}` : ''}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {featured ? (
            <span className="uiBadge" style={{ borderColor: 'rgba(249,217,142,.44)', color: 'rgba(249,217,142,.98)', background: 'rgba(77,29,40,.72)' }}>
              精选
            </span>
          ) : null}
          <span className="uiBadge">公开</span>
          <span className="uiBadge">{ageMode}</span>
          <span className="uiBadge">{audienceLabel(audience)}</span>
          <span className="uiBadge">{romanceLabel}</span>
          <span className="uiBadge">{paidRole ? `${priceCoins} 币` : '免费'}</span>
          {paidRole ? <span className="uiBadge">创作者 {Math.floor(shareBp / 100)}%</span> : null}
          {recScore > 0 ? <span className="uiBadge">偏好命中 {recScore}</span> : null}
          {myReaction.liked ? <span className="uiBadge">我已喜欢</span> : null}
          {myReaction.saved ? <span className="uiBadge">我已收藏</span> : null}
          {metrics && (metrics.unlocked > 0 || metrics.active > 0) ? (
            <span className="uiBadge">
              解锁 {metrics.unlocked} · 激活 {metrics.active}
            </span>
          ) : null}
          {metrics && metrics.hot > 0 ? <span className="uiBadge">热度 {metrics.hot}</span> : null}
          {metrics && metrics.comments > 0 ? <span className="uiBadge">评论 {metrics.comments}</span> : null}
          {metrics && metrics.revenue > 0 ? <span className="uiBadge">营收 {metrics.revenue} 币</span> : null}
          <span
            className="uiBadge"
            style={{
              borderColor: info ? 'rgba(249,217,142,.44)' : 'rgba(255,255,255,.22)',
              color: info ? 'rgba(249,217,142,.98)' : 'rgba(255,255,255,.72)',
              background: info ? 'rgba(77,29,40,.7)' : 'rgba(54,54,54,.5)',
            }}
          >
            {info ? '已解锁' : '未解锁'}
          </span>
          {info?.active ? (
            <span className="uiBadge" style={{ borderColor: 'rgba(185,25,35,.45)', color: 'rgba(255,208,208,.94)', background: 'rgba(77,29,40,.58)' }}>
              已激活
            </span>
          ) : null}
          {insufficientCoins ? <span className="uiBadge">余额不足</span> : null}
        </div>

        {info && (
          <div className="uiCardActions">
            <button
              className="uiBtn uiBtnPrimary"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/chat/${info.localId}`)
              }}
            >
              对话
            </button>
            <button
              className="uiBtn uiBtnGhost"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/home/${info.localId}`)
              }}
            >
              动态中心
            </button>
            <button
              className="uiBtn uiBtnGhost"
              disabled={togglingId === info.localId}
              onClick={(e) => {
                e.stopPropagation()
                void toggleActivation(c.id, !info.active)
              }}
            >
              {togglingId === info.localId ? '处理中...' : info.active ? '取消激活' : '激活到首页'}
            </button>
            <button
              className="uiBtn uiBtnGhost"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/square/${c.id}`)
              }}
            >
              详情
            </button>
            <button
              className="uiBtn uiBtnGhost"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/characters/new?from=${encodeURIComponent(c.id)}`)
              }}
            >
              衍生创建
            </button>
            <button
              className={`uiBtn uiBtnGhost ${myReaction.liked ? 'uiPillActive' : ''}`}
              disabled={reactionBusy}
              onClick={(e) => {
                e.stopPropagation()
                void toggleSquareReaction(c.id, 'liked')
              }}
            >
              {reactionBusy ? '处理中...' : myReaction.liked ? '取消喜欢' : '喜欢'}
            </button>
            <button
              className={`uiBtn uiBtnGhost ${myReaction.saved ? 'uiPillActive' : ''}`}
              disabled={reactionBusy}
              onClick={(e) => {
                e.stopPropagation()
                void toggleSquareReaction(c.id, 'saved')
              }}
            >
              {reactionBusy ? '处理中...' : myReaction.saved ? '取消收藏' : '收藏'}
            </button>
          </div>
        )}
        {!info && (
          <div className="uiCardActions">
            <button
              className="uiBtn uiBtnPrimary"
              disabled={unlockingId === c.id || insufficientCoins}
              onClick={(e) => {
                e.stopPropagation()
                if (!isLoggedIn) {
                  router.push('/login')
                  return
                }
                void unlockCharacterFromCard(c, { startChat: true })
              }}
            >
              {!isLoggedIn
                ? paidRole
                  ? `登录后解锁（${priceCoins}币）`
                  : '登录后解锁'
                : insufficientCoins
                  ? `余额不足（${priceCoins}币）`
                  : unlockingId === c.id
                    ? '解锁中...'
                    : paidRole
                      ? `解锁并开聊（${priceCoins}币）`
                      : '解锁并开聊'}
            </button>
            {isLoggedIn ? (
              <button
                className="uiBtn uiBtnGhost"
                disabled={unlockingId === c.id || insufficientCoins}
                onClick={(e) => {
                  e.stopPropagation()
                  void unlockCharacterFromCard(c)
                }}
              >
                {paidRole ? `仅解锁（${priceCoins}币）` : '仅解锁'}
              </button>
            ) : null}
            <button
              className="uiBtn uiBtnGhost"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/square/${c.id}`)
              }}
            >
              详情
            </button>
            <button
              className="uiBtn uiBtnGhost"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/characters/new?from=${encodeURIComponent(c.id)}`)
              }}
            >
              衍生创建
            </button>
            <button
              className={`uiBtn uiBtnGhost ${myReaction.liked ? 'uiPillActive' : ''}`}
              disabled={reactionBusy}
              onClick={(e) => {
                e.stopPropagation()
                void toggleSquareReaction(c.id, 'liked')
              }}
            >
              {reactionBusy ? '处理中...' : myReaction.liked ? '取消喜欢' : '喜欢'}
            </button>
            <button
              className={`uiBtn uiBtnGhost ${myReaction.saved ? 'uiPillActive' : ''}`}
              disabled={reactionBusy}
              onClick={(e) => {
                e.stopPropagation()
                void toggleSquareReaction(c.id, 'saved')
              }}
            >
              {reactionBusy ? '处理中...' : myReaction.saved ? '取消收藏' : '收藏'}
            </button>
            {!isLoggedIn ? (
              <button
                className="uiBtn uiBtnGhost"
                onClick={(e) => {
                  e.stopPropagation()
                  router.push('/login')
                }}
              >
                去登录
              </button>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="uiPage">
      <AppShell
        title="广场"
        badge="public"
        subtitle="浏览公开角色并解锁到你的可聊天队列，支持男频/女频/青少年频道筛选。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={load} disabled={!canRefresh}>
            刷新
          </button>
        }
      >
        <section className="uiHero">
          <div>
            <span className="uiBadge">角色发现</span>
            <h2 className="uiHeroTitle">广场用于解锁公开角色并激活到首页</h2>
            <p className="uiHeroSub">解锁后的角色会进入你的可聊天队列，并可随时激活/取消激活，决定是否出现在首页动态流。</p>
          </div>
          <div className="uiKpiGrid">
            <div className="uiKpi">
              <b>{stats.total}</b>
              <span>公开角色</span>
            </div>
            <div className="uiKpi">
              <b>{stats.locked}</b>
              <span>未解锁</span>
            </div>
            <div className="uiKpi">
              <b>{stats.unlocked}</b>
              <span>已解锁</span>
            </div>
            <div className="uiKpi">
              <b>{stats.active}</b>
              <span>已激活</span>
            </div>
            <div className="uiKpi">
              <b>{stats.male}</b>
              <span>男频</span>
            </div>
            <div className="uiKpi">
              <b>{stats.female}</b>
              <span>女频</span>
            </div>
            <div className="uiKpi">
              <b>{stats.teen}</b>
              <span>青少年</span>
            </div>
            <div className="uiKpi">
              <b>{stats.free}</b>
              <span>免费角色</span>
            </div>
            <div className="uiKpi">
              <b>{stats.paid}</b>
              <span>付费角色</span>
            </div>
            <div className="uiKpi">
              <b>{marketStats.totalHot}</b>
              <span>全站热度总分</span>
            </div>
            <div className="uiKpi">
              <b>{marketStats.totalComments}</b>
              <span>全站评论数</span>
            </div>
            <div className="uiKpi">
              <b>{marketStats.totalRevenue}</b>
              <span>解锁营收(币)</span>
            </div>
            <div className="uiKpi">
              <b>{isLoggedIn ? walletBalance : '-'}</b>
              <span>我的星币</span>
            </div>
          </div>
        </section>

        <section className="uiSquareFlowBoard">
          <div className="uiSquareFlowGrid">
            <div className="uiSquareFlowCard">
              <div className="uiSquareFlowStep">STEP 1</div>
              <div className="uiSquareFlowTitle">发现角色</div>
              <div className="uiSquareFlowDesc">从推荐、热度、评论活跃和营收榜里筛选想体验的角色。</div>
              <button className="uiPill" onClick={() => setSortBy('HOT')}>
                看热度榜
              </button>
            </div>
            <div className="uiSquareFlowCard">
              <div className="uiSquareFlowStep">STEP 2</div>
              <div className="uiSquareFlowTitle">解锁到队列</div>
              <div className="uiSquareFlowDesc">免费角色可直接解锁，付费角色会消耗星币并进入你的可聊天列表。</div>
              <button className="uiPill" onClick={() => setFilter('LOCKED')}>
                看未解锁
              </button>
            </div>
            <div className="uiSquareFlowCard">
              <div className="uiSquareFlowStep">STEP 3</div>
              <div className="uiSquareFlowTitle">激活到首页</div>
              <div className="uiSquareFlowDesc">激活后角色会持续产出朋友圈、日记和日程片段。</div>
              <button className="uiPill" onClick={() => setFilter('ACTIVE')}>
                看已激活
              </button>
            </div>
            <div className="uiSquareFlowCard">
              <div className="uiSquareFlowStep">STEP 4</div>
              <div className="uiSquareFlowTitle">开始对话</div>
              <div className="uiSquareFlowDesc">已解锁角色可以直接开聊并进入长期剧情。</div>
              <button className="uiPill" onClick={() => router.push('/home')}>
                去首页
              </button>
            </div>
          </div>
          <div className="uiSquareChannelRow">
            <button className={`uiSquareChannelCard ${audienceTab === 'ALL' ? 'uiSquareChannelCardActive' : ''}`} onClick={() => setAudienceTab('ALL')}>
              <b>{stats.total}</b>
              <span>全部频道</span>
            </button>
            <button className={`uiSquareChannelCard ${audienceTab === 'MALE' ? 'uiSquareChannelCardActive' : ''}`} onClick={() => setAudienceTab('MALE')}>
              <b>{stats.male}</b>
              <span>男频</span>
            </button>
            <button className={`uiSquareChannelCard ${audienceTab === 'FEMALE' ? 'uiSquareChannelCardActive' : ''}`} onClick={() => setAudienceTab('FEMALE')}>
              <b>{stats.female}</b>
              <span>女频</span>
            </button>
            <button className={`uiSquareChannelCard ${audienceTab === 'TEEN' ? 'uiSquareChannelCardActive' : ''}`} onClick={() => setAudienceTab('TEEN')}>
              <b>{stats.teen}</b>
              <span>青少年</span>
            </button>
          </div>
        </section>

        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}

        {loading && <div className="uiSkeleton">加载中...</div>}
        {!loading && !isLoggedIn && (
          <div className="uiAlert uiAlertOk">当前为游客浏览模式。登录后可解锁角色并激活到首页。</div>
        )}
        {!loading && !squareReactionTableReady && (
          <div className="uiAlert uiAlertOk">广场互动表尚未启用，偏好学习暂使用聊天互动回退信号。</div>
        )}

        {!loading && (
          <div className="uiSquareWorkspace">
            <aside className="uiSquareSidebar">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">筛选器</div>
                    <div className="uiPanelSub">按状态、频道和关键词筛选公开角色</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="uiBadge">总计: {stats.total}</span>
                    <span className="uiBadge">未解锁: {stats.locked}</span>
                    <span className="uiBadge">已解锁: {stats.unlocked}</span>
                    <span className="uiBadge">已激活: {stats.active}</span>
                    <span className="uiBadge">热度: {marketStats.totalHot}</span>
                    <span className="uiBadge">评论: {marketStats.totalComments}</span>
                  </div>
                  <input
                    className="uiInput"
                    placeholder="搜索角色名/职业/组织..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${filter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setFilter('ALL')}>
                      全部
                    </button>
                    <button className={`uiPill ${filter === 'LOCKED' ? 'uiPillActive' : ''}`} onClick={() => setFilter('LOCKED')}>
                      未解锁
                    </button>
                    <button className={`uiPill ${filter === 'UNLOCKED' ? 'uiPillActive' : ''}`} onClick={() => setFilter('UNLOCKED')}>
                      已解锁
                    </button>
                    <button className={`uiPill ${filter === 'ACTIVE' ? 'uiPillActive' : ''}`} onClick={() => setFilter('ACTIVE')}>
                      已激活
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${priceFilter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setPriceFilter('ALL')}>
                      全部价格
                    </button>
                    <button className={`uiPill ${priceFilter === 'FREE' ? 'uiPillActive' : ''}`} onClick={() => setPriceFilter('FREE')}>
                      仅免费
                    </button>
                    <button className={`uiPill ${priceFilter === 'PAID' ? 'uiPillActive' : ''}`} onClick={() => setPriceFilter('PAID')}>
                      仅付费
                    </button>
                  </div>
                  <select className="uiInput" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                    <option value="RECOMMENDED">排序：为你推荐</option>
                    <option value="POPULAR">排序：热度优先</option>
                    <option value="HOT">排序：实时热榜</option>
                    <option value="REVENUE">排序：营收优先</option>
                    <option value="UNLOCKED_FIRST">排序：已解锁优先</option>
                    <option value="ACTIVE_FIRST">排序：已激活优先</option>
                    <option value="NEWEST">排序：最新发布</option>
                    <option value="NAME">排序：角色名</option>
                  </select>
                  <div className="uiHint">
                    {hasPreferenceSignal
                      ? '推荐排序会结合你的点赞/收藏偏好与全站热度信号。'
                      : '推荐排序会结合全站热度信号，并随着你的点赞/收藏逐步学习偏好。'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${squareLiveRefresh ? 'uiPillActive' : ''}`} onClick={() => setSquareLiveRefresh((v) => !v)}>
                      自动刷新 {squareLiveRefresh ? '开' : '关'}
                    </button>
                  </div>
                  {squareLiveRefresh ? <div className="uiHint">自动刷新中（90 秒）{squareLiveSyncAt ? ` · 最近同步 ${new Date(squareLiveSyncAt).toLocaleTimeString()}` : ''}</div> : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className={`uiPill ${audienceTab === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('ALL')}>
                      全部频道
                    </button>
                    <button className={`uiPill ${audienceTab === 'MALE' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('MALE')}>
                      男频
                    </button>
                    <button className={`uiPill ${audienceTab === 'FEMALE' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('FEMALE')}>
                      女频
                    </button>
                    <button className={`uiPill ${audienceTab === 'TEEN' ? 'uiPillActive' : ''}`} onClick={() => setAudienceTab('TEEN')}>
                      青少年
                    </button>
                  </div>
                </div>
              </div>

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">操作入口</div>
                    <div className="uiPanelSub">解锁后可进入首页与聊天，支持星币付费解锁</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  {isLoggedIn ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="uiBadge">星币余额: {walletBalance}</span>
                      <span className="uiBadge">累计解锁: {walletUnlocked}</span>
                      <span className="uiBadge">累计消费: {walletSpent}</span>
                      <span className="uiBadge">全站成交: {marketStats.totalSales}</span>
                      <span className="uiBadge">全站营收: {marketStats.totalRevenue} 币</span>
                      <span className="uiBadge">可聊天队列: {stats.unlocked}</span>
                      <span className="uiBadge">首页激活: {stats.active}</span>
                      {!walletReady ? <span className="uiBadge">钱包未初始化（可继续免费解锁）</span> : null}
                    </div>
                  ) : null}
                  {isLoggedIn && queuePreview.length > 0 ? (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div className="uiHint">你的可聊天队列（最近/热门优先）</div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {queuePreview.map((q) => (
                          <div key={q.localId || q.sourceId} className="uiRow" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{q.name}</div>
                              <div className="uiHint">
                                {q.active ? '已激活到首页' : '仅解锁未激活'} · {q.price > 0 ? `${q.price} 币` : '免费'} · 热度 {q.hot}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${q.localId}`)}>
                                开聊
                              </button>
                              <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/home/${q.localId}`)}>
                                动态
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <button className="uiBtn uiBtnSecondary" onClick={() => router.push('/home')}>
                    打开首页
                  </button>
                  {isLoggedIn ? (
                    <button className="uiBtn uiBtnGhost" onClick={() => setFilter('UNLOCKED')}>
                      仅看我的队列
                    </button>
                  ) : null}
                  {isLoggedIn ? (
                    <button className="uiBtn uiBtnGhost" onClick={() => setFilter('ACTIVE')}>
                      仅看已激活
                    </button>
                  ) : null}
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/wallet')}>
                    打开钱包中心
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/wardrobe')}>
                    打开衣柜资产中心
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters')}>
                    管理我的角色
                  </button>
                  <button className="uiBtn uiBtnGhost" onClick={() => router.push('/characters/new')}>
                    创建新角色
                  </button>
                  {!isLoggedIn ? (
                    <button className="uiBtn uiBtnGhost" onClick={() => router.push('/login')}>
                      登录后可解锁
                    </button>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="uiSquareMain">
              {filteredItems.length === 0 && (
                <div className="uiEmpty">
                  <div className="uiEmptyTitle">没有匹配结果</div>
                  <div className="uiEmptyDesc">试试清空搜索词，或切换筛选条件。</div>
                </div>
              )}

              {spotlightItems.length > 0 && (
                <section>
                  <div className="uiSectionHead">
                    <h3 className="uiSectionTitle">精选角色</h3>
                    <span className="uiHint">基于当前筛选结果展示前 3 个</span>
                  </div>
                  <div className="uiGrid">
                    {spotlightItems.map((c) => renderCard(c, true))}
                  </div>
                </section>
              )}

              {gridItems.length > 0 && (
                <section>
                  <div className="uiSectionHead">
                    <h3 className="uiSectionTitle">全部结果</h3>
                    <span className="uiHint">共 {filteredItems.length} 个角色</span>
                  </div>
                  <div className="uiGrid">
                    {gridItems.map((c) => renderCard(c))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </AppShell>
    </div>
  )
}
