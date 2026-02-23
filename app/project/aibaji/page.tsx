'use client'

import React from "react"
import { motion } from "motion/react"
import {
  Sparkles,
  Clock,
  Heart,
  ArrowLeft,
  MessageCircle,
  User,
  Shield,
} from "lucide-react"
import { useRouter } from "next/navigation"
import PortfolioLayout from "@/app/_components/PortfolioLayout"

export default function AibajiPage() {
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
            className="absolute top-0 right-[-10%] w-[50%] h-[50%] bg-pink-200/20 blur-[120px] rounded-full"
          />
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.05, 0.15, 0.05],
              x: [0, -40, 0],
              y: [0, 60, 0],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-0 left-[-5%] w-[40%] h-[40%] bg-purple-200/10 blur-[100px] rounded-full"
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
            <div className="w-32 h-32 md:w-48 md:h-48 rounded-[2.5rem] md:rounded-[4rem] bg-pink-50 flex items-center justify-center border border-pink-100 shadow-xl">
              <Heart className="w-16 h-16 md:w-24 md:h-24 text-pink-500" />
            </div>
            <div className="text-center md:text-left space-y-4">
              <div className="flex items-center justify-center md:justify-start gap-4">
                <span className="px-4 py-1.5 rounded-full bg-pink-500 text-white text-[10px] font-black uppercase tracking-widest">
                  Active Experiment
                </span>
                <span className="text-pink-500 flex items-center gap-2 text-[10px] font-mono font-black uppercase tracking-widest">
                  <Sparkles className="w-3 h-3" />
                  v1.2.4
                </span>
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-zinc-900 tracking-tighter">爱巴基</h1>
              <p className="text-xl md:text-2xl text-zinc-400 font-black uppercase tracking-[0.2em]">AI 情感陪伴助手</p>
            </div>
          </div>
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
                爱巴基不仅仅是一个聊天机器人。它是一个能够感知情绪、理解语境并提供深度情感支持的赛博伙伴。通过多模态感知和长短期记忆系统，它能记住你的喜好、你的故事，甚至你的沉默。
              </p>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {[
                { title: "情绪共鸣", desc: "实时分析对话中的情感色彩，提供最贴心的回应。", icon: Heart },
                { title: "角色定制", desc: "从温柔的倾听者到毒舌的损友，性格由你定义。", icon: User },
                { title: "记忆系统", desc: "长短期记忆结合，让 AI 真正了解你的生活点滴。", icon: Clock },
                { title: "多维互动", desc: "支持语音、文字、表情包等多种交流方式。", icon: MessageCircle },
              ].map((feature, i) => (
                <div key={i} className="p-8 rounded-[2rem] bg-white border border-zinc-100 shadow-sm space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-zinc-50 flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-black text-zinc-900 uppercase tracking-tight">{feature.title}</h3>
                  <p className="text-zinc-500 text-sm leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </section>
          </div>

          {/* Right Column: Sidebar Info */}
          <div className="space-y-12">
            <section className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-[0.4em] text-zinc-300 flex items-center gap-4">
                Tech Stack
                <div className="flex-1 h-px bg-zinc-100" />
              </h2>
              <div className="space-y-4">
                {[
                  { label: "Requirements", value: "ChatGPT Codex 5.3" },
                  { label: "Core Logic", value: "Claude Code Opus 4.6" },
                  { label: "Interface", value: "Gemini 3.1" },
                  { label: "Database", value: "Supabase Realtime" },
                  { label: "Deployment", value: "Vercel Edge" },
                ].map((item, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest">{item.label}</span>
                    <span className="text-xs font-black text-zinc-600 uppercase tracking-wider">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="p-8 rounded-[2.5rem] bg-zinc-900 text-white space-y-6 shadow-2xl">
              <div className="flex items-center gap-4">
                <Shield className="w-6 h-6 text-emerald-500" />
                <h3 className="text-sm font-black uppercase tracking-widest">Privacy First</h3>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed uppercase tracking-wider">
                所有对话数据均经过端到端加密，您的隐私是我们实验的基石。
              </p>
              <button className="w-full py-4 rounded-2xl bg-white text-zinc-900 text-[10px] font-black uppercase tracking-[0.3em] hover:bg-zinc-100 transition-colors">
                Read Safety Report
              </button>
            </section>
          </div>
        </div>

        {/* CTA Section */}
        <section className="pt-12">
          <div className="p-12 md:p-20 rounded-[3rem] md:rounded-[4rem] bg-pink-500 text-white text-center space-y-8 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-pink-400 to-pink-600 opacity-50" />
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 4, repeat: Infinity }}
              className="absolute top-0 right-0 w-64 h-64 bg-white/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2"
            />
            <div className="relative z-10 space-y-6">
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter">准备好开始对话了吗？</h2>
              <p className="text-pink-100 text-lg md:text-xl font-medium max-w-xl mx-auto">
                加入 Alpha 测试计划，成为第一批拥有赛博伙伴的人。
              </p>
              <button
                onClick={() => router.push("/aibaji/square")}
                className="px-12 py-6 rounded-[2rem] bg-white text-pink-500 text-sm font-black uppercase tracking-[0.3em] hover:shadow-xl transition-all hover:scale-105 active:scale-95"
              >
                Launch Alpha v1.2
              </button>
            </div>
          </div>
        </section>
      </motion.div>
    </PortfolioLayout>
  )
}
