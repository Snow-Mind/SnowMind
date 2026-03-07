import Link from "next/link";
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
    title: "AI Optimization",
    description:
      "Our backend continuously solves a Mixed-Integer Linear Programming (MILP) problem to find the mathematically optimal allocation of your funds across lending protocols.",
    details: [
      "MILP maximizes risk-adjusted yield (return − λ × risk)",
      "Hard constraint: max 60% in any single protocol",
      "Minimum $500 per protocol or zero allocation",
      "TWAP-confirmed rates prevent manipulation",
    ],
  },
  {
    icon: RefreshCw,
    title: "Smart Rebalancing",
    description:
      "When the optimizer identifies a better allocation, a 5-condition safety gate validates the move before executing through ERC-4337 UserOperations.",
    details: [
      "Allocation drift > 5% triggers evaluation",
      "Net positive APR after gas costs confirmed",
      "Minimum 6-hour cooldown between rebalances",
      "Rate cross-validation against DefiLlama",
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
    <main>
      {/* Header */}
      <section className="pb-16 pt-24 sm:pt-32">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <p className="section-label">Documentation</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-arctic sm:text-5xl">
            How SnowMind Works
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            A step-by-step look at how your stablecoins are optimized across
            Avalanche lending protocols — safely, autonomously, and
            transparently.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="pb-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="space-y-12">
            {DETAILED_STEPS.map((step, index) => (
              <div key={step.title} className="crystal-card p-8 sm:p-10">
                <div className="flex items-start gap-6">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border bg-void-2">
                    <step.icon className="h-5 w-5 text-glacier" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="metric-value text-xs">
                        STEP {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-arctic">
                      {step.title}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                    <ul className="mt-5 space-y-2.5">
                      {step.details.map((detail) => (
                        <li
                          key={detail}
                          className="flex items-start gap-2.5 text-sm text-muted-foreground"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
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
      <section className="border-t border-border/50 py-24">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center">
            <Shield className="mx-auto h-8 w-8 text-glacier" />
            <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-arctic">
              Safety at every layer
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Multiple independent safeguards protect your funds.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {SAFETY_CHECKS.map((check) => (
              <div
                key={check}
                className="flex items-start gap-3 rounded-xl border border-border/50 bg-void-2/30 p-5"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint" />
                <p className="text-sm text-muted-foreground">{check}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/50 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-arctic">
            Ready to optimize?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Connect your wallet and start earning optimized yield in minutes.
          </p>
          <div className="mt-8">
            <Link href="/dashboard" className="glacier-btn text-sm">
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
