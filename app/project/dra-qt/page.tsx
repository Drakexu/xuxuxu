'use client'

import React from "react"
import { motion } from "motion/react"
import {
  Sparkles,
  TrendingUp,
  ArrowLeft,
  BarChart3,
  Brain,
  Shield,
  Clock,
  Layers,
  Activity,
} from "lucide-react"
import { useRouter } from "next/navigation"
import PortfolioLayout from "@/app/_components/PortfolioLayout"

export default function DraQTPage() {
  const router = useRouter()

  return (
    <PortfolioLayout>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="relative space-y-12 md:space-y-20"
      >
        {/* Page Specific Background Blobs */}
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.1, 0.2, 0.1],
              x: [0, 50, 0],
              y: [0, -30, 0],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 right-[-10%] w-[50%] h-[50%] bg-emerald-200/20 blur-[120px] rounded-full"
          />
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.05, 0.15, 0.05],
              x: [0, -40, 0],
              y: [0, 60, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-0 left-[-5%] w-[40%] h-[40%] bg-teal-200/10 blur-[100px] rounded-full"
          />
        </div>

        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="group flex items-center gap-3 text-zinc-400 hover:text-zinc-900 transition-colors font-black uppercase tracking-widest text-[10px]"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          Back to Experiments
        </button>

        {/* Hero Section */}
        <section className="space-y-8">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-8">
            <motion.div
              animate={{ rotate: [0, 2, -2, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="w-32 h-32 md:w-48 md:h-48 rounded-[2.5rem] md:rounded-[4rem] bg-emerald-50 flex items-center justify-center border border-emerald-100 shadow-xl"
            >
              <TrendingUp className="w-16 h-16 md:w-24 md:h-24 text-emerald-500" />
            </motion.div>
            <div className="text-center md:text-left space-y-4">
              <div className="flex items-center justify-center md:justify-start gap-4">
                <span className="px-4 py-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest">
                  Active Experiment
                </span>
                <span className="text-emerald-500 flex items-center gap-2 text-[10px] font-mono font-black uppercase tracking-widest">
                  <Sparkles className="w-3 h-3" />
                  v1.0
                </span>
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-zinc-900 tracking-tighter">Dra.QT</h1>
              <p className="text-xl md:text-2xl text-zinc-400 font-black uppercase tracking-[0.2em]">AI 量化交易实验</p>
            </div>
          </div>
        </section>

        {/* Stats Banner */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Horizons", value: "6", detail: "1d → 30d" },
            { label: "Factors", value: "38", detail: "量价 + 宏观" },
            { label: "Models", value: "LightGBM", detail: "每周期独立" },
            { label: "Symbols", value: "15+", detail: "科技股 + ETF" },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-[1.5rem] bg-white border border-zinc-100 shadow-sm text-center"
            >
              <p className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">{stat.value}</p>
              <p className="text-[9px] font-mono font-black text-emerald-500 uppercase tracking-widest mt-1">{stat.label}</p>
              <p className="text-[9px] text-zinc-400 font-black uppercase tracking-wider mt-0.5">{stat.detail}</p>
            </motion.div>
          ))}
        </section>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column: Description & Features */}
          <div className="lg:col-span-2 space-y-12">
            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Overview
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <p className="text-xl md:text-2xl text-zinc-600 leading-relaxed font-medium">
                Dra.QT 不是一个传统的量化回测工具。它用 6 个独立的机器学习模型，分别从 1 天到 30 天的视角观察市场，当多个周期对同一只股票达成共识时，才产生交易信号。像一个由 6 位分析师组成的投票委员会。
              </p>
            </section>

            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Core Architecture
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {[
                  {
                    title: "多周期共振",
                    desc: "6 个时间维度独立预测，跨周期一致性 = 高置信度。5/6 周期同意才是强信号。",
                    icon: Layers,
                  },
                  {
                    title: "量价交互因子",
                    desc: "CMF 资金流、波峰量比、MACD 共识时长、量价背离检测 — 识别主力行为。",
                    icon: Activity,
                  },
                  {
                    title: "宏观因子注入",
                    desc: "VIX 恐慌指数、美债利率、黄金/债券动量 — 让模型感知市场大环境。",
                    icon: BarChart3,
                  },
                  {
                    title: "事件日历风控",
                    desc: "财报日、FOMC 会议自动降仓，已知高风险日期提前规避。",
                    icon: Shield,
                  },
                ].map((feature, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    whileHover={{ y: -4, borderColor: "#10B98130" }}
                    className="p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm space-y-4 transition-all duration-200"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                      <feature.icon className="w-6 h-6 text-emerald-500" />
                    </div>
                    <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">{feature.title}</h3>
                    <p className="text-zinc-500 text-sm leading-relaxed">{feature.desc}</p>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* Pipeline */}
            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Daily Pipeline
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <div className="space-y-4">
                {[
                  { time: "09:00", label: "数据刷新", desc: "补漏近 7 天市场数据" },
                  { time: "13:30", label: "模型预测", desc: "6 个 horizon 独立推理 → 共振评分 → 选股" },
                  { time: "13:31", label: "信号推送", desc: "飞书报告 + Web Dashboard 更新" },
                  { time: "周日 14:00", label: "模型重训", desc: "全量数据 Walk-Forward 重新训练" },
                ].map((step, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-start gap-6 p-6 rounded-2xl hover:bg-zinc-50/50 transition-colors"
                  >
                    <span className="text-[10px] font-mono font-black text-emerald-500 uppercase tracking-wider whitespace-nowrap min-w-[80px]">
                      {step.time}
                    </span>
                    <div>
                      <h4 className="text-sm font-black text-zinc-900 uppercase tracking-tight">{step.label}</h4>
                      <p className="text-zinc-500 text-xs mt-1">{step.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Sidebar */}
          <div className="space-y-12">
            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Tech Stack
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <div className="space-y-4">
                {[
                  { label: "ML Engine", value: "LightGBM + scikit-learn" },
                  { label: "Factor Engine", value: "YAML 声明式 + AST 安全解析" },
                  { label: "Data", value: "yfinance + pandas" },
                  { label: "Backend", value: "FastAPI + SQLAlchemy" },
                  { label: "Orchestration", value: "OpenClaw Cron" },
                  { label: "Notification", value: "Feishu Webhook" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">{item.label}</span>
                    <span className="text-xs font-black text-zinc-600 uppercase tracking-wider">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Model Performance
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <div className="space-y-3">
                {[
                  { horizon: "1d", ic: "+0.056" },
                  { horizon: "3d", ic: "+0.112" },
                  { horizon: "5d", ic: "+0.165" },
                  { horizon: "10d", ic: "+0.187" },
                  { horizon: "20d", ic: "+0.248" },
                  { horizon: "30d", ic: "+0.328" },
                ].map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-zinc-50/50 border border-zinc-100/50">
                    <span className="text-[10px] font-mono font-black text-zinc-400 uppercase tracking-wider">{m.horizon}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${Math.min(parseFloat(m.ic) / 0.35 * 100, 100)}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.1, duration: 0.6 }}
                          className="h-full bg-emerald-500 rounded-full"
                        />
                      </div>
                      <span className="text-[10px] font-mono font-black text-emerald-600 tracking-wider">IC {m.ic}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="p-8 rounded-[2.5rem] bg-zinc-900 text-white space-y-6 shadow-2xl">
              <div className="flex items-center gap-4">
                <Brain className="w-6 h-6 text-emerald-500" />
                <h3 className="text-sm font-black uppercase tracking-widest">VPI 因子系统</h3>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed uppercase tracking-wider">
                Volume-Price Interaction：将实战交易经验系统化为可量化因子。主力吸筹、量价背离、共识时长 — 机器学会了看盘。
              </p>
              <div className="space-y-2">
                {["CMF 资金流", "波峰量比", "MACD 共识时长", "量价背离", "OBV 趋势"].map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-black text-zinc-300 uppercase tracking-wider">{f}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* Resonance Explanation */}
        <section className="pt-12">
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
                {["1d", "3d", "5d", "10d", "20d", "30d"].map((h) => (
                  <motion.span
                    key={h}
                    whileHover={{ scale: 1.1, backgroundColor: "rgba(255,255,255,0.3)" }}
                    className="px-6 py-3 rounded-2xl bg-white/10 text-sm font-black uppercase tracking-widest backdrop-blur-sm border border-white/10"
                  >
                    {h}
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
