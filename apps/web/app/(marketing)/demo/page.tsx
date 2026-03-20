"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ExternalLink,
  Wallet,
  Shield,
  Zap,
  Eye,
  ArrowRight,
  CheckCircle2,
  Coins,
  BarChart3,
  FileCode2,
} from "lucide-react";
import CrystalCard from "@/components/snow/CrystalCard";
import { CONTRACTS, EXPLORER } from "@/lib/constants";

export const dynamic = "force-dynamic";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

const STEPS: {
  num: string;
  icon: typeof Wallet;
  title: string;
  description: string;
  time: string;
  link?: { href: string; label: string };
}[] = [
  {
    num: "01",
    icon: Wallet,
    title: "Connect Wallet",
    description:
      'Click "Launch App" below. Connect with MetaMask or use email login via Privy. A ZeroDev Kernel v3.1 smart account is created automatically on Avalanche.',
    time: "~30 seconds",
  },
  {
    num: "02",
    icon: Coins,
    title: "Deposit USDC",
    description:
      "Transfer USDC to your smart account. SnowMind supports native USDC on Avalanche C-Chain.",
    time: "~1 minute",
  },
  {
    num: "03",
    icon: Shield,
    title: "Authorize Optimizer",
    description:
      "Complete the setup wizard. Step 3 creates a scoped session key — the optimizer can only supply/withdraw to whitelisted protocols. This is a real on-chain transaction.",
    time: "~30 seconds",
  },
  {
    num: "04",
    icon: Zap,
    title: "Deposit & Watch",
    description:
      'Click "Deposit" on the dashboard. Enter your USDC amount. The UserOperation is sent via Pimlico bundler. Watch your yield-bearing balance appear live.',
    time: "~1 minute",
  },
  {
    num: "05",
    icon: BarChart3,
    title: "Verify On-Chain",
    description:
      "Click any transaction hash in the dashboard to open it on Snowtrace. Every action is publicly verifiable on Avalanche.",
    time: "~30 seconds",
  },
];

const QUICK_LINKS = [
  {
    icon: Eye,
    title: "Live Rebalance Events",
    description: "Watch all SnowMindRegistry events in real-time. No wallet needed.",
    href: "/activity",
    internal: true,
  },
  {
    icon: FileCode2,
    title: "Verified Contract Source",
    description: "View the SnowMindRegistry Solidity source code on Snowtrace.",
    href: CONTRACTS.REGISTRY
      ? EXPLORER.contract(CONTRACTS.REGISTRY)
      : EXPLORER.base,
    internal: false,
  },
  {
    icon: ExternalLink,
    title: "Aave V3 Pool",
    description: "The lending protocol where your USDC earns yield.",
    href: EXPLORER.address(CONTRACTS.AAVE_POOL),
    internal: false,
  },
] as const;

export default function DemoPage() {
  return (
    <main className="bg-void py-24 sm:py-32">
      <div className="mx-auto max-w-4xl px-6">
        {/* Header */}
        <motion.div
          className="text-center"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-glacier/20 bg-glacier/5 px-4 py-1.5 text-xs font-medium text-glacier">
              <span className="h-1.5 w-1.5 rounded-full bg-mint animate-pulse" />
              Live on Avalanche
            </span>
          </motion.div>

          <motion.h1
            className="mt-6 font-display text-4xl font-bold text-white sm:text-5xl"
            variants={fadeUp}
            transition={{ duration: 0.5 }}
          >
            Try SnowMind in 3 minutes
          </motion.h1>

          <motion.p
            className="mt-4 text-base text-slate-400 sm:text-lg"
            variants={fadeUp}
            transition={{ duration: 0.5 }}
          >
            Follow these steps to use the autonomous yield optimizer on
            Avalanche. Every transaction is real and verifiable on-chain.
          </motion.p>
        </motion.div>

        {/* Steps */}
        <motion.div
          className="mt-16 space-y-6"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          {STEPS.map((step) => (
            <motion.div
              key={step.num}
              variants={fadeUp}
              transition={{ duration: 0.5 }}
            >
              <CrystalCard className="relative">
                <div className="flex gap-5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-glacier/20 bg-glacier/5">
                    <step.icon className="h-5 w-5 text-glacier" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-glacier/40">
                        Step {step.num}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {step.time}
                      </span>
                    </div>
                    <h3 className="mt-1 font-display text-lg font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">
                      {step.description}
                    </p>
                    {step.link && (
                      <a
                        href={step.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-glacier hover:underline"
                      >
                        {step.link.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-glacier/20" />
                </div>
              </CrystalCard>
            </motion.div>
          ))}
        </motion.div>

        {/* Launch CTA */}
        <motion.div
          className="mt-12 text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
        >
          <Link
            href="/dashboard"
            className="glacier-btn inline-flex items-center gap-2 !px-8 !py-3.5 !text-base"
          >
            Launch App
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-3 text-xs text-slate-500">
            Make sure your wallet is on Avalanche C-Chain
          </p>
        </motion.div>

        {/* Quick Links */}
        <div className="mt-20">
          <h2 className="text-center font-display text-xl font-semibold text-white">
            Quick Links
          </h2>

          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <CrystalCard key={link.title} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-glacier/15 bg-glacier/5">
                  <link.icon className="h-5 w-5 text-glacier" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {link.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {link.description}
                </p>
                {link.internal ? (
                  <Link
                    href={link.href}
                    className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-glacier hover:underline"
                  >
                    Open <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-glacier hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CrystalCard>
            ))}
          </div>
        </div>

        {/* Contract Addresses */}
        <div className="mt-20">
          <h2 className="text-center font-display text-xl font-semibold text-white">
            Verified Contracts
          </h2>
          <p className="mt-2 text-center text-xs text-slate-500">
            All contracts deployed and verified on Avalanche
          </p>

          <div className="mt-8 overflow-hidden rounded-xl border border-white/[0.06]">
            <div className="grid grid-cols-[1fr_2fr_auto] border-b border-white/[0.06] bg-white/[0.02] px-5 py-3">
              <span className="text-xs font-medium text-slate-500">Contract</span>
              <span className="text-xs font-medium text-slate-500">Address</span>
              <span className="text-xs font-medium text-slate-500">Link</span>
            </div>

            {[
              {
                name: "Aave V3 Pool",
                address: CONTRACTS.AAVE_POOL,
              },
              {
                name: "USDC Token",
                address: CONTRACTS.USDC,
              },
              {
                name: "EntryPoint v0.7",
                address: CONTRACTS.ENTRYPOINT_V07,
              },
              ...(CONTRACTS.REGISTRY
                ? [{ name: "SnowMindRegistry", address: CONTRACTS.REGISTRY }]
                : []),
            ].map((c, i) => (
              <div
                key={c.name}
                className={`grid grid-cols-[1fr_2fr_auto] items-center px-5 py-3.5 ${
                  i > 0 ? "border-t border-white/[0.04]" : ""
                }`}
              >
                <span className="text-sm text-white">{c.name}</span>
                <span className="truncate font-mono text-xs text-slate-400">
                  {c.address}
                </span>
                <a
                  href={EXPLORER.address(c.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-glacier hover:underline"
                >
                  Snowtrace <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
