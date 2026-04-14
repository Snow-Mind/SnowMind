import Link from "next/link";
import Image from "next/image";
import {
  Wallet,
  Cpu,
  RefreshCw,
  BarChart3,
  Shield,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

const DETAILED_STEPS = [
  {
    icon: Wallet,
    title: "Connect & Deposit",
    description:
      "Authenticate with Privy and deposit USDC into your own ZeroDev Kernel v3.1 smart account. You retain full ownership — SnowMind never holds custody of your funds.",
    details: [
      "Sign in with wallet, email, or social login via Privy",
      "ZeroDev deploys a smart account you fully own",
      "Deposit USDC — withdraw anytime, no lockups",
      "Grant a scoped session key with strict permissions",
    ],
  },
  {
    icon: Cpu,
    title: "Optimization",
    description:
      "Snow Optimizer ranks lending protocols by APY and allocates with risk and liquidity caps, capped at 15% of each pool's TVL. Spark Savings acts as the stable yield floor when no market beats it.",
    details: [
      "Snow Optimizer prioritizes highest qualified APY, then balances across safe alternatives",
      "15% TVL cap prevents owning too much of any pool",
      "Spark as yield floor — safe parking when no protocol beats it",
      "TWAP-confirmed rates prevent manipulation",
    ],
  },
  {
    icon: RefreshCw,
    title: "Smart Rebalancing",
    description:
      "When the optimizer identifies a better allocation, a safety gate validates the move: daily yield improvement must exceed gas costs before executing through ERC-4337 UserOperations.",
    details: [
      "Allocation drift > 5% triggers evaluation",
      "Daily yield improvement must exceed rebalance gas cost",
      "Deposit-tier cadence gate: <=$3,000 (12h), <=$10,000 (4h), <=$100,000 (2h), >$100,000 (1h)",
      "30-day average APY prevents chasing short spikes",
    ],
  },
  {
    icon: BarChart3,
    title: "Monitor & Withdraw",
    description:
      "Track your portfolio performance, allocation history, and every rebalance in real-time. Withdraw to your wallet whenever you want.",
    details: [
      "Real-time dashboard with yield metrics",
      "Full rebalance history and allocation timeline",
      "One-click withdrawal to your wallet",
      "Transparent fee and gas cost breakdown",
    ],
  },
] as const;

const SAFETY_CHECKS = [
  "Session keys are AES-256-GCM encrypted at rest",
  "Keys scoped to specific contracts and functions only",
  "Rate anomaly detection halts rebalancing if APY > 25%",
  "Circuit breaker excludes failing protocol adapters",
  "All communication over TLS 1.3",
  "Funds stay earning yield even if backend goes down",
] as const;

export default function HowItWorksPage() {
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
            className="font-sans font-medium text-sm text-[#E84142]"
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

        <Link
          href="/dashboard"
          className="md:hidden inline-flex items-center rounded-lg bg-[#E84142] px-4 py-2 text-xs font-semibold text-[#FAFAF8] transition-colors duration-200 hover:bg-[#D63031]"
        >
          Launch App
        </Link>
      </header>

      {/* Hero */}
      <section className="pb-16 pt-28 sm:pt-36">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <p className="font-sans font-semibold text-[13px] text-[#E84142] tracking-[0.08em] uppercase">
            Documentation
          </p>
          <h1 className="mt-3 font-sans text-4xl font-bold tracking-tight text-[#1A1715] sm:text-5xl">
            How SnowMind Works
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#5C5550] sm:text-lg">
            A step-by-step look at how your stablecoins are optimized across
            Avalanche lending protocols — safely, autonomously, and
            transparently.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="pb-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="space-y-8">
            {DETAILED_STEPS.map((step, index) => (
              <div
                key={step.title}
                className="rounded-2xl border border-[#E8E2DA] bg-white/80 p-8 sm:p-10 transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-start gap-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#E8E2DA] bg-[#F5F0EB]">
                    <step.icon className="h-5 w-5 text-[#E84142]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-semibold text-[#E84142]">
                        STEP {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h2 className="mt-2 font-sans text-2xl font-semibold text-[#1A1715]">
                      {step.title}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-[#5C5550]">
                      {step.description}
                    </p>
                    <ul className="mt-5 space-y-2.5">
                      {step.details.map((detail) => (
                        <li
                          key={detail}
                          className="flex items-start gap-2.5 text-sm text-[#5C5550]"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#E84142]" />
                          {detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Safety section */}
      <section className="border-t border-[#E8E2DA] bg-white/40 py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-[#E84142]" />
            <h2 className="mt-4 font-sans text-3xl font-bold tracking-tight text-[#1A1715]">
              Safety at every layer
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[#5C5550]">
              Multiple independent safeguards protect your funds.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {SAFETY_CHECKS.map((check) => (
              <div
                key={check}
                className="flex items-start gap-3 rounded-xl border border-[#E8E2DA] bg-white/80 p-5"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#E84142]" />
                <p className="text-sm text-[#5C5550]">{check}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-[#E8E2DA] bg-[#1A1715] py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-sans text-3xl font-bold tracking-tight text-white">
            Ready to optimize?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[#8A837C]">
            Connect your wallet and start earning optimized yield in minutes.
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-[#E84142] text-white font-semibold px-8 py-3 rounded-lg hover:bg-[#D63031] transition-colors"
            >
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
