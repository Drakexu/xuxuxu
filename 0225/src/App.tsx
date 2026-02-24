/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
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
  Compass,
  PlusCircle,
  Search,
  MoreHorizontal,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  Mail,
  CheckCircle,
  Newspaper,
  XCircle,
  Loader,
  type LucideIcon 
} from "lucide-react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, NavLink, Outlet, Navigate, useParams } from "react-router-dom";

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
  const location = useLocation();
  const isPlaza = location.pathname.includes('/plaza');

  return (
    <div className="min-h-screen bg-[#FBFBFA] text-zinc-900 font-sans selection:bg-zinc-900 selection:text-white antialiased">
      {/* Background Elements */}
      {!isPlaza && (
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
      )}

      <main className={`relative flex flex-col ${isPlaza ? '' : 'max-w-[840px] mx-auto px-6 md:px-10 py-12 md:py-16 gap-12 md:gap-16'}`}>
        {children}

        {!isPlaza && (
          /* Footer */
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
        )}
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
            <Link 
              to="/project/aibaji/app"
              className="px-12 py-6 rounded-[2rem] bg-white text-pink-500 text-sm font-black uppercase tracking-[0.3em] hover:shadow-xl transition-all hover:scale-105 active:scale-95"
            >
              Launch Alpha v1.2
            </Link>
          </div>
        </div>
      </section>
    </motion.div>
  );
};

// --- Aibaji App Structure ---

const MOCK_CHARACTERS = [
  { id: '1', name: "星奈", gender: "女", age: "19岁", intro: "来自未来的赛博歌姬，拥有治愈灵魂的歌声。", img: "https://picsum.photos/seed/nana/400/711", fullIntro: "星奈是一台诞生于22世纪的仿生人歌姬。她不仅拥有完美的嗓音，还能感知人类的情绪波动。在舞台上，她是闪耀的明星；在私下里，她是一个有点迷糊、喜欢收集复古黑胶唱片的可爱女孩。" },
  { id: '2', name: "陆沉", gender: "男", age: "27岁", intro: "沉默寡言的天才黑客，只对代码和猫感兴趣。", img: "https://picsum.photos/seed/lu/400/711", fullIntro: "前顶尖安全专家，现居于地下城的自由黑客。性格冷淡，不善言辞，但内心有着自己的底线和正义感。养了一只名叫'Bug'的黑猫。" },
  { id: '3', name: "小桃", gender: "女", age: "16岁", intro: "充满活力的元气少女，总是能给你带来惊喜。", img: "https://picsum.photos/seed/tao/400/711", fullIntro: "性格开朗活泼，像小太阳一样温暖身边的人。喜欢甜食，特别是草莓蛋糕。虽然有时候会有点小任性，但总是能用笑容化解一切。" },
  { id: '4', name: "零号", gender: "未知", age: "??", intro: "遗失记忆的仿生人，正在寻找存在的意义。", img: "https://picsum.photos/seed/zero/400/711", fullIntro: "在废墟中被唤醒的神秘仿生人，没有过去的记忆，只有对这个世界的好奇。性格平静如水，但在某些特定时刻会展现出惊人的战斗力。" },
  { id: '5', name: "苏曼", gender: "女", age: "24岁", intro: "优雅冷静的心理医生，擅长倾听你的秘密。", img: "https://picsum.photos/seed/man/400/711", fullIntro: "知性优雅的心理学博士，总能一针见血地指出你的问题所在。表面上看起来有些高冷，但实际上非常关心她的每一个'病人'。" },
  { id: '6', name: "阿杰", gender: "男", age: "21岁", intro: "热血的街头赛车手，追求极致的速度与激情。", img: "https://picsum.photos/seed/jay/400/711", fullIntro: "热爱速度与激情的地下赛车手。性格直爽，重情重义。虽然外表看起来有些不羁，但对赛车有着近乎偏执的热爱和专注。" },
  { id: '7', name: "白夜", gender: "男", age: "1000+", intro: "沉睡千年的吸血鬼贵族，对现代社会充满好奇。", img: "https://picsum.photos/seed/bai/400/711", fullIntro: "沉睡了千年的吸血鬼贵族，醒来后对现代社会的科技和文化充满了好奇。虽然拥有强大的力量，但更喜欢安静地品尝一杯红酒，阅读一本好书。" },
  { id: '8', name: "K", gender: "女", age: "22岁", intro: "冷酷无情的赏金猎人，但内心似乎隐藏着温柔。", img: "https://picsum.photos/seed/k/400/711", fullIntro: "独来独往的赏金猎人，以高超的战斗技巧和冷酷的行事风格闻名。但在她冷漠的外表下，似乎隐藏着一段不为人知的温柔往事。" },
];

const AibajiContext = createContext<any>(null);

