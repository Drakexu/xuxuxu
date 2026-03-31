'use client'

import React, { useEffect, useState } from "react"
import { motion } from "motion/react"
import {
  TrendingUp,
  TrendingDown,
  ArrowLeft,
  DollarSign,
  Wallet,
  BarChart3,
  Activity,
  Clock,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  Minus,
} from "lucide-react"
import { useRouter } from "next/navigation"
import PortfolioLayout from "@/app/_components/PortfolioLayout"

// ─── Types ───────────────────────────────────────────────────────────
interface Account {
  nav: number
  cash: number
  initial: number
  total_pnl: number
  total_return_pct: number
  drawdown_pct: number
  daily_pnl: number
  daily_return_pct: number
}

interface Position {
  symbol: string
  qty: number
  avg_cost: number
  market_price: number
  market_value: number
  unrealized_pnl: number
  weight_pct: number
}

interface Order {
  time: string
  symbol: string
  side: string
  qty: number
  price: number | null
  status: string
  gross_value: number | null
  fee: number | null
}

interface NavPoint {
  time: string
  nav: number
  cash: number
  drawdown_pct: number
}

interface SignalItem {
  symbol: string
  resonance_ratio: number
  appearances: number
  total_horizons: number
  weighted_pred: number
  price: number
  per_horizon: Record<string, { pred: number; rank: number; in_top: boolean }>
}

interface Signals {
  timestamp: string
  horizons: number[]
  signals: SignalItem[]
  horizon_tops: Record<string, string[]>
}

interface IndexData {
  name: string
  symbol: string
  price: number
  change: number
  change_pct: number
}

interface Metadata {
  last_updated: string
}

