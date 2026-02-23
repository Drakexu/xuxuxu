/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "motion/react";
import { 
  ExternalLink, 
  Sparkles, 
  Clock, 
  Heart, 
  Languages, 
  Zap,
  ArrowLeft,
  MessageCircle,
  User,
  Shield,
  type LucideIcon 
} from "lucide-react";
import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";

interface Project {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  tags: string[];
  status: "live" | "soon";
  icon: LucideIcon;
  accentColor: string;
  lightAccentColor: string;
  link?: string;
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
];

const ProjectCard = ({ project }: { project: Project }) => {
  const isLive = project.status === "live";
  const Icon = project.icon;

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
        transition: { 
          type: "spring",
          stiffness: 400,
          damping: 30
        }
      } : {}}
      className={`relative group p-6 md:p-12 rounded-[2.5rem] md:rounded-[3rem] border ${
        isLive 
          ? "bg-white border-zinc-200/40 shadow-[0_20px_50px_rgba(0,0,0,0.01)] cursor-pointer" 
          : "bg-zinc-50/30 border-zinc-200/50 opacity-50 grayscale cursor-default"
      }`}
    >
      <div className={`flex flex-col sm:flex-row justify-between items-start gap-6 md:gap-8 ${isLive ? 'mb-8' : 'mb-6'}`}>
        <div className="flex items-center gap-4 md:gap-8">
          <motion.div 
            whileHover={isLive ? { scale: 1.05, rotate: 2 } : {}}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 flex items-center justify-center rounded-[1.25rem] md:rounded-[1.5rem] border transition-all duration-200 shadow-sm"
            style={{ 
              backgroundColor: isLive ? project.lightAccentColor : "#F4F4F5",
              borderColor: isLive ? `${project.accentColor}10` : "#E4E4E7",
              color: isLive ? project.accentColor : "#71717A"
            }}
          >
            <Icon className="w-8 h-8 md:w-10 md:h-10" />
          </motion.div>
          <div>
            <div className="flex items-center gap-3 md:gap-4 mb-2 md:mb-3">
              <span className="text-[9px] md:text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.3em] bg-zinc-50 px-2.5 py-1 md:px-3 md:py-1.5 rounded-lg border border-zinc-100">Exp. {project.id.slice(0, 3).toUpperCase()}</span>
              {isLive && <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" style={{ color: project.accentColor }} />}
            </div>
            <h3 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight leading-none">
              {project.name}
            </h3>
            <p className="text-[10px] md:text-[12px] text-zinc-400 font-black uppercase tracking-[0.3em] mt-2 md:mt-3">{project.subtitle}</p>
          </div>
        </div>
        <motion.div 
          whileHover={isLive ? { scale: 1.05, backgroundColor: `${project.accentColor}15` } : { scale: 1.02 }}
          animate={isLive ? { 
            boxShadow: [
              `0 0 0px ${project.accentColor}00`,
              `0 0 12px ${project.accentColor}20`,
              `0 0 0px ${project.accentColor}00`
            ]
          } : {}}
          transition={{ 
            duration: 2, 
            repeat: Infinity, 
            ease: "easeInOut" 
          }}
          className="px-4 py-2 md:px-6 md:py-2.5 rounded-full text-[10px] md:text-[11px] uppercase tracking-[0.25em] font-black flex items-center gap-2 md:gap-3 border shadow-sm transition-colors duration-200"
          style={{ 
            backgroundColor: isLive ? `${project.accentColor}05` : "#F4F4F5",
            color: isLive ? project.accentColor : "#A1A1AA",
            borderColor: isLive ? `${project.accentColor}10` : "#E4E4E7"
          }}
        >
          {isLive ? (
            <>
              <span className="relative flex h-2 w-2 md:h-2.5 md:w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: project.accentColor }}></span>
                <span className="relative inline-flex rounded-full h-2 w-2 md:h-2.5 md:w-2.5" style={{ backgroundColor: project.accentColor }}></span>
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
        className={`text-zinc-500 text-base md:text-lg leading-relaxed font-medium max-w-2xl transition-colors duration-200 ${isLive ? 'mb-8' : 'mb-6'}`}
      >
        {project.description}
      </motion.p>

      <div className={`flex flex-wrap gap-2 md:gap-3 ${isLive ? 'mb-8' : 'mb-0'}`}>
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
              transition: {
                scale: {
                  duration: 0.6,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut"
                },
                duration: 0.15
              }
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
          to={project.link || "#"}
          className="relative inline-flex items-center justify-center gap-4 md:gap-5 px-8 py-4 md:px-12 md:py-6 rounded-2xl md:rounded-[2rem] text-xs md:text-sm font-black transition-all duration-200 group/btn shadow-[0_15px_30px_rgba(0,0,0,0.04)] hover:shadow-[0_30px_60px_rgba(0,0,0,0.1)] active:scale-95 overflow-hidden w-full sm:w-auto"
          style={{ 
            backgroundColor: project.accentColor,
            color: 'white'
          }}
        >
          {/* Button Shine Effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover/btn:animate-[shine_1.5s_ease-in-out_infinite]" />
          
          <span className="relative z-10 flex items-center gap-5">
            Explore Experiment 
            <ExternalLink className="w-5 h-5 transition-transform group-hover/btn:translate-x-1 group-hover/btn:-translate-y-1" />
          </span>
        </Link>
      )}
    </motion.div>
  );
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 200]);

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-zinc-900 font-sans selection:bg-zinc-900 selection:text-white antialiased">
      {/* Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          style={{ y: y1 }}
          className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-zinc-200/10 blur-[180px] rounded-full" 
        />
        <motion.div 
          style={{ y: y2 }}
          className="absolute bottom-[-20%] right-[-10%] w-[70%] h-[70%] bg-zinc-100/20 blur-[180px] rounded-full" 
        />
      </div>

      <main className="relative max-w-[840px] mx-auto px-6 md:px-10 py-12 md:py-16 flex flex-col gap-12 md:gap-16">
        {children}

        {/* Footer */}
        <footer className="mt-12 md:mt-16 pb-12 md:pb-16 border-t border-zinc-100/60 pt-12 md:pt-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16 items-start">
            {/* Left: System Info */}
            <div className="space-y-4 md:space-y-6 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-3">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] md:text-[10px] font-mono font-black uppercase tracking-widest text-zinc-400">System Operational</span>
              </div>
              <div className="space-y-1 md:space-y-2">
                <p className="text-[9px] md:text-[10px] font-mono text-zinc-300 uppercase tracking-wider">Core: Gemini 3.1 Pro</p>
                <p className="text-[9px] md:text-[10px] font-mono text-zinc-300 uppercase tracking-wider">Latency: 24ms</p>
                <p className="text-[9px] md:text-[10px] font-mono text-zinc-300 uppercase tracking-wider">Status: Synthesizing</p>
              </div>
            </div>

            {/* Center: Brand */}
            <div className="flex flex-col items-center gap-6 md:gap-8">
              <div className="text-center space-y-3 md:space-y-4">
                <h3 className="text-xl md:text-2xl font-black tracking-tighter text-zinc-900 leading-none">
                  <Link to="/">xuxuxu<span className="text-emerald-500">.</span></Link>
                </h3>
                <p className="text-[9px] md:text-[10px] text-zinc-400 tracking-[0.4em] md:tracking-[0.6em] uppercase font-black">
                  AI Native Lab
                </p>
              </div>
              <div className="flex gap-1.5">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-1 h-1 rounded-full bg-zinc-200" />
                ))}
              </div>
            </div>

            {/* Right: Meta */}
            <div className="space-y-4 md:space-y-6 text-center md:text-right">
              <p className="text-[9px] md:text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                © {new Date().getFullYear()} xuxuxu lab
              </p>
              <p className="text-[8px] md:text-[9px] text-zinc-300 font-black uppercase tracking-[0.2em] md:tracking-[0.3em] leading-relaxed max-w-[240px] mx-auto md:ml-auto">
                Experimental platform exploring the intersection of human intuition and synthetic intelligence.
              </p>
            </div>
          </div>
          
          {/* Bottom Bar */}
          <div className="mt-16 md:mt-24 pt-6 md:pt-8 border-t border-zinc-50 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6">
            <p className="text-[8px] md:text-[9px] text-zinc-300 font-black uppercase tracking-[0.3em] md:tracking-[0.4em] text-center md:text-left">
              All content synthesized by Artificial Intelligence
            </p>
            <div className="flex gap-6 md:gap-8">
              <a href="#" className="text-[8px] md:text-[9px] text-zinc-400 hover:text-zinc-900 transition-colors font-black uppercase tracking-widest">Privacy</a>
              <a href="#" className="text-[8px] md:text-[9px] text-zinc-400 hover:text-zinc-900 transition-colors font-black uppercase tracking-widest">Terms</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
};

