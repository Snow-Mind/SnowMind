import Link from "next/link";
import Image from "next/image";
import {
  BookOpen,
  Shield,
  Zap,
  Code2,
  FileText,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Server,
  Wallet,
} from "lucide-react";
import { CONTRACTS, EXPLORER } from "@/lib/constants";

const QUICK_LINKS = [
  {
    title: "Getting Started",
    description: "Connect your wallet and create your first AI agent in minutes.",
    href: "/how-it-works",
    icon: Zap,
  },
  {
    title: "Security Model",
    description: "Learn how SnowMind protects your funds with non-custodial architecture.",
    href: "#security",
    icon: Shield,
  },
  {
    title: "Live Demo",
    description: "Watch SnowMind optimize yield on Avalanche.",
    href: "/demo",
    icon: BookOpen,
  },
  {
    title: "Smart Contracts",
    description: "View our verified contracts on Snowtrace.",
    href: CONTRACTS.REGISTRY ? EXPLORER.contract(CONTRACTS.REGISTRY) : EXPLORER.base,
    icon: Code2,
    external: true,
  },
] as const;

const ARCHITECTURE_SECTIONS = [
  {
    title: "Frontend (Next.js + Privy)",
    icon: Wallet,
    items: [
      "Privy authentication (wallet, email, social login)",
      "ZeroDev Kernel v3.1 smart account creation",
      "Session key grant with scoped permissions",
      "Real-time portfolio dashboard",
    ],
  },
  {
    title: "Backend (FastAPI + Python)",
    icon: Server,
    items: [
      "Waterfall allocator for yield allocation decisions",
      "TWAP rate fetcher with anomaly detection",
      "ERC-4337 UserOperation execution via Pimlico",
      "Supabase for state persistence",
    ],
  },
  {
    title: "On-Chain (Avalanche C-Chain)",
    icon: Lock,
    items: [
      "ZeroDev Kernel v3.1 smart accounts",
      "Pimlico paymaster for gas sponsoring",
      "Aave V3 + Benqi lending protocols",
      "SnowMindRegistry for account tracking",
    ],
  },
] as const;

const SAFETY_FEATURES = [
  {
    title: "Non-Custodial",
    description: "Your funds stay in your own smart account at all times. We never hold custody.",
  },
  {
    title: "Session Key Scoping",
    description: "Session keys are limited to specific contracts and functions (supply/withdraw only).",
  },
  {
    title: "Rate Anomaly Detection",
    description: "APY > 25% triggers automatic halt — protects against flash loan manipulation.",
  },
  {
    title: "Protocol Circuit Breaker",
    description: "Failing protocol adapters are automatically excluded from allocation.",
  },
  {
    title: "TWAP Confirmation",
    description: "Rates are time-weighted averaged to prevent spot-rate manipulation.",
  },
  {
    title: "Concentration Limits",
    description: "Maximum 15% of any protocol's TVL — enforced by the waterfall allocator.",
  },
] as const;

