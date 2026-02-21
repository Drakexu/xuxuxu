'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/app/_components/AppShell'
import { supabase } from '@/lib/supabaseClient'
import { fetchWalletHistory, fetchWalletSummary, type WalletTransaction, type WalletUnlockReceipt } from '@/lib/wallet'

type Alert = { type: 'ok' | 'err'; text: string } | null
type WalletTab = 'transactions' | 'unlocks'
type TxFilter = 'ALL' | 'DEBIT' | 'CREDIT'

function fmtTime(v: string) {
  const t = Date.parse(String(v || ''))
  if (!Number.isFinite(t)) return '-'
  return new Date(t).toLocaleString()
}

function reasonLabel(v: string) {
  const key = String(v || '').trim().toLowerCase()
  if (key === 'square_unlock') return '解锁公开角色'
  if (key === 'square_unlock_sale') return '角色售卖分成'
  if (key === 'square_unlock_refund') return '解锁退款'
  if (!key) return '未知'
  return key
}

function formatCoin(v: number) {
  if (!Number.isFinite(v)) return '0'
  return `${v.toLocaleString()} 币`
}

function txDeltaKind(kind: WalletTransaction['kind']) {
  return kind === 'debit' ? '支出' : kind === 'credit' ? '收入' : '转账'
}

function txAmountText(kind: WalletTransaction['kind'], amount: number) {
  return `${kind === 'debit' ? '-' : '+'}${formatCoin(amount).replace(' 币', '')}`
}

export default function WalletPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<Alert>(null)
  const [tab, setTab] = useState<WalletTab>('transactions')
  const [txFilter, setTxFilter] = useState<TxFilter>('ALL')
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
      else if (tx.kind === 'credit') credit += tx.amount
    }
    return { debit, credit, net: credit - debit }
  }, [transactions])

  const txFilterCount = useMemo(() => {
    const debitCount = transactions.filter((x) => x.kind === 'debit').length
    const creditCount = transactions.filter((x) => x.kind === 'credit').length
    return { debitCount, creditCount, all: transactions.length }
  }, [transactions])

  const transactionsFiltered = useMemo(() => {
    if (txFilter === 'DEBIT') return transactions.filter((x) => x.kind === 'debit')
    if (txFilter === 'CREDIT') return transactions.filter((x) => x.kind === 'credit')
    return transactions
  }, [transactions, txFilter])

  return (
    <div className="uiPage">
      <AppShell
        title="钱包中心"
        badge="coins"
        subtitle="查看当前星币、解锁记录和交易流水"
        actions={
          <button className="uiBtn uiBtnGhost" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        }
      >
        {alert && <div className={`uiAlert ${alert.type === 'ok' ? 'uiAlertOk' : 'uiAlertErr'}`}>{alert.text}</div>}
        {loading && <div className="uiSkeleton">钱包加载中...</div>}

        {!loading && (
          <>
            <section className="uiHero">
              <div>
                <span className="uiBadge">Wallet</span>
                <h2 className="uiHeroTitle">钱包与收益总览</h2>
                <p className="uiHeroSub">展示星币收支、角色解锁和创作分成流水。</p>
              </div>
              <div className="uiKpiGrid">
                <div className="uiKpi">
                  <b>{balance}</b>
                  <span>当前余额</span>
                </div>
                <div className="uiKpi">
                  <b>{formatCoin(totalSpent)}</b>
                  <span>累计消费</span>
                </div>
                <div className="uiKpi">
                  <b>{totalUnlocked}</b>
                  <span>累计解锁</span>
                </div>
                <div className="uiKpi">
                  <b>{transactions.length}</b>
                  <span>总流水数</span>
                </div>
                <div className="uiKpi">
                  <b>{formatCoin(txStats.debit)}</b>
                  <span>总支出</span>
                </div>
                <div className="uiKpi">
                  <b>{formatCoin(txStats.credit)}</b>
                  <span>总收入</span>
                </div>
                <div className="uiKpi">
                  <b>{formatCoin(txStats.net)}</b>
                  <span>净收益</span>
                </div>
                <div className="uiKpi">
                  <b>{walletReady ? '正常' : '降级'}</b>
                  <span>账本状态</span>
                </div>
              </div>
            </section>

            {!walletReady && (
              <div className="uiAlert uiAlertOk">
                钱包表未初始化。免费解锁仍可正常进行；首次扣币将会触发钱包账本初始化。
              </div>
            )}

            <div className="uiPanel" style={{ marginTop: 12 }}>
              <div className="uiPanelHeader">
                <div>
                  <div className="uiPanelTitle">钱包明细</div>
                  <div className="uiPanelSub">交易与解锁历史</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0 12px', flexWrap: 'wrap' }}>
                <button className={`uiPill ${tab === 'transactions' ? 'uiPillActive' : ''}`} onClick={() => setTab('transactions')}>
                  交易流水
                </button>
                <button className={`uiPill ${tab === 'unlocks' ? 'uiPillActive' : ''}`} onClick={() => setTab('unlocks')}>
                  解锁记录
                </button>
              </div>

              {tab === 'transactions' ? (
                <>
                  <div className="uiPanelSub" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className={`uiPill ${txFilter === 'ALL' ? 'uiPillActive' : ''}`} onClick={() => setTxFilter('ALL')}>
                        全部 ({txFilterCount.all})
                      </button>
                      <button className={`uiPill ${txFilter === 'DEBIT' ? 'uiPillActive' : ''}`} onClick={() => setTxFilter('DEBIT')}>
                        支出 ({txFilterCount.debitCount})
                      </button>
                      <button className={`uiPill ${txFilter === 'CREDIT' ? 'uiPillActive' : ''}`} onClick={() => setTxFilter('CREDIT')}>
                        收入 ({txFilterCount.creditCount})
                      </button>
                    </div>
                  </div>

                  <div className="uiForm" style={{ paddingTop: 0 }}>
                    {transactionsFiltered.length === 0 && <div className="uiHint">暂无交易流水。</div>}
                    {transactionsFiltered.map((tx) => (
                      <div key={tx.id} className="uiRow" style={{ alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {txAmountText(tx.kind, tx.amount)} · {txDeltaKind(tx.kind)} · {reasonLabel(tx.reason)}
                          </div>
                          <div className="uiHint" style={{ marginTop: 4 }}>
                            {tx.sourceCharacterName || tx.sourceCharacterId || '-'}
                          </div>
                          <div className="uiHint">{fmtTime(tx.createdAt)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {tx.localCharacterId ? (
                            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/chat/${tx.localCharacterId}`)}>
                              角色会话
                            </button>
                          ) : null}
                          {tx.sourceCharacterId ? (
                            <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${tx.sourceCharacterId}`)}>
                              角色来源
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="uiForm" style={{ paddingTop: 0 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <button className="uiBtn uiBtnGhost" onClick={() => void router.push('/square')}>
                      去广场解锁更多
                    </button>
                    <button className="uiBtn uiBtnGhost" onClick={() => void router.push('/characters')}>
                      管理已解锁角色
                    </button>
                  </div>
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
                            进入聊天
                          </button>
                        ) : null}
                        {u.sourceCharacterId ? (
                          <button className="uiBtn uiBtnGhost" onClick={() => router.push(`/square/${u.sourceCharacterId}`)}>
                            来源角色
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </AppShell>
    </div>
  )
}
