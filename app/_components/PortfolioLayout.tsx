'use client'

import React from "react"
import { motion, useScroll, useTransform } from "motion/react"
import Link from "next/link"

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  const { scrollYProgress } = useScroll()
  const y1 = useTransform(scrollYProgress, [0, 1], [0, -200])
  const y2 = useTransform(scrollYProgress, [0, 1], [0, 200])

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
                  <Link href="/">xuxuxu<span className="text-emerald-500">.</span></Link>
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
  )
}