const FAQ = [
  {
    q: "Is SnowMind custodial?",
    a: "No. Your funds are held in your own ZeroDev smart account. SnowMind's backend can only execute the specific operations you've authorized via session keys (supply/withdraw on approved protocols). You can revoke access anytime.",
  },
  {
    q: "What happens if SnowMind goes down?",
    a: "Your funds continue earning yield in whichever protocol they're currently deposited in. You retain full ownership and can withdraw directly through the protocol interfaces or by using your smart account.",
  },
  {
    q: "How does the optimizer decide where to put my funds?",
    a: "SnowMind uses a waterfall allocator that ranks protocols by TWAP-smoothed APY and fills from top to bottom. Each protocol is capped at 15% of its TVL to prevent market impact. Your diversification preference (Max Yield, Balanced, or Diversified) controls how funds are spread across protocols.",
  },
  {
    q: "What are session keys?",
    a: "Session keys are temporary, scoped permissions that allow our backend to execute specific operations on your behalf. They're encrypted (AES-256-GCM) at rest, limited to approved contracts/functions, and auto-expire after 7 days.",
  },
  {
    q: "Which protocols does SnowMind support?",
    a: "Currently: Aave V3, Benqi, and Spark on Avalanche mainnet. We carefully vet each protocol for security, TVL, and audit history before integration.",
  },
  {
    q: "What are the fees?",
    a: "SnowMind charges a 10% agent fee on profits only — calculated at withdrawal as (current_balance − net_principal) × 10%. No deposit fee, no management fee. Gas costs for rebalancing are sponsored via Pimlico paymaster.",
  },
] as const;

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#F5F0EB]">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-50 flex items-center justify-between px-5 py-4 md:px-10 md:py-5 bg-[#F5F0EB]/80 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/snowmind-logo.png"
            alt="Snow Mind"
            width={120}
            height={38}
            className="h-[38px] w-auto"
          />
          <span className="font-sans font-bold text-xl text-[#E84142] tracking-[-0.02em]">
            SnowMind
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="/how-it-works"
            className="font-sans font-medium text-sm text-[#1A1715] hover:opacity-70 transition-opacity duration-200"
          >
            How It Works
          </Link>
          <Link
            href="/dashboard"
            className="bg-[#E84142] text-[#FAFAF8] font-sans font-semibold text-sm px-6 py-2.5 rounded-lg hover:bg-[#D63031] transition-colors duration-200"
          >
            Launch App
          </Link>
        </nav>
      </header>

      {/* Content */}
      <section className="pb-12 pt-28 sm:pt-36">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E8E2DA] bg-white/60 px-4 py-1.5 text-sm text-[#5C5550]">
            <FileText className="h-4 w-4" />
            Documentation
          </div>
          <h1 className="mt-6 font-sans text-4xl font-bold tracking-tight text-[#1A1715] sm:text-5xl">
            SnowMind Documentation
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#5C5550] sm:text-lg">
            Everything you need to understand how SnowMind optimizes your yield
            on Avalanche — safely, transparently, and autonomously.
          </p>
        </div>
      </section>

      {/* Quick Links */}
      <section className="pb-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.title}
                href={link.href}
                target={"external" in link && link.external ? "_blank" : undefined}
                rel={"external" in link && link.external ? "noopener noreferrer" : undefined}
                className="group rounded-2xl border border-[#E8E2DA] bg-white/80 p-5 transition-all hover:-translate-y-1 hover:border-[#E84142]/30 hover:shadow-lg"
              >
                <link.icon className="h-6 w-6 text-[#E84142]" />
                <h3 className="mt-3 font-sans font-semibold text-[#1A1715] group-hover:text-[#E84142]">
                  {link.title}
                  {"external" in link && link.external && (
                    <ExternalLink className="ml-1.5 inline h-3.5 w-3.5" />
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-[#5C5550]">{link.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture Overview */}
      <section className="border-t border-[#E8E2DA] py-16">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-sans text-2xl font-bold text-[#1A1715] sm:text-3xl">
            Architecture Overview
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-[#5C5550]">
            SnowMind is a three-tier system: frontend for user interaction,
            backend for optimization logic, and on-chain smart accounts for fund custody.
          </p>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {ARCHITECTURE_SECTIONS.map((section) => (
              <div
                key={section.title}
                className="rounded-2xl border border-[#E8E2DA] bg-white/60 p-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E84142]/10">
                    <section.icon className="h-5 w-5 text-[#E84142]" />
                  </div>
                  <h3 className="font-sans font-semibold text-[#1A1715]">
                    {section.title}
                  </h3>
                </div>
                <ul className="mt-4 space-y-2">
                  {section.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-[#5C5550]">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#E84142]/60" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security Model */}
      <section id="security" className="border-t border-[#E8E2DA] bg-white/40 py-16">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center">
            <Shield className="mx-auto h-10 w-10 text-[#E84142]" />
            <h2 className="mt-4 font-sans text-2xl font-bold text-[#1A1715] sm:text-3xl">
              Security Model
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-[#5C5550]">
              Multiple independent safeguards protect your funds at every layer.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SAFETY_FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-[#E8E2DA] bg-white p-5"
              >
                <h3 className="font-sans font-semibold text-[#1A1715]">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-[#5C5550]">{feature.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h4 className="font-semibold text-amber-800">Beta Notice</h4>
                <p className="mt-1 text-sm text-amber-700">
                  SnowMind is currently in beta on Avalanche mainnet with a $50K deposit cap.
                  Start with small amounts. All deposits earn real yield.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-[#E8E2DA] py-16">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center font-sans text-2xl font-bold text-[#1A1715] sm:text-3xl">
            Frequently Asked Questions
          </h2>

          <div className="mt-10 space-y-6">
            {FAQ.map((item, i) => (
              <div key={i} className="rounded-xl border border-[#E8E2DA] bg-white/80 p-5">
                <h3 className="font-sans font-semibold text-[#1A1715]">{item.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5C5550]">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#E8E2DA] bg-[#1A1715] py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-sans text-2xl font-bold text-white sm:text-3xl">
            Ready to start earning?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[#8A837C]">
            Connect your wallet and deploy your AI yield agent in under 2 minutes.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-[#E84142] px-8 py-3 font-semibold text-white transition-colors hover:bg-[#D63031]"
            >
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-[#8A837C]/30 px-8 py-3 font-medium text-[#8A837C] transition-colors hover:border-white/50 hover:text-white"
            >
              How It Works
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
