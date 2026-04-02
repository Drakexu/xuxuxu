'use client'

import React, { useEffect, useState, useCallback } from "react"
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
  Zap,
  Newspaper,
  ExternalLink,
  Calendar,
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

interface NewsItem {
  id: string
  headline: string
  summary: string
  source: string
  url: string
  symbols: string[]
  severity: "urgent" | "important" | "routine"
  direction: "bullish" | "bearish" | "uncertain"
  sector: string | null
  created_at: string
}

interface NewsData {
  timestamp: string
  news: NewsItem[]
}

interface EarningsEvent {
  symbol: string
  date: string
  type: string
  eps_estimate: number
  revenue_estimate: number
  hour?: string
  source: string
}

interface EarningsCalendar {
  updated_at: string
  events: EarningsEvent[]
}

// ─── Alpaca types ────────────────────────────────────────────────────
interface AlpacaAccount {
  equity: string
  buying_power: string
  cash: string
  portfolio_value: string
  last_equity: string
}

interface AlpacaPosition {
  symbol: string
  qty: string
  avg_entry_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_plpc: string
  side: string
}

interface AlpacaOrder {
  id: string
  symbol: string
  side: string
  qty: string
  filled_qty: string
  type: string
  status: string
  submitted_at: string
  filled_at: string | null
  filled_avg_price: string | null
  limit_price: string | null
}

interface IntradaySignal {
  symbol: string
  action: string
  confidence: number
  prediction: number
  timestamp: string
  resonance_ratio?: number
  appearances?: number
  total_horizons?: number
}

interface IntradaySignals {
  timestamp: string
  signals: IntradaySignal[]
}

// ─── Helpers ─────────────────────────────────────────────────────────
const DATA_BASE = "/api/dra-qt"
const ALPACA_BASE = "/api/dra-qt/alpaca"

