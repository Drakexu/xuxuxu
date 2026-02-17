'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/app/_components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { fetchWalletHistory, fetchWalletSummary, type WalletTransaction, type WalletUnlockReceipt } from '@/lib/wallet'

type Alert = { type: 'ok' | 'err'; text: string } | null

function fmtTime(v: string) {
  const t = Date.parse(String(v || ''))
  if (!Number.isFinite(t)) return '-'
  return new Date(t).toLocaleString()
}

function reasonLabel(v: string) {
  const key = String(v || '').trim().toLowerCase()
  if (key === 'square_unlock') return '广场解锁'
  if (!key) return '-'
  return key
}

export default function WalletPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [walletReady, setWalletReady] = useState(false)
  const [balance, setBalance] = useState(0)
  const [totalSpent, setTotalSpent] = useState(0)
  const [totalUnlocked, setTotalUnlocked] = useState(0)
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [unlocks, setUnlocks] = useState<WalletUnlockReceipt[]>([])

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => setAlert(null), 2800)
    return () => clearTimeout(t)
  }, [alert])

  const load = async () => {
    setLoading(true)
    setAlert(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user?.id) {
        router.replace('/login')
        return
      }
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token || ''
      if (!token) {
        router.replace('/login')
        return
      }

      const [summary, history] = await Promise.all([fetchWalletSummary(token), fetchWalletHistory(token)])
      setWalletReady(summary.walletReady && history.walletReady)
      setBalance(summary.balance)
      setTotalSpent(summary.totalSpent)
      setTotalUnlocked(summary.totalUnlocked)
      setTransactions(history.transactions)
      setUnlocks(history.unlocks)
    } catch (e: unknown) {
      setAlert({ type: 'err', text: e instanceof Error ? e.message : String(e) })
      setTransactions([])
      setUnlocks([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const txStats = useMemo(() => {
    let debit = 0
    let credit = 0
    for (const tx of transactions) {
      if (tx.kind === 'debit') debit += tx.amount
      else credit += tx.amount
    }
    return { debit, credit }
  }, [transactions])

  return (
    <div className="uiPage">
      <AppShell
        title="钱包中心"
        badge="coins"
        subtitle="查看星币余额、解锁消费流水和已解锁角色凭据。"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      >
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">加载中...</div>}

        {!loading && (
          <>
            <section className="uiHero">
              <div>
                <span className="uiBadge">Wallet</span>
                <h2 className="uiHeroTitle">星币与解锁消费总览</h2>
                <p className="uiHeroSub">广场付费角色会在解锁时扣费，并在这里保留消费与解锁凭据。</p>
              </div>
              <div className="uiKpiGrid">
                <div className="uiKpi">
                  <b>{balance}</b>
                  <span>当前余额</span>
                </div>
                <div className="uiKpi">
                  <b>{totalSpent}</b>
                  <span>累计消费</span>
                </div>
                <div className="uiKpi">
                  <b>{totalUnlocked}</b>
                  <span>累计解锁</span>
                </div>
                <div className="uiKpi">
                  <b>{transactions.length}</b>
                  <span>流水条数</span>
                </div>
                <div className="uiKpi">
                  <b>{txStats.debit}</b>
                  <span>总扣费</span>
                </div>
                <div className="uiKpi">
                  <b>{walletReady ? 'ready' : 'fallback'}</b>
                  <span>钱包状态</span>
                </div>
              </div>
            </section>

            {!walletReady && <div className="uiAlert uiAlertOk">钱包表尚未启用，当前为兼容模式（仍可免费解锁）。</div>}

            <div className="uiSplit">
              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">消费流水</div>
                    <div className="uiPanelSub">最近 200 条交易</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  {transactions.length === 0 && <div className="uiHint">暂无流水。</div>}
                  {transactions.map((tx) => (
                    <div key={tx.id} className="uiRow" style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {tx.kind === 'debit' ? '-' : '+'}
                          {tx.amount} 币 · {reasonLabel(tx.reason)}
                        </div>
                        <div className="uiHint" style={{ marginTop: 4 }}>
                          {tx.sourceCharacterName || tx.sourceCharacterId || '-'}
                        </div>
                        <div className="uiHint">{fmtTime(tx.createdAt)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {tx.localCharacterId ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${tx.localCharacterId}`)}>
                            去聊天
                          </button>
                        ) : null}
                        {tx.sourceCharacterId ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${tx.sourceCharacterId}`)}>
                            来源角色
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="uiPanel" style={{ marginTop: 0 }}>
                <div className="uiPanelHeader">
                  <div>
                    <div className="uiPanelTitle">解锁凭据</div>
                    <div className="uiPanelSub">每个公开角色仅保留一条解锁关系</div>
                  </div>
                </div>
                <div className="uiForm" style={{ paddingTop: 14 }}>
                  {unlocks.length === 0 && <div className="uiHint">暂无解锁记录。</div>}
                  {unlocks.map((u) => (
                    <div key={u.id} className="uiRow" style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{u.sourceCharacterName || u.sourceCharacterId || '-'}</div>
                        <div className="uiHint" style={{ marginTop: 4 }}>
                          {u.priceCoins > 0 ? `支付 ${u.priceCoins} 币` : '免费解锁'}
                        </div>
                        <div className="uiHint">{fmtTime(u.createdAt)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {u.localCharacterId ? (
                          <button className="uiBtn uiBtnSecondary" onClick={() => router.push(`/chat/${u.localCharacterId}`)}>
                            开聊
                          </button>
                        ) : null}
                        {u.sourceCharacterId ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${u.sourceCharacterId}`)}>
                            广场详情
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </AppShell>
    </div>
  )
}

