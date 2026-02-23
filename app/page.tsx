'use client'

import React from "react"
import { motion } from "motion/react"
import {
  ExternalLink,
  Sparkles,
  Clock,
  Heart,
  Languages,
  Zap,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import PortfolioLayout from "./_components/PortfolioLayout"

interface Project {
  id: string
  name: string
  subtitle: string
  description: string
  tags: string[]
  status: "live" | "soon"
  icon: LucideIcon
  accentColor: string
  lightAccentColor: string
  link?: string
}

const projects: Project[] = [
  {
    id: "aibaji",
    name: "爱巴基",
    subtitle: "AI 情感陪伴助手",
    description: "基于大语言模型的赛博好友，提供温暖的角色扮演与深度对话体验。支持多种人格设定，让 AI 更有温度。",
    tags: ["AI", "聊天", "角色扮演"],
    status: "live",
    icon: Heart,
    accentColor: "#EC4899",
    lightAccentColor: "#FDF2F8",
    link: "/project/aibaji",
  },
  {
    id: "project-2",
    name: "语感实验室",
    subtitle: "沉浸式语言学习工具",
    description: "通过真实的语境模拟，帮助你建立直觉般的语言感知力。目前正在进行最后的交互优化。",
    tags: ["教育", "效率", "AI"],
    status: "soon",
    icon: Languages,
    accentColor: "#06B6D4",
    lightAccentColor: "#ECFEFF",
  },
  {
    id: "project-3",
    name: "灵感捕手",
    subtitle: "极简主义笔记应用",
    description: "专注于捕捉瞬间的火花，无压力输入，自动化的知识整理。灵感酝酿中，敬请期待。",
    tags: ["工具", "笔记", "极简"],
    status: "soon",
    icon: Zap,
    accentColor: "#F59E0B",
    lightAccentColor: "#FFFBEB",
  },
]

const ProjectCard = ({ project }: { project: Project }) => {
  const isLive = project.status === "live"
  const Icon = project.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-20px" }}
      transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
      whileHover={isLive ? {
        y: -12,
        scale: 1.02,
        borderColor: `${project.accentColor}60`,
        boxShadow: `0 40px 80px -20px ${project.accentColor}25, 0 0 30px -5px ${project.accentColor}10`,
        transition: { type: "spring", stiffness: 400, damping: 30 }
      } : {}}
      className={`relative group p-6 md:p-12 rounded-[2.5rem] md:rounded-[3rem] border ${
        isLive
          ? "bg-white border-zinc-200/40 shadow-[0_20px_50px_rgba(0,0,0,0.01)] cursor-pointer"
          : "bg-zinc-50/30 border-zinc-200/50 opacity-50 grayscale cursor-default"
      }`}
    >
      <div className={`flex flex-col sm:flex-row justify-between items-start gap-6 md:gap-8 ${isLive ? "mb-8" : "mb-6"}`}>
        <div className="flex items-center gap-4 md:gap-8">
          <motion.div
            whileHover={isLive ? { scale: 1.05, rotate: 2 } : {}}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 flex items-center justify-center rounded-[1.25rem] md:rounded-[1.5rem] border transition-all duration-200 shadow-sm"
            style={{
              backgroundColor: isLive ? project.lightAccentColor : "#F4F4F5",
              borderColor: isLive ? `${project.accentColor}10` : "#E4E4E7",
              color: isLive ? project.accentColor : "#71717A",
            }}
          >
            <Icon className="w-8 h-8 md:w-10 md:h-10" />
          </motion.div>
          <div>
            <div className="flex items-center gap-3 md:gap-4 mb-2 md:mb-3">
              <span className="text-[9px] md:text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.3em] bg-zinc-50 px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg border border-zinc-100">
                Exp. {project.id.slice(0, 3).toUpperCase()}
              </span>
              {isLive && <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" style={{ color: project.accentColor }} />}
            </div>
            <h3 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight leading-none">
              {project.name}
            </h3>
            <p className="text-[10px] md:text-[12px] text-zinc-400 font-black uppercase tracking-[0.3em] mt-2 md:mt-3">
              {project.subtitle}
            </p>
          </div>
        </div>

        <motion.div
          whileHover={isLive ? { scale: 1.05, backgroundColor: `${project.accentColor}15` } : { scale: 1.02 }}
          animate={isLive ? {
            boxShadow: [
              `0 0 0px ${project.accentColor}00`,
              `0 0 12px ${project.accentColor}20`,
              `0 0 0px ${project.accentColor}00`,
            ],
          } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="px-4 py-2 md:px-6 md:py-2.5 rounded-full text-[10px] md:text-[11px] uppercase tracking-[0.25em] font-black flex items-center gap-2 md:gap-3 border shadow-sm transition-colors duration-200"
          style={{
            backgroundColor: isLive ? `${project.accentColor}05` : "#F4F4F5",
            color: isLive ? project.accentColor : "#A1A1AA",
            borderColor: isLive ? `${project.accentColor}10` : "#E4E4E7",
          }}
        >
          {isLive ? (
            <>
              <span className="relative flex h-2 w-2 md:h-2.5 md:w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: project.accentColor }} />
                <span className="relative inline-flex rounded-full h-2 w-2 md:h-2.5 md:w-2.5" style={{ backgroundColor: project.accentColor }} />
              </span>
              Active
            </>
          ) : (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
              >
                <Clock className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </motion.div>
              Pending
            </>
          )}
        </motion.div>
      </div>

      <motion.p
        whileHover={isLive ? { color: "#27272a" } : {}}
        transition={{ duration: 0.2 }}
        className={`text-zinc-500 text-base md:text-lg leading-relaxed font-medium max-w-2xl transition-colors duration-200 ${isLive ? "mb-8" : "mb-6"}`}
      >
        {project.description}
      </motion.p>

      <div className={`flex flex-wrap gap-2 md:gap-3 ${isLive ? "mb-8" : "mb-0"}`}>
        {project.tags.map((tag, index) => (
          <motion.span
            key={tag}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 + index * 0.05 }}
            whileHover={{
              scale: 1.05,
              backgroundColor: isLive ? `${project.accentColor}15` : "rgba(0,0,0,0.08)",
              color: isLive ? project.accentColor : "#18181b",
              borderColor: isLive ? `${project.accentColor}30` : "rgba(0,0,0,0.2)",
            }}
            className="px-4 py-2 md:px-6 md:py-2.5 rounded-xl md:rounded-2xl bg-zinc-50/50 text-zinc-400 text-[10px] md:text-[11px] font-black border border-zinc-100/50 uppercase tracking-widest cursor-default transition-colors duration-200"
          >
            {tag}
          </motion.span>
        ))}
      </div>

      {isLive && (
        <div className="flex flex-wrap items-center gap-x-4 md:gap-x-6 gap-y-2 mb-8 border-t border-zinc-100/50 pt-6">
          <span className="text-[7px] md:text-[8px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">ChatGPT Codex 5.3</span>
          <span className="text-[7px] md:text-[8px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Claude Code Opus 4.6</span>
          <span className="text-[7px] md:text-[8px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Gemini 3.1</span>
        </div>
      )}

      {isLive && (
        <Link
          href={project.link || "#"}
          className="relative inline-flex items-center justify-center gap-4 md:gap-5 px-8 py-4 md:px-12 md:py-6 rounded-2xl md:rounded-[2rem] text-xs md:text-sm font-black transition-all duration-200 group/btn shadow-[0_15px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_30px_60px_rgba(0,0,0,0.1)] active:scale-95 overflow-hidden w-full sm:w-auto"
          style={{ backgroundColor: project.accentColor, color: "white" }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-[shine_1.5s_ease-in-out_infinite]" />
          <span className="relative z-10 flex items-center gap-5">
            Explore Experiment
            <ExternalLink className="w-5 h-5 transition-transform group-hover/btn:translate-x-1 group-hover/btn:-translate-y-1" />
          </span>
        </Link>
      )}
    </motion.div>
  )
}

export default function PortfolioPage() {
  return (
    <PortfolioLayout>
      {/* Header */}
      <header className="flex flex-col items-center text-center gap-6 md:gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-4 md:space-y-6"
        >
          <div className="inline-block px-5 py-2 md:px-6 md:py-2.5 rounded-full bg-zinc-900 text-white text-[9px] md:text-[10px] font-black uppercase tracking-[0.4em] md:tracking-[0.6em] mb-2 md:mb-4 shadow-2xl">
            AI Native Lab
          </div>
          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-[10rem] font-black tracking-tighter text-zinc-900 leading-none">
            xuxuxu
            <motion.span
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="text-emerald-500"
            >
              .
            </motion.span>
          </h1>
          <div className="flex items-center justify-center gap-4 md:gap-8">
            <div className="h-px w-12 md:w-20 bg-zinc-200" />
            <p className="text-zinc-400 text-[10px] sm:text-sm md:text-xl font-black uppercase tracking-[0.4em] md:tracking-[0.6em]">
              未知与你，凝结生长
            </p>
            <div className="h-px w-12 md:w-20 bg-zinc-200" />
          </div>
        </motion.div>
      </header>

      {/* Philosophy Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 py-12 border-y border-zinc-200/40">
        <div className="space-y-4 md:space-y-6">
          <div className="flex items-center gap-4 md:gap-5">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-zinc-900 text-white flex items-center justify-center font-black text-lg md:text-xl shadow-xl">
              X
            </div>
            <h4 className="font-black uppercase tracking-[0.4em] text-[10px] md:text-xs text-zinc-400">The Unknown (AI)</h4>
          </div>
          <p className="text-zinc-500 text-lg md:text-xl leading-relaxed font-semibold">
            无限的可能，实验的起点。
          </p>
        </div>
        <div className="space-y-4 md:space-y-6">
          <div className="flex items-center gap-4 md:gap-5">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-zinc-100 border border-zinc-200 text-zinc-900 flex items-center justify-center font-black text-lg md:text-xl shadow-sm">
              U
            </div>
            <h4 className="font-black uppercase tracking-[0.4em] text-[10px] md:text-xs text-zinc-400">You (Humanity)</h4>
          </div>
          <p className="text-zinc-500 text-lg md:text-xl leading-relaxed font-semibold">
            感知的回归，实验的终点。
          </p>
        </div>
        <div className="md:col-span-2 flex flex-col items-center gap-4 md:gap-6 pt-8">
          <div className="w-10 md:w-12 h-px bg-zinc-100" />
          <p className="text-[9px] md:text-[10px] font-black text-zinc-300 uppercase tracking-[0.4em] md:tracking-[0.6em] text-center leading-loose max-w-md">
            All design, content, and code are synthesized by Artificial Intelligence
          </p>
        </div>
      </section>

      {/* Project List */}
      <section className="flex flex-col gap-12">
        <div className="flex items-center gap-8 mb-6">
          <h2 className="text-xs font-black uppercase tracking-[0.8em] text-zinc-300">Current Experiments</h2>
          <div className="flex-1 h-px bg-zinc-100" />
        </div>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </section>
    </PortfolioLayout>
  )
}