async function fetchJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${file}?t=${Date.now()}`, { cache: "no-store" })
    if (res.ok) return res.json()
  } catch { /* ignore */ }
  return null
}

async function fetchAlpaca<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  try {
    const url = new URL(`${ALPACA_BASE}/${path}`, window.location.origin)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    url.searchParams.set("t", String(Date.now()))
    const res = await fetch(url.toString(), { cache: "no-store" })
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

// ─── Section Header ──────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
      {title}
      <div className="flex-1 h-px bg-zinc-100" />
    </h2>
  )
}

// ─── Tab type ────────────────────────────────────────────────────────
type TabKey = "daily" | "intraday"

// ─── Main Page ───────────────────────────────────────────────────────
export default function DraQTDashboard() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabKey>("daily")

  // Daily state
  const [account, setAccount] = useState<Account | null>(null)
  const [portfolio, setPortfolio] = useState<Position[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [navHistory, setNavHistory] = useState<NavPoint[]>([])
  const [signals, setSignals] = useState<Signals | null>(null)
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [indices, setIndices] = useState<IndexData[]>([])
  const [newsData, setNewsData] = useState<NewsItem[]>([])
  const [newsExpanded, setNewsExpanded] = useState(false)
  const [earningsEvents, setEarningsEvents] = useState<EarningsEvent[]>([])

  // Intraday state
  const [alpacaAccount, setAlpacaAccount] = useState<AlpacaAccount | null>(null)
  const [alpacaPositions, setAlpacaPositions] = useState<AlpacaPosition[]>([])
  const [alpacaOrders, setAlpacaOrders] = useState<AlpacaOrder[]>([])
  const [intradaySignals, setIntradaySignals] = useState<IntradaySignals | null>(null)

  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const REFRESH_INTERVAL = 30

  const loadDaily = useCallback(async () => {
    await Promise.all([
      fetchJson<Account>("account.json").then(setAccount),
      fetchJson<Position[]>("portfolio.json").then((d) => setPortfolio(d ?? [])),
      fetchJson<Order[]>("orders.json").then((d) => setOrders(d ?? [])),
      fetchJson<NavPoint[]>("nav_history.json").then((d) => setNavHistory(d ?? [])),
      fetchJson<Signals>("signals.json").then(setSignals),
      fetchJson<Metadata>("metadata.json").then(setMetadata),
      fetchJson<IndexData[]>("indices.json").then((d) => setIndices(d ?? [])),
      fetchJson<NewsData>("news.json").then((d) => setNewsData(d?.news ?? [])),
      fetchJson<EarningsCalendar>("earnings_calendar.json").then((d) => setEarningsEvents(d?.events ?? [])),
    ])
  }, [])

  const loadIntraday = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    await Promise.all([
      fetchAlpaca<AlpacaAccount>("account").then(setAlpacaAccount),
      fetchAlpaca<AlpacaPosition[]>("positions").then((d) => setAlpacaPositions(d ?? [])),
      fetchAlpaca<AlpacaOrder[]>("orders", { status: "all", after: `${today}T00:00:00Z`, direction: "desc", limit: "50" }).then((d) => setAlpacaOrders(d ?? [])),
      fetchJson<IntradaySignals>("intraday_signals.json").then(setIntradaySignals),
    ])
  }, [])

  const loadData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    if (activeTab === "daily") {
      await loadDaily()
    } else {
      await loadIntraday()
    }
    setLastRefresh(new Date())
    setSecondsAgo(0)
    if (manual) setRefreshing(false)
  }, [activeTab, loadDaily, loadIntraday])

  useEffect(() => {
    setLoading(true)
    loadData().finally(() => setLoading(false))
    const interval = setInterval(() => loadData(), REFRESH_INTERVAL * 1000)
    return () => clearInterval(interval)
  }, [loadData])

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
            className={`absolute top-0 right-[-10%] w-[50%] h-[50%] ${activeTab === "daily" ? "bg-emerald-200/20" : "bg-violet-200/20"} blur-[120px] rounded-full`}
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
              className={`w-28 h-28 md:w-40 md:h-40 rounded-[2.5rem] md:rounded-[3.5rem] ${activeTab === "daily" ? "bg-emerald-50 border-emerald-100" : "bg-violet-50 border-violet-100"} flex items-center justify-center border shadow-xl`}
            >
              {activeTab === "daily"
                ? <TrendingUp className="w-14 h-14 md:w-20 md:h-20 text-emerald-500" />
                : <Zap className="w-14 h-14 md:w-20 md:h-20 text-violet-500" />
              }
            </motion.div>
            <div className="text-center md:text-left space-y-3">
              <div className="flex items-center justify-center md:justify-start gap-4">
                <span className={`px-4 py-1.5 rounded-full text-white text-[10px] font-black uppercase tracking-widest ${activeTab === "daily" ? "bg-emerald-500" : "bg-violet-500"}`}>
                  Live Dashboard
                </span>
              </div>
              <h1 className="text-5xl md:text-7xl font-black text-zinc-900 tracking-tighter">Dra.QT</h1>
              <p className="text-lg md:text-xl text-zinc-400 font-black uppercase tracking-[0.2em]">
                AI 量化交易实验
              </p>
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-2xl w-fit mx-auto md:mx-0">
            {([
              { key: "daily" as TabKey, label: "日盘策略", icon: TrendingUp },
              { key: "intraday" as TabKey, label: "分钟级量化", icon: Zap },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  activeTab === tab.key
                    ? tab.key === "daily"
                      ? "bg-white text-emerald-600 shadow-sm"
                      : "bg-white text-violet-600 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-600"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Refresh controls */}
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-center md:justify-start">
            {activeTab === "daily" && metadata && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-300 uppercase tracking-wider">
                <Clock className="w-3 h-3" />
                Data: {new Date(metadata.last_updated).toLocaleString()}
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeTab === "daily" ? "bg-emerald-400" : "bg-violet-400"}`} />
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${activeTab === "daily" ? "bg-emerald-500" : "bg-violet-500"}`} />
                </span>
                {secondsAgo < REFRESH_INTERVAL
                  ? <span className={activeTab === "daily" ? "text-emerald-600" : "text-violet-600"}>{REFRESH_INTERVAL - secondsAgo}s</span>
                  : <span className="text-zinc-300">refreshing…</span>
                }
              </div>
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

        {/* ════════════════════════════════════════════════════════════ */}
        {/*  日盘策略 Tab                                               */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === "daily" && (
          <>
            {/* Account Overview Cards */}
            {account && (
              <section className="space-y-6">
                <SectionHeader title="Account Overview" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "NAV", value: `$${fmtShort(account.nav)}`, icon: DollarSign, detail: `Initial $${fmtShort(account.initial)}` },
                    { label: "Total P&L", value: `${account.total_pnl >= 0 ? "+" : ""}$${fmtShort(account.total_pnl)}`, icon: account.total_pnl >= 0 ? TrendingUp : TrendingDown, detail: `Trading Day ${account.daily_pnl >= 0 ? "+" : ""}$${fmtShort(account.daily_pnl)}`, color: account.total_pnl >= 0, detailColor: account.daily_pnl },
                    { label: "Total Return", value: `${account.total_return_pct >= 0 ? "+" : ""}${fmt(account.total_return_pct, 2)}%`, icon: Activity, detail: `Trading Day ${account.daily_return_pct >= 0 ? "+" : ""}${fmt(account.daily_return_pct, 2)}%`, color: account.total_return_pct >= 0, detailColor: account.daily_return_pct },
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

            {/* US Market Indices */}
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
                        <p className={`text-lg font-black tracking-tight ${idx.change >= 0 ? "text-emerald-600" : "text-red-500"}`}>{idx.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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

            {/* NAV Chart */}
            {navHistory.length > 1 && (
              <section className="space-y-6">
                <SectionHeader title="NAV History" />
                <div className="p-6 md:p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm">
                  <NavChart data={navHistory} />
                </div>
              </section>
            )}

            {/* Portfolio Table */}
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

            {/* Orders Table */}
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

            {/* Resonance Signals */}
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

            {/* ─── News Monitor ─── */}
            <section className="space-y-6">
              <SectionHeader title="News Monitor" />
              <div className="p-6 md:p-8 rounded-2xl bg-white/5 border border-white/10">
                {newsData.length === 0 ? (
                  <p className="text-sm text-zinc-400 font-mono text-center py-8">暂无新闻数据</p>
                ) : (
                  <div className="space-y-1">
                    {(newsExpanded ? newsData : newsData.slice(0, 10)).map((item, i) => {
                      const ago = (() => {
                        const diff = Date.now() - new Date(item.created_at).getTime()
                        const mins = Math.floor(diff / 60000)
                        if (mins < 60) return `${mins}m`
                        const hrs = Math.floor(mins / 60)
                        if (hrs < 24) return `${hrs}h`
                        return `${Math.floor(hrs / 24)}d`
                      })()
                      const severityIcon = item.severity === "urgent" ? "🔴" : item.severity === "important" ? "🟡" : "🟢"
                      const dirColor = item.direction === "bullish" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : item.direction === "bearish" ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"
                      return (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0 group"
                        >
                          <span className="text-sm mt-0.5 shrink-0">{severityIcon}</span>
                          <span className="text-[10px] font-mono text-zinc-400 mt-1 w-8 shrink-0">{ago}</span>
                          <div className="flex-1 min-w-0">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={item.summary}
                              className="text-sm text-zinc-200 hover:text-white transition-colors leading-snug line-clamp-2 group-hover:underline decoration-zinc-500"
                            >
                              {item.headline}
                              <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
                            </a>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${dirColor}`}>
                                {item.direction}
                              </span>
                              {item.symbols.slice(0, 4).map((sym) => (
                                <span key={sym} className="text-[9px] font-mono text-zinc-400 bg-zinc-800/50 px-1.5 py-0.5 rounded">
                                  {sym}
                                </span>
                              ))}
                              {item.symbols.length > 4 && (
                                <span className="text-[9px] text-zinc-500">+{item.symbols.length - 4}</span>
                              )}
                              <span className="text-[9px] text-zinc-500 ml-auto">{item.source}</span>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                    {newsData.length > 10 && (
                      <button
                        onClick={() => setNewsExpanded(!newsExpanded)}
                        className="w-full pt-3 text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-colors flex items-center justify-center gap-1"
                      >
                        {newsExpanded ? (
                          <><ChevronUp className="w-3 h-3" /> 收起</>  
                        ) : (
                          <><ChevronDown className="w-3 h-3" /> 展开全部 ({newsData.length} 条)</>  
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* ─── Earnings Calendar ─── */}
            {earningsEvents.length > 0 && (() => {
              const today = new Date().toISOString().slice(0, 10)
              const futureEvents = earningsEvents
                .filter((e) => e.date >= today)
                .sort((a, b) => a.date.localeCompare(b.date))
              if (futureEvents.length === 0) return null
              const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
              return (
                <section className="space-y-6">
                  <SectionHeader title="Earnings Calendar" />
                  <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-zinc-50">
                            {["Symbol", "Date", "Time", "EPS Est."].map((h) => (
                              <th key={h} className="px-6 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {futureEvents.map((ev, i) => {
                            const daysUntil = (new Date(ev.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                            const isSoon = daysUntil <= 7 && daysUntil >= 0
                            return (
                              <motion.tr
                                key={`${ev.symbol}-${ev.date}`}
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.03 }}
                                className={`border-b border-zinc-50/50 ${isSoon ? "bg-amber-50/60" : ""}`}
                              >
                                <td className="px-6 py-3.5">
                                  <span className={`font-black text-sm tracking-tight ${isSoon ? "text-amber-700" : "text-zinc-900"}`}>{ev.symbol}</span>
                                </td>
                                <td className="px-6 py-3.5">
                                  <span className={`text-xs font-mono ${isSoon ? "text-amber-600 font-bold" : "text-zinc-500"}`}>
                                    {ev.date}
                                    {isSoon && <span className="ml-1.5 text-[9px] text-amber-500 font-black uppercase">({Math.ceil(daysUntil)}d)</span>}
                                  </span>
                                </td>
                                <td className="px-6 py-3.5">
                                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                                    ev.hour === "bmo" ? "text-sky-500" : ev.hour === "amc" ? "text-violet-500" : "text-zinc-300"
                                  }`}>
                                    {ev.hour === "bmo" ? "盘前" : ev.hour === "amc" ? "盘后" : "—"}
                                  </span>
                                </td>
                                <td className="px-6 py-3.5">
                                  <span className="text-xs font-mono font-bold text-zinc-700">${fmt(ev.eps_estimate, 2)}</span>
                                </td>
                              </motion.tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )
            })()}

            {/* Resonance CTA */}
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
          </>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/*  分钟级量化 Tab                                             */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === "intraday" && (
          <>
            {/* Intraday Account Overview */}
            {alpacaAccount && (
              <section className="space-y-6">
                <SectionHeader title="Intraday Account" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(() => {
                    const equity = parseFloat(alpacaAccount.equity)
                    const lastEquity = parseFloat(alpacaAccount.last_equity)
                    const cash = parseFloat(alpacaAccount.cash)
                    const buyingPower = parseFloat(alpacaAccount.buying_power)
                    const initialCapital = 100000
                    const dayPnl = equity - lastEquity
                    const dayPct = lastEquity ? (dayPnl / lastEquity) * 100 : 0
                    const totalPnl = equity - initialCapital
                    const totalPct = (totalPnl / initialCapital) * 100
                    return [
                      { label: "Equity", value: `$${fmtShort(equity)}`, icon: DollarSign, detail: `Last close $${fmtShort(lastEquity)}` },
                      { label: "累计损益", value: `${totalPnl >= 0 ? "+" : ""}$${fmtShort(totalPnl)}`, icon: totalPnl >= 0 ? TrendingUp : TrendingDown, detail: `本交易日 ${dayPnl >= 0 ? "+" : ""}$${fmtShort(dayPnl)}`, color: totalPnl >= 0, detailColor: dayPnl },
                      { label: "累计收益率", value: `${totalPct >= 0 ? "+" : ""}${fmt(totalPct, 2)}%`, icon: Activity, detail: `本交易日 ${dayPct >= 0 ? "+" : ""}${fmt(dayPct, 2)}%`, color: totalPct >= 0, detailColor: dayPnl },
                      { label: "Cash", value: `$${fmtShort(cash)}`, icon: Wallet, detail: `${fmt(cash / equity * 100, 1)}% of equity` },
                    ]
                  })().map((card, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.08 }}
                      className="p-5 md:p-6 rounded-[1.5rem] bg-white border border-zinc-100 shadow-sm space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <card.icon className={`w-4 h-4 ${card.color === false ? "text-red-400" : card.color === true ? "text-violet-500" : "text-zinc-300"}`} />
                        <span className="text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">{card.label}</span>
                      </div>
                      <p className={`text-2xl md:text-3xl font-black tracking-tight ${card.color === false ? "text-red-500" : card.color === true ? "text-violet-600" : "text-zinc-900"}`}>
                        {card.value}
                      </p>
                      <p className={`text-[11px] font-medium tracking-wide ${
                        card.detailColor !== undefined
                          ? card.detailColor > 0 ? "text-violet-500" : card.detailColor < 0 ? "text-red-400" : "text-zinc-400"
                          : "text-zinc-400"
                      }`}>{card.detail}</p>
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* Intraday Positions */}
            {alpacaPositions.length > 0 && (
              <section className="space-y-6">
                <SectionHeader title="Open Positions" />
                <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-zinc-50">
                          {["Symbol", "Qty", "Entry", "Price", "Value", "P&L", "P&L %"].map((h) => (
                            <th key={h} className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {alpacaPositions.map((p, i) => {
                          const pnl = parseFloat(p.unrealized_pl)
                          const pnlPct = parseFloat(p.unrealized_plpc) * 100
                          return (
                            <motion.tr
                              key={p.symbol}
                              initial={{ opacity: 0, x: -10 }}
                              whileInView={{ opacity: 1, x: 0 }}
                              viewport={{ once: true }}
                              transition={{ delay: i * 0.05 }}
                              className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                            >
                              <td className="px-5 py-4 text-sm font-black text-zinc-900 tracking-tight">{p.symbol}</td>
                              <td className="px-5 py-4 text-xs font-mono text-zinc-600">{parseFloat(p.qty)}</td>
                              <td className="px-5 py-4 text-xs font-mono text-zinc-600">${fmt(parseFloat(p.avg_entry_price))}</td>
                              <td className="px-5 py-4 text-xs font-mono text-zinc-600">${fmt(parseFloat(p.current_price))}</td>
                              <td className="px-5 py-4 text-xs font-mono text-zinc-900 font-bold">${fmt(parseFloat(p.market_value), 0)}</td>
                              <td className={`px-5 py-4 text-xs font-mono font-bold ${pnlColor(pnl)}`}>
                                {pnl >= 0 ? "+" : ""}{fmt(pnl)}
                              </td>
                              <td className={`px-5 py-4 text-xs font-mono font-bold ${pnlColor(pnl)}`}>
                                {pnlPct >= 0 ? "+" : ""}{fmt(pnlPct, 2)}%
                              </td>
                            </motion.tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
            {alpacaPositions.length === 0 && alpacaAccount && (
              <section className="space-y-6">
                <SectionHeader title="Open Positions" />
                <div className="p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm text-center">
                  <p className="text-sm text-zinc-400 font-mono">No open positions</p>
                </div>
              </section>
            )}

            {/* Today Signals */}
            {intradaySignals && intradaySignals.signals.length > 0 && (
              <section className="space-y-6">
                <SectionHeader title="Today Signals" />
                <p className="text-xs text-zinc-400">
                  Intraday multi-horizon consensus signals from the LightGBM minute-level model.
                </p>
                <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-zinc-50">
                          {["Symbol", "Action", "Confidence", "Prediction", "Resonance"].map((h) => (
                            <th key={h} className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {intradaySignals.signals.map((s, i) => (
                          <motion.tr
                            key={`${s.symbol}-${i}`}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.03 }}
                            className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                          >
                            <td className="px-5 py-3 text-sm font-black text-zinc-900 tracking-tight">{s.symbol}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase ${
                                s.action === "BUY" ? "bg-violet-50 text-violet-700" :
                                s.action === "SELL" ? "bg-red-50 text-red-600" :
                                "bg-zinc-50 text-zinc-500"
                              }`}>
                                {s.action}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(s.confidence * 100, 100)}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-zinc-400">{fmt(s.confidence * 100, 0)}%</span>
                              </div>
                            </td>
                            <td className={`px-5 py-3 text-xs font-mono font-bold ${pnlColor(s.prediction)}`}>
                              {s.prediction >= 0 ? "+" : ""}{(s.prediction * 100).toFixed(3)}%
                            </td>
                            <td className="px-5 py-3">
                              {s.resonance_ratio !== undefined ? (
                                <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold ${
                                  s.resonance_ratio >= 0.67 ? "bg-violet-50 text-violet-700" :
                                  s.resonance_ratio >= 0.33 ? "bg-amber-50 text-amber-700" :
                                  "bg-zinc-50 text-zinc-500"
                                }`}>
                                  {s.appearances ?? 0}/{s.total_horizons ?? 6}
                                </span>
                              ) : (
                                <span className="text-zinc-300">—</span>
                              )}
                            </td>
                          </motion.tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* Intraday Orders */}
            {alpacaOrders.length > 0 && (
              <section className="space-y-6">
                <SectionHeader title="Today Orders" />
                <div className="rounded-[2rem] bg-white border border-zinc-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-zinc-50">
                          {["Time", "Symbol", "Side", "Qty", "Filled", "Price", "Type", "Status"].map((h) => (
                            <th key={h} className="px-5 py-4 text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {alpacaOrders.map((o, i) => (
                          <motion.tr
                            key={o.id}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.03 }}
                            className="border-b border-zinc-50/50 hover:bg-zinc-50/30 transition-colors"
                          >
                            <td className="px-5 py-3 text-[10px] font-mono text-zinc-400 whitespace-nowrap">
                              {new Date(o.submitted_at).toLocaleString("zh-CN", { timeZone: "America/New_York", hour12: false })}
                            </td>
                            <td className="px-5 py-3 text-sm font-black text-zinc-900 tracking-tight">{o.symbol}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase ${
                                o.side === "buy" ? "bg-violet-50 text-violet-700" : "bg-red-50 text-red-600"
                              }`}>
                                {o.side}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-xs font-mono text-zinc-600">{parseFloat(o.qty)}</td>
                            <td className="px-5 py-3 text-xs font-mono text-zinc-600">{parseFloat(o.filled_qty)}</td>
                            <td className="px-5 py-3 text-xs font-mono text-zinc-600">
                              {o.filled_avg_price ? `$${fmt(parseFloat(o.filled_avg_price))}` : o.limit_price ? `$${fmt(parseFloat(o.limit_price))}` : "MKT"}
                            </td>
                            <td className="px-5 py-3 text-[10px] font-mono text-zinc-400 uppercase">{o.type}</td>
                            <td className="px-5 py-3">
                              <span className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold uppercase ${
                                o.status === "filled" ? "bg-violet-50 text-violet-700" :
                                o.status === "partially_filled" ? "bg-amber-50 text-amber-700" :
                                o.status === "canceled" || o.status === "expired" ? "bg-zinc-50 text-zinc-400" :
                                o.status === "rejected" ? "bg-red-50 text-red-600" :
                                o.status === "new" || o.status === "accepted" ? "bg-blue-50 text-blue-600" :
                                "bg-zinc-50 text-zinc-500"
                              }`}>
                                {o.status}
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
            {alpacaOrders.length === 0 && alpacaAccount && (
              <section className="space-y-6">
                <SectionHeader title="Today Orders" />
                <div className="p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm text-center">
                  <p className="text-sm text-zinc-400 font-mono">No orders today</p>
                </div>
              </section>
            )}

            {/* Intraday CTA */}
            <section className="pt-4">
              <div className="p-12 md:p-20 rounded-[3rem] md:rounded-[4rem] bg-violet-500 text-white text-center space-y-8 shadow-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-400 to-purple-600 opacity-50" />
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 4, repeat: Infinity }}
                  className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2"
                />
                <div className="relative z-10 space-y-6">
                  <h2 className="text-4xl md:text-6xl font-black tracking-tighter">分钟级 Alpha</h2>
                  <p className="text-violet-100 text-lg md:text-xl font-medium max-w-xl mx-auto">
                    24 个微观因子 × 6 个前瞻窗口 × LightGBM Walk-Forward。在噪音中捕捉信号。
                  </p>
                  <div className="flex flex-wrap justify-center gap-3 pt-4">
                    {["VWAP", "Momentum", "Microstructure", "Volatility", "VPI"].map((g) => (
                      <motion.span
                        key={g}
                        whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.3)" }}
                        className="px-6 py-3 rounded-2xl bg-white/10 text-sm font-black uppercase tracking-widest backdrop-blur-sm border border-white/10"
                      >
                        {g}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
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