const AibajiSidebar = () => {
  const navItems = [
    { label: "发现", icon: Compass, path: "/project/aibaji/app/discover" },
    { label: "聊天", icon: MessageCircle, path: "/project/aibaji/app/chat" },
    { label: "捏崽", icon: PlusCircle, path: "/project/aibaji/app/create" },
    { label: "我的", icon: User, path: "/project/aibaji/app/profile" },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 border-r border-zinc-800/50 bg-zinc-950/50 backdrop-blur-xl z-20 shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-pink-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
          <Heart className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-black tracking-tight">爱巴基</h1>
      </div>
      
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {navItems.map((tab) => (
          <NavLink 
            key={tab.label}
            to={tab.path}
            className={({ isActive }) => `w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${
              isActive 
                ? 'bg-pink-500/10 text-pink-500' 
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
            }`}
          >
            {({ isActive }) => (
              <>
                <tab.icon className={`w-5 h-5 ${isActive ? 'fill-pink-500/20' : ''}`} />
                <span className="font-bold tracking-wider text-sm">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-6">
        <Link 
          to="/project/aibaji"
          className="w-full group flex items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors font-black uppercase tracking-widest text-[10px] py-4 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/30"
        >
          <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-1" />
          Back to Lab
        </Link>
      </div>
    </aside>
  );
};

const AibajiBottomNav = () => {
  const navItems = [
    { label: "发现", icon: Compass, path: "/project/aibaji/app/discover" },
    { label: "聊天", icon: MessageCircle, path: "/project/aibaji/app/chat" },
    { label: "捏崽", icon: PlusCircle, path: "/project/aibaji/app/create" },
    { label: "我的", icon: User, path: "/project/aibaji/app/profile" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 h-20 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 px-6 flex items-center justify-between pb-safe z-50">
      {navItems.map((tab) => (
        <NavLink 
          key={tab.label}
          to={tab.path}
          className={({ isActive }) => `flex flex-col items-center gap-1.5 transition-colors ${isActive ? 'text-pink-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          {({ isActive }) => (
            <>
              <tab.icon className={`w-5 h-5 ${isActive ? 'fill-pink-500/10' : ''}`} />
              <span className="text-[9px] font-black uppercase tracking-widest">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
};

const AibajiDiscover = () => {
  const { characters } = useContext(AibajiContext);
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 scrollbar-hide space-y-8">
      {/* Header Mobile */}
      <header className="md:hidden flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg bg-pink-500 flex items-center justify-center">
          <Heart className="w-3 h-3 text-white" />
        </div>
        <h1 className="text-lg font-black tracking-tight">爱巴基</h1>
      </header>

      {/* Banner */}
      <div className="w-full h-[300px] md:h-[400px] rounded-[2.5rem] bg-zinc-900 p-8 md:p-12 flex flex-col justify-end relative overflow-hidden group cursor-pointer shadow-2xl">
        <div className="absolute inset-0 bg-[url('https://picsum.photos/seed/banner/1200/600')] mix-blend-overlay opacity-50 object-cover transition-transform duration-1000 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent opacity-90" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-pink-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
        
        <div className="relative z-10 space-y-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 shadow-[0_0_20px_rgba(255,255,255,0.1)]">
            <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
            <span className="text-xs font-black tracking-widest uppercase text-white">New Arrival</span>
          </div>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-white drop-shadow-2xl leading-tight">
            遇见你的<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">赛博灵魂</span>
          </h2>
          <p className="text-zinc-400 font-medium text-sm md:text-base max-w-md">
            探索无限可能的 AI 角色宇宙，与他们建立独一无二的羁绊。
          </p>
        </div>
      </div>

      {/* Grid */}
      <div>
        <h3 className="text-2xl font-black mb-8 flex items-center gap-3 tracking-tight">
          <div className="w-8 h-8 rounded-xl bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
            <Sparkles className="w-4 h-4 text-pink-500" />
          </div>
          推荐角色
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
          {characters.map((char: any, i: number) => (
            <motion.div
              key={char.id}
              onClick={() => navigate(`/project/aibaji/app/character/${char.id}`)}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              whileHover={{ y: -8 }}
              className="bg-zinc-900 rounded-[2rem] overflow-hidden group relative cursor-pointer shadow-2xl transition-all duration-500"
            >
              <div className="aspect-[3/4] overflow-hidden relative">
                <img src={char.img} alt={char.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90 group-hover:opacity-70 transition-opacity duration-500" />
                
                <div className="absolute bottom-0 inset-x-0 p-5 space-y-3 translate-y-4 group-hover:translate-y-0 transition-transform duration-500 ease-out">
                  <div className="flex items-end justify-between gap-2">
                    <h3 className="text-xl md:text-2xl font-black text-white drop-shadow-lg tracking-tight">{char.name}</h3>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="px-2 py-1 rounded-md bg-white/10 backdrop-blur-xl text-[9px] text-white font-black tracking-widest uppercase border border-white/10 shadow-[0_0_10px_rgba(255,255,255,0.05)]">{char.gender}</span>
                      <span className="px-2 py-1 rounded-md bg-white/10 backdrop-blur-xl text-[9px] text-white font-black tracking-widest uppercase border border-white/10 shadow-[0_0_10px_rgba(255,255,255,0.05)]">{char.age}</span>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                    {char.intro}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AibajiCharacterDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { characters, favorites, toggleFavorite } = useContext(AibajiContext);
  const char = characters.find((c: any) => c.id === id);
  const isFav = favorites.includes(id);

  if (!char) return <div className="p-8">Character not found</div>;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide relative bg-zinc-950">
      <button onClick={() => navigate(-1)} className="absolute top-6 left-6 z-20 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md border border-white/10 flex items-center justify-center text-white hover:bg-black/70 transition-colors">
        <ArrowLeft className="w-5 h-5" />
      </button>

      <div className="h-[60vh] md:h-[70vh] relative">
        <img src={char.img} alt={char.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-transparent to-transparent" />
      </div>

      <div className="max-w-4xl mx-auto px-6 md:px-12 -mt-40 relative z-10 space-y-10 pb-32 md:pb-12">
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <h1 className="text-6xl md:text-8xl font-black tracking-tighter drop-shadow-2xl text-white leading-none">{char.name}</h1>
            <button 
              onClick={() => toggleFavorite(char.id)}
              className={`w-14 h-14 rounded-full flex items-center justify-center border transition-all shrink-0 shadow-2xl ${isFav ? 'bg-pink-500 border-pink-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.4)]' : 'bg-zinc-900/80 backdrop-blur-xl border-zinc-700/50 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              <Heart className={`w-6 h-6 ${isFav ? 'fill-current' : ''}`} />
            </button>
          </div>
          <div className="flex gap-2">
            <span className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl text-xs font-black tracking-widest uppercase text-white border border-white/10">{char.gender}</span>
            <span className="px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-xl text-xs font-black tracking-widest uppercase text-white border border-white/10">{char.age}</span>
          </div>
        </div>

        <div className="p-8 rounded-[2.5rem] bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 space-y-6 shadow-2xl">
          <h3 className="text-xl font-black text-white flex items-center gap-3 tracking-tight">
            <div className="w-8 h-8 rounded-xl bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
              <User className="w-4 h-4 text-pink-500" />
            </div>
            关于 {char.name}
          </h3>
          <p className="text-zinc-300 leading-relaxed text-base md:text-lg font-medium">
            {char.fullIntro}
          </p>
        </div>

        <button 
          onClick={() => navigate(`/project/aibaji/app/chat/${char.id}`)}
          className="w-full py-5 rounded-[2rem] bg-gradient-to-r from-pink-600 to-purple-600 text-white font-black uppercase tracking-widest hover:from-pink-500 hover:to-purple-500 transition-all shadow-[0_0_30px_rgba(236,72,153,0.3)] hover:shadow-[0_0_40px_rgba(236,72,153,0.5)] flex items-center justify-center gap-3 text-lg group"
        >
          <MessageCircle className="w-6 h-6 group-hover:scale-110 transition-transform" />
          开始聊天
        </button>
      </div>
    </div>
  );
};

const AibajiChatHub = () => {
  const [activeTab, setActiveTab] = useState<'fav' | 'active'>('fav');
  const { characters, favorites } = useContext(AibajiContext);
  const navigate = useNavigate();

  const favChars = characters.filter((c: any) => favorites.includes(c.id));

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="px-6 py-4 border-b border-zinc-800/50 shrink-0 pt-8 md:pt-4 bg-zinc-950/80 backdrop-blur-xl z-10">
        <div className="flex gap-8">
          <button 
            onClick={() => setActiveTab('fav')}
            className={`pb-3 text-xl font-black tracking-tight transition-colors relative ${activeTab === 'fav' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            收藏
            {activeTab === 'fav' && <motion.div layoutId="chatTab" className="absolute bottom-0 inset-x-0 h-1 bg-gradient-to-r from-pink-500 to-purple-500 rounded-t-full shadow-[0_0_10px_rgba(236,72,153,0.5)]" />}
          </button>
          <button 
            onClick={() => setActiveTab('active')}
            className={`pb-3 text-xl font-black tracking-tight transition-colors relative ${activeTab === 'active' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            正在聊天
            {activeTab === 'active' && <motion.div layoutId="chatTab" className="absolute bottom-0 inset-x-0 h-1 bg-gradient-to-r from-pink-500 to-purple-500 rounded-t-full shadow-[0_0_10px_rgba(236,72,153,0.5)]" />}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 scrollbar-hide">
        {activeTab === 'fav' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
            {favChars.length === 0 ? (
              <div className="col-span-full py-32 text-center flex flex-col items-center justify-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-700">
                  <Heart className="w-8 h-8" />
                </div>
                <div className="text-zinc-500 font-bold tracking-widest uppercase text-sm">暂无收藏角色</div>
              </div>
            ) : (
              favChars.map((char: any) => (
                <div 
                  key={char.id} 
                  onClick={() => navigate(`/project/aibaji/app/chat/${char.id}`)}
                  className="group cursor-pointer space-y-3"
                >
                  <div className="aspect-[3/4] rounded-[1.5rem] overflow-hidden relative shadow-xl">
                    <img src={char.img} alt={char.name} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-80" />
                    <div className="absolute inset-0 border-2 border-transparent group-hover:border-pink-500/30 rounded-[1.5rem] transition-colors" />
                  </div>
                  <div className="text-center">
                    <h4 className="text-base font-black text-zinc-300 group-hover:text-white transition-colors tracking-tight">{char.name}</h4>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'active' && (
          <div className="space-y-2">
            <div className="py-20 text-center text-zinc-500 font-medium">
              暂无聊天记录
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AibajiChat = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { characters } = useContext(AibajiContext);
  const char = characters.find((c: any) => c.id === id) || characters[0];
  
  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 relative z-50">
      {/* Header */}
      <header className="h-16 md:h-20 border-b border-zinc-800/50 flex items-center justify-between px-4 md:px-8 bg-zinc-950/80 backdrop-blur-xl shrink-0">
        <button 
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex flex-col items-center">
          <h1 className="text-base md:text-lg font-black tracking-tight">{char.name}</h1>
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Online</span>
        </div>
        
        <div className="w-10 h-10" /> {/* Spacer */}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide flex flex-col pb-24 md:pb-8">
        <div className="flex justify-center my-4">
          <span className="px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800/50 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Today</span>
        </div>
        
        {/* AI Message */}
        <div className="flex gap-3 max-w-[85%] md:max-w-[70%]">
          <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700/50">
            <img src={char.img} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] text-zinc-500 font-bold ml-1">{char.name}</span>
            <div className="p-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 text-zinc-100 text-sm md:text-base leading-relaxed">
              你好呀！我是{char.name}。今天过得怎么样？有没有什么想和我分享的？
            </div>
          </div>
        </div>

        {/* User Message */}
        <div className="flex gap-3 max-w-[85%] md:max-w-[70%] self-end flex-row-reverse">
          <div className="space-y-1.5">
            <div className="p-4 rounded-2xl rounded-tr-sm bg-pink-600 text-white text-sm md:text-base leading-relaxed shadow-lg shadow-pink-900/20">
              今天有点累，不过看到你感觉好多了。
            </div>
          </div>
        </div>
        
        {/* AI Typing */}
        <div className="flex gap-3 max-w-[85%] md:max-w-[70%]">
          <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden shrink-0 border border-zinc-700/50">
            <img src={char.img} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="space-y-1.5">
            <span className="text-[10px] text-zinc-500 font-bold ml-1">{char.name}</span>
            <div className="px-4 py-4 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/50 flex items-center gap-1.5 h-[52px]">
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 md:p-6 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50 pb-safe absolute bottom-0 inset-x-0">
        <div className="max-w-4xl mx-auto relative flex items-end gap-3">
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-[1.5rem] p-1 flex items-end transition-colors focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/50">
            <textarea 
              placeholder={`和 ${char.name} 说点什么...`}
              className="w-full bg-transparent text-white placeholder:text-zinc-500 px-4 py-3 max-h-32 min-h-[44px] resize-none focus:outline-none text-sm md:text-base"
              rows={1}
            />
          </div>
          <button className="w-12 h-12 rounded-full bg-pink-600 flex items-center justify-center text-white hover:bg-pink-500 transition-colors shrink-0 shadow-lg shadow-pink-900/20">
            <Send className="w-5 h-5 ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
};

const CollapsibleSection = ({ title, defaultOpen = false, children }: { title: string, defaultOpen?: boolean, children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800/50 rounded-[1.5rem] bg-zinc-900/30 overflow-hidden transition-colors hover:border-zinc-700/50">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-5 flex items-center justify-between bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors"
      >
        <h3 className="font-bold text-zinc-100">{title}</h3>
        {isOpen ? <ChevronUp className="w-5 h-5 text-zinc-500" /> : <ChevronDown className="w-5 h-5 text-zinc-500" />}
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="p-6 border-t border-zinc-800/50 space-y-6">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AibajiCreateCharacter = () => {
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 scrollbar-hide bg-zinc-950 relative">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Topbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-400 text-[10px] font-black uppercase tracking-widest">Studio</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">新建角色</h1>
            <p className="text-sm text-zinc-400">先填写角色设定，再生成提示词并发布。</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-6 py-3 rounded-xl bg-zinc-800 text-white font-bold hover:bg-zinc-700 transition-colors text-sm">
              生成提示词
            </button>
            <button className="px-6 py-3 rounded-xl bg-pink-600 text-white font-bold hover:bg-pink-500 transition-colors text-sm shadow-lg shadow-pink-900/20">
              创建角色
            </button>
          </div>
        </div>

        {/* Hero / KPI */}
        <div className="p-6 md:p-8 rounded-[2rem] bg-gradient-to-br from-zinc-900 to-zinc-900/50 border border-zinc-800/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/5 blur-[100px] rounded-full pointer-events-none" />
          <div className="relative z-10 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">先定角色，再定规则，最后生成可执行提示词</h2>
              <p className="text-sm text-zinc-400 mt-1">覆盖高频字段。更细节的人设和规则可在创建后继续编辑。</p>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
              {[
                { label: "角色名", value: "未填写" },
                { label: "提示词长度", value: "0" },
                { label: "发布范围", value: "公开" },
                { label: "广场解锁价", value: "免费" },
                { label: "创作者分成", value: "70%" },
                { label: "恋爱模式", value: "开启" },
                { label: "年龄模式", value: "成人" },
                { label: "越界问答", value: "允许" },
                { label: "模板来源", value: "空白" },
              ].map((kpi, i) => (
                <div key={i} className="p-3 md:p-4 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
                  <div className="text-sm md:text-base font-black text-pink-400">{kpi.value}</div>
                  <div className="text-[10px] md:text-xs text-zinc-500 font-bold mt-1">{kpi.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <CollapsibleSection title="基础信息" defaultOpen={true}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">角色名</label>
                <input type="text" placeholder="例如：林澈" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">可见性</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>公开（可出现在广场）</option>
                  <option>私密（仅自己可见）</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">广场解锁价格（星币）</label>
                <input type="text" placeholder="0 = 免费" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
                <p className="text-[10px] text-zinc-500">仅对公开角色生效。</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">创作者分成（基点）</label>
                <input type="text" placeholder="7000 = 70%" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
                <p className="text-[10px] text-zinc-500">0–10000。默认 7000（70%）。</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">性别</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>男</option>
                  <option>女</option>
                  <option>其他</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">年龄</label>
                <input type="text" placeholder="例如：23" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">职业</label>
                <input type="text" placeholder="例如：咒术师" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">所属组织</label>
                <input type="text" placeholder="例如：东京都立咒术高专" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="col-span-1 md:col-span-2 space-y-2">
                <label className="text-xs font-bold text-zinc-400">人物简介</label>
                <textarea placeholder="角色核心设定、性格关键词、背景摘要。" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[100px] resize-y" />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="能力与习惯">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">喜欢</label>
                <textarea placeholder="例如：甜食、挑战极限" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[80px] resize-y" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">不喜欢</label>
                <textarea placeholder="例如：无聊、被轻视" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[80px] resize-y" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">长处</label>
                <textarea placeholder="例如：战斗直觉极强" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[80px] resize-y" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">弱点</label>
                <textarea placeholder="例如：容易冲动" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[80px] resize-y" />
              </div>
              <div className="col-span-1 md:col-span-2 space-y-2">
                <label className="text-xs font-bold text-zinc-400">习惯</label>
                <textarea placeholder="例如：总是把手插进口袋、喜欢用反问句" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[80px] resize-y" />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="世界与关系">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">世界观背景</label>
                <textarea placeholder="角色所在世界的核心规则、时代背景。" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[100px] resize-y" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">与用户当前关系</label>
                <textarea placeholder="例如：初次相遇的陌生人 / 多年老友" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[100px] resize-y" />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="互动风格">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">音色</label>
                <input type="text" placeholder="例如：低沉磁性" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">口头禅</label>
                <input type="text" placeholder="例如：「随便。」「没意思。」" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">语气</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>冷静</option>
                  <option selected>均衡</option>
                  <option>热情</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">句长倾向</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>短句</option>
                  <option selected>均衡</option>
                  <option>长句</option>
                </select>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="规则开关">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">恋爱模式</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>ROMANCE_ON（开启）</option>
                  <option>ROMANCE_OFF（关闭）</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">年龄模式</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>成人</option>
                  <option>未成年</option>
                </select>
                <p className="text-[10px] text-zinc-500">未成年模式强制关闭恋爱。</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">超出设定的问题</label>
                <select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all appearance-none">
                  <option>允许回答</option>
                  <option>拒绝回答</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">附加说明</label>
                <input type="text" placeholder="可补充特殊限制说明" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all" />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="发布备注">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">创作者备注（展示给广场浏览者）</label>
              <textarea placeholder="向读者介绍这个角色的玩法、适合的对话风格等。" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[100px] resize-y" />
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="角色提示词" defaultOpen={true}>
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">角色提示词（可手动调整）</label>
              <textarea placeholder="点击上方「生成提示词」自动填入，也可以直接粘贴自定义提示词。" className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all min-h-[200px] resize-y font-mono" />
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
};

const AibajiCreate = () => {
  const { createdChars } = useContext(AibajiContext);
  const navigate = useNavigate();

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 scrollbar-hide">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center justify-between mt-4 md:mt-0">
          <div>
            <h2 className="text-2xl font-black tracking-tight">我的创造</h2>
            <p className="text-sm text-zinc-400 mt-1">塑造独一无二的赛博灵魂</p>
          </div>
          <button 
            onClick={() => navigate('/project/aibaji/app/create/new')}
            className="hidden md:flex items-center gap-2 px-6 py-3 rounded-xl bg-pink-600 text-white font-bold hover:bg-pink-500 transition-colors shadow-lg shadow-pink-900/20"
          >
            <PlusCircle className="w-5 h-5" />
            创建新角色
          </button>
        </div>

        {createdChars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 md:py-32 space-y-6 border-2 border-dashed border-zinc-800/50 rounded-[2rem] bg-zinc-900/20 px-6">
            <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
              <PlusCircle className="w-10 h-10" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-zinc-300">还没有创造任何角色</h3>
              <p className="text-zinc-500 text-sm max-w-sm">
                发挥你的想象力，设定性格、背景和声音，创造一个完全属于你的 AI 伙伴。
              </p>
            </div>
            <button 
              onClick={() => navigate('/project/aibaji/app/create/new')}
              className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-pink-600 text-white font-black uppercase tracking-widest hover:bg-pink-500 transition-colors shadow-lg shadow-pink-900/20"
            >
              <PlusCircle className="w-5 h-5" />
              立即创建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {createdChars.map((char: any) => (
              <div key={char.id} className="h-[420px] rounded-[2rem] bg-zinc-900 overflow-hidden relative group shadow-2xl">
                <img src={char.img} alt={char.name} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-90" />
                
                <div className="absolute top-5 left-5">
                  <div className={`px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase backdrop-blur-md border ${char.status === '已发布' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-zinc-800/50 text-zinc-300 border-zinc-700/50'}`}>
                    {char.status}
                  </div>
                </div>

                <div className="absolute bottom-0 inset-x-0 p-6 flex flex-col justify-end">
                  <h3 className="text-2xl font-black text-white tracking-tight mb-4 drop-shadow-lg">{char.name}</h3>
                  <div className="flex items-center gap-3">
                    <button className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 text-sm font-bold transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                      {char.status === '已发布' ? '取消发布' : '发布'}
                    </button>
                    <button className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-xl border border-white/10 text-sm font-bold transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                      编辑
                    </button>
                    <button className="w-12 h-12 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 flex items-center justify-center transition-all hover:shadow-[0_0_20px_rgba(239,68,68,0.2)] shrink-0">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mobile FAB */}
        <button 
          onClick={() => navigate('/project/aibaji/app/create/new')}
          className="md:hidden fixed bottom-24 right-6 w-14 h-14 rounded-full bg-pink-600 text-white flex items-center justify-center shadow-lg shadow-pink-900/20 z-50"
        >
          <PlusCircle className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};

const AibajiProfile = () => {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 scrollbar-hide">
      <div className="max-w-2xl mx-auto space-y-8 mt-4 md:mt-0">
        <div className="flex items-center gap-6 p-8 md:p-10 rounded-[2.5rem] bg-zinc-900 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-pink-500/10 blur-[80px] rounded-full pointer-events-none" />
          <div className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-zinc-800 border-4 border-zinc-950 overflow-hidden shrink-0 relative z-10 shadow-[0_0_0_2px_rgba(236,72,153,0.5)]">
            <img src="https://picsum.photos/seed/user/200/200" alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black tracking-tighter text-white drop-shadow-lg">探索者_9527</h2>
            <p className="text-sm md:text-base text-zinc-400 mt-2 font-medium">已在爱巴基度过 <span className="text-pink-400 font-black">12</span> 天</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 md:gap-6">
          <div className="p-8 rounded-[2rem] bg-zinc-900 border border-zinc-800/50 relative overflow-hidden group hover:border-pink-500/30 transition-colors">
            <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-pink-500/5 blur-[40px] rounded-full group-hover:bg-pink-500/10 transition-colors" />
            <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-pink-400 to-purple-600 drop-shadow-sm">12</div>
            <div className="text-xs text-zinc-500 font-black uppercase tracking-widest mt-3">已收藏角色</div>
          </div>
          <div className="p-8 rounded-[2rem] bg-zinc-900 border border-zinc-800/50 relative overflow-hidden group hover:border-purple-500/30 transition-colors">
            <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-purple-500/5 blur-[40px] rounded-full group-hover:bg-purple-500/10 transition-colors" />
            <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-purple-400 to-indigo-600 drop-shadow-sm">3</div>
            <div className="text-xs text-zinc-500 font-black uppercase tracking-widest mt-3">已创造角色</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const OTP_COOLDOWN_SECONDS = 65;
const LAST_OTP_SENT_AT_KEY = 'xuxuxu:auth:lastOtpSentAt';

function readCooldownLeft() {
  if (typeof window === 'undefined') return 0;
  const last = Number(window.localStorage.getItem(LAST_OTP_SENT_AT_KEY) || 0);
  if (!Number.isFinite(last) || last <= 0) return 0;
  const passed = Math.floor((Date.now() - last) / 1000);
  return Math.max(0, OTP_COOLDOWN_SECONDS - passed);
}

function readLastSentAt() {
  if (typeof window === 'undefined') return 0;
  const last = Number(window.localStorage.getItem(LAST_OTP_SENT_AT_KEY) || 0);
  return Number.isFinite(last) && last > 0 ? last : 0;
}

function formatClockTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function mapAuthErrorMessage(raw: string, fallbackWaitSec = OTP_COOLDOWN_SECONDS) {
  const text = String(raw || '').trim();
  const lc = text.toLowerCase();
  if (lc.includes('rate limit') || lc.includes('rate_limit') || lc.includes('too many requests'))
    return `邮件发送过于频繁，请 ${fallbackWaitSec} 秒后重试。`;
  if (lc.includes('invalid email')) return '邮箱格式无效，请检查后重试。';
  return text || '登录邮件发送失败，请稍后重试。';
}

const LOGIN_FEATURES = [
  { icon: Newspaper, label: '首页动态流', desc: '角色朋友圈、日记和日程片段' },
  { icon: Sparkles, label: '广场解锁', desc: '发现并收藏心仪的 AI 角色' },
  { icon: User, label: '创建角色', desc: '捏专属 AI 伙伴，发布到广场' },
];

const AibajiLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(() => readCooldownLeft());
  const [lastSentAt, setLastSentAt] = useState(() => readLastSentAt());

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownLeft(readCooldownLeft()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const canSubmit = useMemo(
    () => email.trim().length > 3 && !loading && cooldownLeft === 0,
    [email, loading, cooldownLeft]
  );
  const retryAtLabel = useMemo(() => {
    if (!lastSentAt) return '';
    return formatClockTime(lastSentAt + OTP_COOLDOWN_SECONDS * 1000);
  }, [lastSentAt]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSent(false);
    const v = email.trim();
    if (!v) { setError('请输入有效的邮箱地址。'); return; }
    if (cooldownLeft > 0) {
      setError(retryAtLabel
        ? `请等待 ${cooldownLeft} 秒后重试（约 ${retryAtLabel} 可重发）。`
        : `请等待 ${cooldownLeft} 秒后重试。`);
      return;
    }
    setLoading(true);
    
    // Mock Supabase Auth
    await new Promise(r => setTimeout(r, 1500));
    const signError = v === 'error@test.com' ? { message: 'rate limit' } : null;
    
    setLoading(false);
    if (signError) {
      const nextWait = Math.max(readCooldownLeft(), OTP_COOLDOWN_SECONDS);
      const retryAt = formatClockTime(Date.now() + nextWait * 1000);
      setError(`${mapAuthErrorMessage(signError.message, nextWait)}（约 ${retryAt} 可重试）`);
      if (String(signError.message || '').toLowerCase().includes('rate limit')) {
        const now = Date.now();
        try { window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now)); } catch { /* ignore */ }
        setLastSentAt(now);
        setCooldownLeft(nextWait);
      }
      return;
    }
    const now = Date.now();
    try { window.localStorage.setItem(LAST_OTP_SENT_AT_KEY, String(now)); } catch { /* ignore */ }
    setLastSentAt(now);
    setCooldownLeft(OTP_COOLDOWN_SECONDS);
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-5 relative overflow-hidden">
      {/* Background Blurs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-pink-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-purple-500/20 blur-[120px] rounded-full pointer-events-none mix-blend-screen" />

      <div className="w-full max-w-[960px] grid grid-cols-1 md:grid-cols-[1.15fr_0.85fr] gap-6 relative z-10">
        {/* Left: Brand Panel */}
        <div className="rounded-[2.5rem] border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl p-8 md:p-12 flex flex-col gap-8 shadow-2xl order-2 md:order-1 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-purple-500/5 opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
          
          <div className="relative z-10">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white transition-colors mb-10"
            >
              <ArrowLeft className="w-3 h-3" />
              xuxuxu
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.2)] flex items-center justify-center">
                <Heart className="w-6 h-6 fill-pink-500 text-pink-500" />
              </div>
              <div>
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70">Magic Link</div>
                <div className="text-base font-black text-white tracking-tight">爱巴基 账号</div>
              </div>
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white leading-[1.1] mb-6 drop-shadow-lg">
              一个邮箱<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">即可登录</span>
            </h1>
            <p className="text-sm text-zinc-400 font-medium leading-relaxed max-w-[36ch]">
              无需密码。输入邮箱，点击我们发送的魔法链接，即刻完成登录或注册，进入赛博宇宙。
            </p>
          </div>

          <div className="space-y-5 relative z-10">
            <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-zinc-600 flex items-center gap-4">
              登录后解锁
              <div className="flex-1 h-px bg-zinc-800/50" />
            </div>
            {LOGIN_FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-zinc-950 border border-zinc-800/50 shadow-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-pink-500" />
                </div>
                <div>
                  <div className="text-sm font-black text-white uppercase tracking-wide">{label}</div>
                  <div className="text-xs text-zinc-400 font-medium mt-1">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 mt-auto pt-4 relative z-10">
            <button
              onClick={() => navigate('/project/aibaji/app/discover')}
              className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-pink-500/50 hover:text-white hover:bg-pink-500/10 transition-all"
            >先看广场</button>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white hover:bg-zinc-800 transition-all"
            >返回介绍页</button>
          </div>
        </div>

        {/* Right: Form / Sent */}
        <div className="rounded-[2.5rem] border border-zinc-800/50 bg-zinc-900/80 backdrop-blur-xl shadow-2xl p-8 md:p-10 flex flex-col order-1 md:order-2 relative z-10">
          {!sent ? (
            <>
              <div className="mb-10">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70 mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
                  Step 01 / 登录
                </div>
                <h2 className="text-3xl font-black tracking-tight text-white mb-2">输入你的邮箱</h2>
                <p className="text-sm text-zinc-400 font-medium">我们会发送一封登录链接，无需密码。</p>
              </div>
              <form onSubmit={handleLogin} className="flex flex-col gap-5 flex-1">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-mono font-black uppercase tracking-[0.3em] text-zinc-500">邮箱地址</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-pink-500 transition-colors" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="example@example.com"
                      autoComplete="email"
                      inputMode="email"
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-zinc-800 bg-zinc-950 text-white text-base font-medium placeholder:text-zinc-600 focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition-all shadow-inner"
                    />
                  </div>
                </div>
                {error && (
                  <div className="px-5 py-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-medium leading-relaxed shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                    {error}
                  </div>
                )}
                {cooldownLeft > 0 && !error && (
                  <div className="flex items-center gap-3 px-5 py-4 rounded-2xl border border-zinc-800 bg-zinc-950/50 text-zinc-400 text-xs font-medium">
                    <Clock className="w-4 h-4 flex-shrink-0 text-pink-500" />
                    冷却中 {cooldownLeft}s
                    {retryAtLabel && <span className="ml-auto font-mono text-zinc-500">{retryAtLabel} 可重发</span>}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="mt-auto w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.3em] transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  style={
                    canSubmit
                      ? { background: 'linear-gradient(to right, #ec4899, #a855f7)', color: 'white', boxShadow: '0 0 30px rgba(236,72,153,0.3)' }
                      : { background: '#18181b', color: '#52525b', border: '1px solid #27272a' }
                  }
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : null}
                  {loading ? '发送中...' : cooldownLeft > 0 ? `等待 ${cooldownLeft}s` : '发送登录邮件'}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 py-8">
              <div
                className="w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-[0_0_30px_rgba(236,72,153,0.2)]"
                style={{ background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.2)' }}
              >
                <CheckCircle className="w-12 h-12 text-pink-500" />
              </div>
              <div className="space-y-3">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70">Step 02 / 验证</div>
                <h2 className="text-4xl font-black tracking-tight text-white">去查看邮件</h2>
                <p className="text-sm text-zinc-400 font-medium leading-relaxed max-w-[28ch] mx-auto">
                  登录链接已发送至<br />
                  <span className="font-black text-white">{email}</span>
                </p>
              </div>
              <div className="w-full px-5 py-4 rounded-2xl border border-zinc-800 bg-zinc-950/50 text-xs text-zinc-400 font-medium text-left space-y-2">
                <div className="flex items-center gap-2 text-pink-500 font-black uppercase tracking-widest text-[10px] mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  注意事项
                </div>
                <p>· 请同时检查垃圾邮件文件夹</p>
                <p>· 链接有效期约 10 分钟</p>
                <p>· 请使用最新一封邮件中的链接</p>
              </div>
              <div className="w-full space-y-3 mt-auto">
                {cooldownLeft > 0 ? (
                  <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 font-medium">
                    <Clock className="w-4 h-4" />
                    {cooldownLeft}s 后可重发
                    {retryAtLabel && <span className="font-mono text-zinc-600">（约 {retryAtLabel}）</span>}
                  </div>
                ) : (
                  <button
                    onClick={() => { setSent(false); setError(''); }}
                    className="w-full py-4 rounded-2xl border border-zinc-700 text-white text-xs font-black uppercase tracking-widest hover:border-pink-500/50 hover:bg-pink-500/10 transition-all"
                  >重新发送</button>
                )}
                <button
                  onClick={() => { setSent(false); setEmail(''); setError(''); }}
                  className="w-full text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors py-2"
                >← 更换邮箱</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

const CALLBACK_STEPS = [
  '初始化验证...',
  '解析登录票据...',
  '校验身份令牌...',
  '确认会话状态...',
  '登录成功，正在跳转...',
];

const AibajiCallback = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState(CALLBACK_STEPS[0]);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const run = async () => {
      try {
        // Mocking the verification process visually
        for (let i = 0; i < CALLBACK_STEPS.length; i++) {
          setStep(CALLBACK_STEPS[i]);
          setStepIndex(i);
          await new Promise(r => setTimeout(r, 800)); // Fake delay for each step
        }
        
        // Success -> redirect
        navigate('/project/aibaji/app/discover');
      } catch (e: any) {
        setError(e.message || '登录验证失败，请重试。');
        setLoading(false);
      }
    };
    void run();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-5 relative overflow-hidden">
      {/* Background Blurs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-pink-500/10 blur-[150px] rounded-full pointer-events-none mix-blend-screen" />

      <div className="w-full max-w-[420px] flex flex-col gap-6 relative z-10">
        <div className="flex items-center gap-3 justify-center mb-2">
          <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-pink-500/30 flex items-center justify-center shadow-[0_0_10px_rgba(236,72,153,0.2)]">
            <Heart className="w-4 h-4 fill-pink-500 text-pink-500" />
          </div>
          <span className="text-lg font-black tracking-tight text-white">爱巴基</span>
        </div>

        <div className="rounded-[2.5rem] border border-zinc-800/50 bg-zinc-900/80 backdrop-blur-xl shadow-2xl p-8 md:p-10 flex flex-col items-center gap-8">
          {loading ? (
            <>
              <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-[0_0_30px_rgba(236,72,153,0.15)]"
                style={{ background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.2)' }}>
                <Loader className="w-10 h-10 text-pink-500 animate-spin" />
              </div>
              <div className="text-center space-y-2">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70">
                  验证中 {stepIndex + 1} / {CALLBACK_STEPS.length}
                </div>
                <h1 className="text-3xl font-black tracking-tight text-white">正在验证登录</h1>
                <p className="text-xs text-zinc-400 font-medium leading-relaxed">通常在几秒内完成，请稍候</p>
              </div>
              <div className="w-full space-y-3">
                {CALLBACK_STEPS.slice(0, -1).map((s, i) => (
                  <div key={s} className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black transition-all duration-500"
                      style={
                        i < stepIndex ? { background: '#ec4899', color: 'white', boxShadow: '0 0 10px rgba(236,72,153,0.5)' }
                        : i === stepIndex ? { background: 'rgba(236,72,153,0.15)', color: '#ec4899', border: '1.5px solid rgba(236,72,153,0.5)' }
                        : { background: '#18181b', color: '#52525b', border: '1px solid #27272a' }
                      }>
                      {i < stepIndex ? '✓' : i + 1}
                    </div>
                    <span className="text-xs font-medium transition-colors duration-500"
                      style={{ color: i <= stepIndex ? '#ffffff' : '#52525b' }}>
                      {s.replace('...', '')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="w-full px-5 py-3 rounded-2xl border border-zinc-800 bg-zinc-950 text-[10px] font-mono font-black uppercase tracking-widest text-zinc-400 text-center shadow-inner">
                {step}
              </div>
            </>
          ) : error ? (
            <>
              <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.15)]"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
              <div className="text-center space-y-2">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-red-500/70">验证失败</div>
                <h1 className="text-3xl font-black tracking-tight text-white">登录遇到问题</h1>
              </div>
              <div className="w-full px-5 py-4 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-medium leading-relaxed">
                {error}
              </div>
              <p className="text-xs text-zinc-400 font-medium text-center leading-relaxed">
                请使用邮件中最新一封链接，或重新发送登录邮件
              </p>
              <div className="w-full flex flex-col gap-3">
                <button onClick={() => navigate('/login')}
                  className="w-full py-4 rounded-2xl text-xs font-black uppercase tracking-[0.3em] text-white transition-all active:scale-[0.98]"
                  style={{ background: 'linear-gradient(to right, #ec4899, #a855f7)', boxShadow: '0 0 30px rgba(236,72,153,0.3)' }}>
                  重新登录
                </button>
                <button onClick={() => navigate('/')}
                  className="w-full py-3.5 rounded-2xl text-xs font-black uppercase tracking-widest border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors">
                  返回首页
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-24 h-24 rounded-[2rem] flex items-center justify-center shadow-[0_0_30px_rgba(236,72,153,0.2)]"
                style={{ background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.2)' }}>
                <CheckCircle className="w-10 h-10 text-pink-500" />
              </div>
              <div className="text-center space-y-2">
                <div className="text-[10px] font-mono font-black uppercase tracking-[0.4em] text-pink-500/70">登录成功</div>
                <h1 className="text-3xl font-black tracking-tight text-white">正在跳转...</h1>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-center gap-5">
          <button onClick={() => navigate('/login')}
            className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">
            返回登录页
          </button>
          <span className="text-zinc-700">·</span>
          <button onClick={() => navigate('/project/aibaji/app/discover')}
            className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">
            去广场浏览
          </button>
        </div>
      </div>
    </div>
  );
};

const AibajiApp = () => {
  const [favorites, setFavorites] = useState<string[]>(['1', '3']);
  const [createdChars, setCreatedChars] = useState<any[]>([
    { id: 'c1', name: "我的专属猫娘", status: "已发布", img: "https://picsum.photos/seed/cat/400/600" }
  ]);

  const toggleFavorite = (id: string) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  return (
    <AibajiContext.Provider value={{ favorites, toggleFavorite, createdChars, setCreatedChars, characters: MOCK_CHARACTERS }}>
      <div className="min-h-screen bg-zinc-950 text-white font-sans flex selection:bg-pink-500 selection:text-white">
        <AibajiSidebar />
        <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
           <Outlet />
        </main>
        <AibajiBottomNav />
      </div>
    </AibajiContext.Provider>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/project/aibaji" element={<Layout><AibajiDetail /></Layout>} />
        
        <Route path="/project/aibaji/app" element={<AibajiApp />}>
          <Route index element={<Navigate to="discover" replace />} />
          <Route path="discover" element={<AibajiDiscover />} />
          <Route path="character/:id" element={<AibajiCharacterDetail />} />
          <Route path="chat" element={<AibajiChatHub />} />
          <Route path="chat/:id" element={<AibajiChat />} />
          <Route path="create" element={<AibajiCreate />} />
          <Route path="create/new" element={<AibajiCreateCharacter />} />
          <Route path="profile" element={<AibajiProfile />} />
        </Route>
        
        <Route path="/login" element={<AibajiLogin />} />
        <Route path="/auth/callback" element={<AibajiCallback />} />
      </Routes>
    </BrowserRouter>
  );
}