// ─── Helpers ─────────────────────────────────────────────────────────
const DATA_BASE = "/api/dra-qt"

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${file}?t=${Date.now()}`, { cache: "no-store" })
    if (res.ok) return res.json()
  } catch { /* ignore */ }
  return null
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtShort(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  if (abs >= 1_000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return fmt(n, 2)
}

function pnlColor(n: number): string {
  if (n > 0) return "text-emerald-600"
  if (n < 0) return "text-red-500"
  return "text-zinc-400"
}

function pnlBg(n: number): string {
  if (n > 0) return "bg-emerald-50 text-emerald-700"
  if (n < 0) return "bg-red-50 text-red-600"
  return "bg-zinc-50 text-zinc-500"
}

// ─── Section Header ──────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
      {title}
      <div className="flex-1 h-px bg-zinc-100" />
    </h2>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────
export default function DraQTDashboard() {
  const router = useRouter()
  const [account, setAccount] = useState<Account | null>(null)
  const [portfolio, setPortfolio] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [navHistory, setNavHistory] = useState<NavPoint[]>([])
  const [signals, setSignals] = useState<Signals | null>(null)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [indices, setIndices] = useState<IndexData[]>([])
  const [loading, setLoading] = useState(true)

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const REFRESH_INTERVAL = 30 // seconds

  const loadData = React.useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    await Promise.all([
      fetchJson<Account>("account.json").then(setAccount),
      fetchJson<Position[]>("portfolio.json").then((d) => setPortfolio(d ?? [])),
      fetchJson<Order[]>("orders.json").then((d) => setOrders(d ?? [])),
      fetchJson<NavPoint[]>("nav_history.json").then((d) => setNavHistory(d ?? [])),
      fetchJson<Signals>("signals.json").then(setSignals),
      fetchJson<Metadata>("metadata.json").then(setMetadata),
      fetchJson<IndexData[]>("indices.json").then((d) => setIndices(d ?? [])),
    ])
    setLastRefresh(new Date())
    setSecondsAgo(0)
    if (manual) setRefreshing(false)
  }, [])

  useEffect(() => {
    loadData().finally(() => setLoading(false))
    const interval = setInterval(() => loadData(), REFRESH_INTERVAL * 1000)
    return () => clearInterval(interval)
  }, [loadData])

  // Tick the "seconds ago" counter every second
  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((s) => s + 1), 1000)
    return () => clearInterval(tick)
  }, [])

  if (loading) {
    return (
      <PortfolioLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
            <RefreshCw className="w-6 h-6 text-emerald-500" />
          </motion.div>
        </div>
      </PortfolioLayout>
    )
  }

  const horizons = signals?.horizons ?? [1, 3, 5, 10, 20, 30]

  return (
    <PortfolioLayout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative space-y-12 md:space-y-20"
      >
        {/* Background Blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1], x: [0, 50, 0], y: [0, -30, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 right-[-10%] w-[50%] h-[50%] bg-emerald-200/20 blur-[120px] rounded-full"
          />
        </div>

        {/* Back */}
        <button
          onClick={() => router.back()}
          className="group flex items-center gap-3 text-zinc-400 hover:text-zinc-900 transition-colors font-black uppercase tracking-widest text-[10px]"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          Back
        </button>

        {/* Hero */}
        <section className="space-y-6">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-8">
            <motion.div
              animate={{ rotate: [0, 2, -2, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="w-28 h-28 md:w-40 md:h-40 rounded-[2.5rem] md:rounded-[3.5rem] bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-xl"
            >
              <TrendingUp className="w-14 h-14 md:w-20 md:h-20 text-emerald-500" />
            </motion.div>
            <div className="text-center md:text-left space-y-3">
              <div className="flex items-center justify-center md:justify-start gap-4">
                <span className="px-4 py-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest">
                  Live Dashboard
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-black text-zinc-900 tracking-tighter">Dra.QT</h1>
              <p className="text-lg md:text-xl text-zinc-400 font-black uppercase tracking-[0.2em]">
                AI 量化交易实验
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-center md:justify-start">
            {metadata && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-300 uppercase tracking-wider">
                <Clock className="w-3 h-3" />
                Data: {new Date(metadata.last_updated).toLocaleString()}
              </div>
            )}
            <div className="flex items-center gap-3">
              {/* Live pulse + countdown */}
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                {secondsAgo < REFRESH_INTERVAL
                  ? <span className="text-emerald-600">{REFRESH_INTERVAL - secondsAgo}s</span>
                  : <span className="text-zinc-300">refreshing…</span>
                }
              </div>
              {/* Manual refresh button */}
              <button
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 hover:text-zinc-700 transition-all text-[10px] font-mono uppercase tracking-wider disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </section>

        {/* ─── Account Overview Cards ─────────────────────────────── */}
        {account && (
          <section className="space-y-6">
            <SectionHeader title="Account Overview" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "NAV", value: `$${fmtShort(account.nav)}`, icon: DollarSign, detail: `Initial $${fmtShort(account.initial)}` },
                { label: "Today P&L", value: `${account.daily_pnl >= 0 ? "+" : ""}$${fmtShort(account.daily_pnl)}`, icon: account.daily_pnl >= 0 ? TrendingUp : TrendingDown, detail: `${account.daily_return_pct >= 0 ? "+" : ""}${fmt(account.daily_return_pct, 2)}%`, color: account.daily_pnl >= 0, detailColor: account.daily_return_pct },
                { label: "Today Return", value: `${account.daily_return_pct >= 0 ? "+" : ""}${fmt(account.daily_return_pct, 2)}%`, icon: Activity, detail: `${account.daily_pnl >= 0 ? "+" : ""}$${fmtShort(account.daily_pnl)}`, color: account.daily_return_pct >= 0, detailColor: account.daily_pnl },
                { label: "Cash", value: `$${fmtShort(account.cash)}`, icon: Wallet, detail: `${fmt(account.cash / account.nav * 100, 1)}% of NAV` },
              ].map((card, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="p-5 md:p-6 rounded-[1.5rem] bg-white border border-zinc-100 shadow-sm space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <card.icon className={`w-4 h-4 ${card.color === false ? "text-red-400" : card.color === true ? "text-emerald-500" : "text-zinc-300"}`} />
                    <span className="text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">{card.label}</span>
                  </div>
                  <p className={`text-2xl md:text-3xl font-black tracking-tight ${card.color === false ? "text-red-500" : card.color === true ? "text-emerald-600" : "text-zinc-900"}`}>
                    {card.value}
                  </p>
                  <p className={`text-[11px] font-medium tracking-wide ${
                    card.detailColor !== undefined
                      ? card.detailColor > 0 ? "text-emerald-500" : card.detailColor < 0 ? "text-red-400" : "text-zinc-400"
                      : "text-zinc-400"
                  }`}>{card.detail}</p>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* ─── US Market Indices ─────────────────────────────────── */}
        {indices.length > 0 && (
          <section>
            <div className="grid grid-cols-3 gap-3">
              {indices.map((idx) => (
                <motion.div
                  key={idx.symbol}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between px-5 py-4 rounded-2xl bg-white border border-zinc-100 shadow-sm"
                >
                  <div>
                    <p className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">{idx.name}</p>
                    <p className="text-lg font-black text-zinc-900 tracking-tight">{fmtShort(idx.price)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold font-mono ${idx.change >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {idx.change >= 0 ? "+" : ""}{fmt(idx.change, 2)}
                    </p>
                    <p className={`text-xs font-mono ${idx.change >= 0 ? "text-emerald-500" : "text-red-400"}`}>
                      {idx.change_pct >= 0 ? "+" : ""}{fmt(idx.change_pct, 2)}%
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {/* ─── NAV Chart ─────────────────────────────────────────── */}
        {navHistory.length > 1 && (
          <section className="space-y-6">
            <SectionHeader title="NAV History" />
            <div className="p-6 md:p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm">
              <NavChart data={navHistory} />
            </div>
          </section>
        )}

        {/* ─── Portfolio Table ────────────────────────────────────── */}
        {portfolio.length > 0 && (
          <section className="space-y-6">
            <SectionHeader title="Current Holdings" />
            <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-50">
                      {["Symbol", "Qty", "Avg Cost", "Price", "Value", "P&L", "Weight"].map((h) => (
                        <th key={h} className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.map((p, i) => (
                      <motion.tr
                        key={p.symbol}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.05 }}
                        className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                      >
                        <td className="px-5 py-4 text-sm font-black text-zinc-900 tracking-tight">{p.symbol}</td>
                        <td className="px-5 py-4 text-xs font-mono text-zinc-600">{p.qty}</td>
                        <td className="px-5 py-4 text-xs font-mono text-zinc-600">${fmt(p.avg_cost)}</td>
                        <td className="px-5 py-4 text-xs font-mono text-zinc-600">${fmt(p.market_price)}</td>
                        <td className="px-5 py-4 text-xs font-mono text-zinc-900 font-bold">${fmt(p.market_value, 0)}</td>
                        <td className={`px-5 py-4 text-xs font-mono font-bold ${pnlColor(p.unrealized_pnl)}`}>
                          {p.unrealized_pnl >= 0 ? "+" : ""}{fmt(p.unrealized_pnl)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${p.weight_pct}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-zinc-400">{fmt(p.weight_pct, 1)}%</span>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ─── Orders Table ───────────────────────────────────────── */}
        {orders.length > 0 && (
          <section className="space-y-6">
            <SectionHeader title="Recent Orders" />
            <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-50">
                      {["Time", "Symbol", "Side", "Qty", "Price", "Status"].map((h) => (
                        <th key={h} className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <motion.tr
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                      >
                        <td className="px-5 py-3 text-[10px] font-mono text-zinc-400 whitespace-nowrap">
                          {new Date(o.time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}
                        </td>
                        <td className="px-5 py-3 text-sm font-black text-zinc-900 tracking-tight">{o.symbol}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase ${
                            o.side === "buy" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                          }`}>
                            {o.side}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs font-mono text-zinc-600">{o.qty}</td>
                        <td className="px-5 py-3 text-xs font-mono text-zinc-600">{o.price ? `$${fmt(o.price)}` : "—"}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase ${
                              o.status === "filled" ? "bg-emerald-50 text-emerald-700" :
                              o.status === "rejected" ? "bg-red-50 text-red-600" :
                              "bg-zinc-50 text-zinc-500"
                            }`}
                            title={o.status === "rejected" ? "风控拦截：触发了风控规则（如持仓上限、现金不足等）" : ""}
                          >
                            {o.status === "rejected" ? "风控拦截" : o.status}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ─── Resonance Signals ──────────────────────────────────── */}
        {signals && signals.signals.length > 0 && (
          <section className="space-y-6">
            <SectionHeader title="Resonance Signals" />
            <p className="text-xs text-zinc-400">
              Multi-horizon consensus: each cell shows whether the symbol is in the top-k for that horizon.
            </p>
            <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-zinc-50">
                      <th className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">Symbol</th>
                      <th className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">Score</th>
                      {horizons.map((h) => (
                        <th key={h} className="px-3 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest text-center">
                          {h}d
                        </th>
                      ))}
                      <th className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signals.signals.map((s, i) => (
                      <motion.tr
                        key={s.symbol}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                      >
                        <td className="px-5 py-3 text-sm font-black text-zinc-900 tracking-tight">{s.symbol}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold ${
                            s.resonance_ratio >= 0.67 ? "bg-emerald-50 text-emerald-700" :
                            s.resonance_ratio >= 0.33 ? "bg-amber-50 text-amber-700" :
                            "bg-zinc-50 text-zinc-500"
                          }`}>
                            {s.appearances}/{s.total_horizons}
                          </span>
                        </td>
                        {horizons.map((h) => {
                          const hd = s.per_horizon[String(h)]
                          if (!hd) return <td key={h} className="px-3 py-3 text-center"><Minus className="w-3 h-3 text-zinc-200 mx-auto" /></td>
                          return (
                            <td key={h} className="px-3 py-3 text-center">
                              {hd.in_top ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <ChevronUp className="w-4 h-4 text-emerald-500" />
                                  <span className="text-[8px] font-mono text-emerald-600">#{hd.rank}</span>
                                </div>
                              ) : hd.pred < 0 ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <ChevronDown className="w-4 h-4 text-red-300" />
                                  <span className="text-[8px] font-mono text-zinc-300">#{hd.rank}</span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5">
                                  <Minus className="w-3 h-3 text-zinc-200" />
                                  <span className="text-[8px] font-mono text-zinc-300">#{hd.rank}</span>
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-5 py-3 text-xs font-mono text-zinc-600 text-right">${fmt(s.price)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ─── Resonance CTA ──────────────────────────────────────── */}
        <section className="pt-4">
          <div className="p-12 md:p-20 rounded-[3rem] md:rounded-[4rem] bg-emerald-500 text-white text-center space-y-8 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-400 to-teal-600 opacity-50" />
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 4, repeat: Infinity }}
              className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2"
            />
            <div className="relative z-10 space-y-6">
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter">共振 &gt; 预测</h2>
              <p className="text-emerald-100 text-lg md:text-xl font-medium max-w-xl mx-auto">
                不追求精准预测单一时间点。当多个独立视角达成共识，概率自然站在你这边。
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-4">
                {horizons.map((h) => (
                  <motion.span
                    key={h}
                    whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.3)" }}
                    className="px-6 py-3 rounded-2xl bg-white/10 text-sm font-black uppercase tracking-widest backdrop-blur-sm border border-white/10"
                  >
                    {h}d
                  </motion.span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </motion.div>
    </PortfolioLayout>
  )
}

// ─── NAV Chart Component ─────────────────────────────────────────────
function NavChart({ data }: { data: NavPoint[] }) {
  if (data.length < 2) return null

  const navs = data.map((d) => d.nav)
  const min = Math.min(...navs)
  const max = Math.max(...navs)
  const range = max - min || 1

  const width = 700
  const height = 200
  const padX = 40
  const padY = 20
  const chartW = width - padX * 2
  const chartH = height - padY * 2

  const points = data.map((d, i) => {
    const x = padX + (i / (data.length - 1)) * chartW
    const y = padY + chartH - ((d.nav - min) / range) * chartH
    return `${x},${y}`
  })

  const areaPoints = [...points, `${padX + chartW},${padY + chartH}`, `${padX},${padY + chartH}`]

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padY + chartH * (1 - pct)
          const val = min + range * pct
          return (
            <g key={pct}>
              <line x1={padX} y1={y} x2={padX + chartW} y2={y} stroke="#f4f4f5" strokeWidth="1" />
              <text x={padX - 6} y={y + 3} textAnchor="end" className="text-[8px] fill-zinc-300 font-mono">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          )
        })}
        {/* Area */}
        <polygon points={areaPoints.join(" ")} fill="url(#navGrad)" />
        {/* Line */}
        <polyline points={points.join(" ")} fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {data.map((d, i) => {
          const x = padX + (i / (data.length - 1)) * chartW
          const y = padY + chartH - ((d.nav - min) / range) * chartH
          return <circle key={i} cx={x} cy={y} r="4" fill="#10B981" stroke="white" strokeWidth="2" />
        })}
      </svg>
      <div className="flex justify-between text-[9px] font-mono text-zinc-300 uppercase tracking-wider px-2">
        {data.length > 0 && <span>{new Date(data[0].time).toLocaleDateString()}</span>}
        {data.length > 1 && <span>{new Date(data[data.length - 1].time).toLocaleDateString()}</span>}
      </div>
    </div>
  )
}
