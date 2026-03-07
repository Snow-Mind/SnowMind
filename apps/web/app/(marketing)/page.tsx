"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import MountainHero from "@/components/snow/MountainHero";
import NeuralSnowflake from "@/components/snow/NeuralSnowflake";
import CrystalCard from "@/components/snow/CrystalCard";
import {
  Shield,
  Cpu,
  RefreshCw,
  Layers,
  Lock,
  Eye,
  Zap,
  ArrowRight,
  Wallet,
  Brain,
  TrendingUp,
  Check,
  Sparkles,
} from "lucide-react";
import { PROTOCOL_CONFIG } from "@/lib/constants";

/* ── Animation helpers ────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.15 } },
};

function Section({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      className={className}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={stagger}
    >
      {children}
    </motion.section>
  );
}

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={fadeUp} transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}>
      {children}
    </motion.div>
  );
}

/* ── CountUp ──────────────────────────────────────────────── */
function CountUp({ value, suffix = "" }: { value: string; suffix?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  return (
    <span ref={ref} className="metric-value text-2xl">
      {inView ? value : "—"}
      {suffix}
    </span>
  );
}

/* ── Protocol orbit positions (CSS transform origin offsets) ── */
const PROTOCOLS = [
  { name: "Benqi", apy: "4.1%", alloc: 40, pos: "top" },
  { name: "Aave V3", apy: "3.8%", alloc: 35, pos: "right" },
  { name: "Euler V2", apy: "—", alloc: 0, pos: "bottom", soon: true },
  { name: "Fluid", apy: "—", alloc: 0, pos: "left", soon: true },
] as const;

/* ── Comparison table rows ────────────────────────────────── */
const COMPARISON = [
  { feature: "Network", competitors: "Base, Ethereum", snowmind: "Avalanche Native" },
  { feature: "Minimum", competitors: "$100K+", snowmind: "From $5K" },
  { feature: "Optimizer", competitors: "Rule-based / Greedy", snowmind: "MILP (Globally Optimal)" },
  { feature: "Gas cost", competitors: "High (ETH L1/L2)", snowmind: "~$0.01 (Avalanche)" },
  { feature: "Custody", competitors: "Varies", snowmind: "100% Non-custodial" },
  { feature: "Smart Account", competitors: "Older versions", snowmind: "ZeroDev Kernel v3.1" },
] as const;

export default function MarketingPage() {
  return (
    <main className="relative">
      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="relative min-h-screen w-full overflow-hidden bg-[#0f172a]">
        <MountainHero />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-40 bg-gradient-to-b from-[#0f172a]/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-56 bg-gradient-to-t from-void to-transparent" />

        <div className="relative z-[2] flex min-h-screen flex-col items-center justify-center px-6 text-center">
          {/* Chip badge */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <span className="chip">
              <Sparkles className="h-3 w-3" />
              Powered by Avalanche
            </span>
          </motion.div>

          <motion.h1
            className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Autonomous yield,{" "}
            <span className="gradient-text-hero">mathematically optimal</span>
          </motion.h1>

          <motion.p
            className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
          >
            Deposit stablecoins into your own smart account. Our MILP solver
            maximizes risk-adjusted returns across Avalanche protocols — 24/7,
            non-custodial.
          </motion.p>

          <motion.div
            className="mt-8 flex items-center gap-3"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <Link href="/dashboard" className="glacier-btn">
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#how-it-works" className="ghost-btn">
              How it works
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ─── Stats bar ────────────────────────────────────── */}
      <section className="relative border-b border-white/[0.04] bg-void">
        <div className="mx-auto grid max-w-5xl grid-cols-2 sm:grid-cols-4">
          {[
            { value: "From $5K", label: "Minimum deposit" },
            { value: "<$0.01", label: "Gas per rebalance" },
            { value: "24/7", label: "Autonomous" },
            { value: "100%", label: "Non-custodial" },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`px-6 py-8 text-center ${i > 0 ? "border-l border-white/[0.04]" : ""}`}
            >
              <p className="font-mono text-lg font-bold text-glacier sm:text-xl">
                {s.value}
              </p>
              <p className="mt-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────── */}
      <Section id="how-it-works" className="relative bg-void py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 dot-grid opacity-40" />
        <div className="relative mx-auto max-w-5xl px-6">
          <Reveal>
            <p className="section-label text-center">THE PROCESS</p>
          </Reveal>
          <Reveal>
            <h2 className="mt-3 text-center font-display text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              Three steps to optimized yield
            </h2>
          </Reveal>
          <Reveal>
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-slate-500">
              Set it once. Our AI handles the rest, continuously optimizing your positions.
            </p>
          </Reveal>

          {/* Step connector line (desktop) */}
          <div className="relative mt-16">
            <div className="absolute top-10 right-8 left-8 hidden h-px bg-gradient-to-r from-transparent via-glacier/15 to-transparent sm:block" />

            <motion.div
              className="grid gap-8 sm:grid-cols-3"
              variants={stagger}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
            >
              {[
                {
                  icon: Wallet,
                  num: "01",
                  title: "Connect & Deposit",
                  text: "Connect your wallet. SnowMind creates a non-custodial smart account. Deposit USDC and set your risk profile.",
                },
                {
                  icon: Brain,
                  num: "02",
                  title: "AI Optimizes",
                  text: "Our MILP solver runs every 30 minutes, calculating the optimal split across Benqi and Aave V3 on Avalanche.",
                },
                {
                  icon: TrendingUp,
                  num: "03",
                  title: "Yield Compounds",
                  text: "Funds rebalance automatically when profitable. You watch your yield grow. Gas costs are sponsored.",
                },
              ].map((step) => (
                <motion.div key={step.num} variants={fadeUp} transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}>
                  <CrystalCard className="relative h-full">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-glacier/15 bg-glacier/5">
                      <step.icon className="h-4 w-4 text-glacier" />
                    </div>
                    <span className="font-mono text-[10px] text-glacier/30">
                      {step.num}
                    </span>
                    <h3 className="mt-1.5 font-display text-base font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                      {step.text}
                    </p>
                  </CrystalCard>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ─── Protocol Showcase ────────────────────────────── */}
      <Section className="border-t border-white/[0.04] bg-void py-24 sm:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
            <p className="section-label text-center">PROTOCOLS</p>
          </Reveal>
          <Reveal>
            <h2 className="mt-3 text-center font-display text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              Where your yield comes from
            </h2>
          </Reveal>
          <Reveal>
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-slate-500">
              Diversified across battle-tested DeFi protocols on Avalanche.
            </p>
          </Reveal>

          <motion.div
            className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
          >
            {Object.values(PROTOCOL_CONFIG).map((p) => (
              <motion.div
                key={p.id}
                variants={fadeUp}
                transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
              >
                <CrystalCard className="relative h-full">
                  {p.isComingSoon && (
                    <span className="absolute top-4 right-4 rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber">
                      Soon
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <h3 className="font-display text-base font-semibold text-white">
                      {p.name}
                    </h3>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{p.description}</p>

                  <div className="mt-4 flex items-center gap-4">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Risk
                      </span>
                      <p className="font-mono text-base font-bold" style={{ color: p.color }}>
                        {p.riskScore}/10
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Max Alloc.
                      </span>
                      <p className="font-mono text-base font-bold text-arctic">
                        {(p.maxAllocationPct * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  {p.auditBadge && (
                    <div className="mt-3 flex items-center gap-1 text-[10px] text-mint/60">
                      <Shield className="h-3 w-3" /> {p.auditBadge}
                    </div>
                  )}

                  <div className="mt-3 rounded-md bg-glacier/[0.04] px-2 py-1 text-center text-[10px] font-medium text-glacier/40">
                    Avalanche C-Chain
                  </div>
                </CrystalCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Section>

      {/* ─── Competitive Differentiation ──────────────────── */}
      <Section className="border-t border-white/[0.04] bg-void py-24 sm:py-32">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <p className="section-label text-center">COMPARISON</p>
          </Reveal>
          <Reveal>
            <h2 className="mt-3 text-center font-display text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              Why SnowMind?
            </h2>
          </Reveal>

          <Reveal>
            <div className="mt-12 overflow-hidden rounded-xl border border-white/[0.04]">
              {/* Header row */}
              <div className="grid grid-cols-3 border-b border-white/[0.04] bg-white/[0.015]">
                <div className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Feature
                </div>
                <div className="border-l border-white/[0.04] px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Others
                </div>
                <div className="border-l border-white/[0.04] px-5 py-3 text-[11px] font-medium uppercase tracking-wider text-glacier/50">
                  SnowMind
                </div>
              </div>

              {/* Data rows */}
              {COMPARISON.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-3 ${i < COMPARISON.length - 1 ? "border-b border-white/[0.04]" : ""}`}
                >
                  <div className="px-5 py-3.5 text-[13px] font-medium text-white">
                    {row.feature}
                  </div>
                  <div className="border-l border-white/[0.04] px-5 py-3.5 text-[13px] text-slate-500">
                    {row.competitors}
                  </div>
                  <div className="flex items-center gap-1.5 border-l border-white/[0.04] px-5 py-3.5 text-[13px] font-medium text-mint">
                    <Check className="h-3 w-3 shrink-0" />
                    {row.snowmind}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ─── Risk & Security ──────────────────────────────── */}
      <Section id="security" className="border-t border-white/[0.04] bg-void py-24 sm:py-32">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
            <p className="section-label text-center">SECURITY</p>
          </Reveal>
          <Reveal>
            <h2 className="mt-3 text-center font-display text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
              Built for the paranoid
            </h2>
          </Reveal>
          <Reveal>
            <p className="mx-auto mt-3 max-w-md text-center text-sm text-slate-500">
              Non-custodial architecture with multiple layers of protection.
            </p>
          </Reveal>

          <motion.div
            className="mt-12 grid gap-4 sm:grid-cols-3"
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
          >
            {([
              {
                icon: Lock,
                title: "Scoped Session Keys",
                text: "Our AI can only supply/withdraw to approved protocols. No transfers. No access to other contracts. Revoke anytime.",
              },
              {
                icon: Shield,
                title: "MILP Concentration Caps",
                text: "Hard constraint: no more than 60% in any single protocol. Automatic diversification, always.",
              },
              {
                icon: Eye,
                title: "Rate Validation",
                text: "Every rate is TWAP-smoothed and cross-validated against DefiLlama. Flash loan attacks don't move us.",
              },
            ] as const).map((card) => (
              <motion.div key={card.title} variants={fadeUp} transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}>
                <CrystalCard className="h-full">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-glacier/10 bg-glacier/[0.04]">
                    <card.icon className="h-4 w-4 text-glacier" />
                  </div>
                  <h3 className="mt-4 font-display text-sm font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                    {card.text}
                  </p>
                </CrystalCard>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Section>

      {/* ─── CTA ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/[0.04]">
        {/* Gradient mesh background */}
        <div className="absolute inset-0 gradient-mesh" />

        {/* Faint snowflake decoration */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.03]">
          <NeuralSnowflake className="h-[400px] w-[400px]" />
        </div>

        <div className="relative z-10 py-24 sm:py-32">
          <div className="mx-auto max-w-xl px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="font-display text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
                Start earning smarter today.
              </h2>
              <p className="mt-4 text-sm text-slate-400">
                Avalanche&apos;s first autonomous yield optimizer. From $5K.
              </p>
              <div className="mt-8">
                <Link
                  href="/dashboard"
                  className="glacier-btn"
                >
                  Launch App
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </main>
  );
}