const Home = () => {
  return (
    <>
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
            xuxuxu<motion.span 
              animate={{ opacity: [0.3, 1, 0.3] }} 
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="text-emerald-500"
            >.</motion.span>
          </h1>
          <div className="flex items-center justify-center gap-4 md:gap-8">
            <div className="h-px w-12 md:w-20 bg-zinc-200" />
            <p className="text-zinc-400 text-[10px] sm:text-sm md:text-xl font-black uppercase tracking-[0.4em] md:tracking-[0.6em]">未知与你，凝结生长</p>
            <div className="h-px w-12 md:w-20 bg-zinc-200" />
          </div>
        </motion.div>
      </header>

      {/* Philosophy Section */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 py-12 border-y border-zinc-200/40">
        <div className="space-y-4 md:space-y-6">
          <div className="flex items-center gap-4 md:gap-5">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-zinc-900 text-white flex items-center justify-center font-black text-lg md:text-xl shadow-xl">X</div>
            <h4 className="font-black uppercase tracking-[0.4em] text-[10px] md:text-xs text-zinc-400">The Unknown (AI)</h4>
          </div>
          <p className="text-zinc-500 text-lg md:text-xl leading-relaxed font-semibold">
            无限的可能，实验的起点。
          </p>
        </div>
        <div className="space-y-4 md:space-y-6">
          <div className="flex items-center gap-4 md:gap-5">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-[1rem] md:rounded-[1.25rem] bg-zinc-100 border border-zinc-200 text-zinc-900 flex items-center justify-center font-black text-lg md:text-xl shadow-sm">U</div>
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
          <div key={project.id}>
            <ProjectCard project={project} />
          </div>
        ))}
      </section>
    </>
  );
};

const AibajiDetail = () => {
  const navigate = useNavigate();

  return (
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
            y: [0, -30, 0]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-0 right-[-10%] w-[50%] h-[50%] bg-pink-200/20 blur-[120px] rounded-full" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.05, 0.15, 0.05],
            x: [0, -40, 0],
            y: [0, 60, 0]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-0 left-[-5%] w-[40%] h-[40%] bg-purple-200/10 blur-[100px] rounded-full" 
        />
      </div>

      {/* Back Button */}
      <button 
        onClick={() => navigate(-1)}
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
              <span className="px-4 py-1.5 rounded-full bg-pink-500 text-white text-[10px] font-black uppercase tracking-widest">Active Experiment</span>
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
        <div className="p-12 md:p-20 rounded-[3rem] md:rounded-[4rem] bg-pink-500 text-white text-center space-y-8 shadow-2xl relative overflow-hidden group">
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
            <button className="px-12 py-6 rounded-[2rem] bg-white text-pink-500 text-sm font-black uppercase tracking-[0.3em] hover:shadow-xl transition-all hover:scale-105 active:scale-95">
              Launch Alpha v1.2
            </button>
          </div>
        </div>
      </section>
    </motion.div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/project/aibaji" element={<AibajiDetail />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
