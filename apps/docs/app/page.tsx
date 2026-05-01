import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Shield, Zap, BarChart3, Code } from "lucide-react";

export const metadata: Metadata = {
  title: "SnowMind Documentation",
  description:
    "Everything you need to understand how SnowMind optimizes your yield on Avalanche.",
};

const cards = [
  {
    title: "Getting Started",
    description:
      "Connect your wallet, create a smart account, and start earning yield in minutes.",
    href: "/overview/getting-started",
    icon: Zap,
  },
  {
    title: "How SnowMind Works",
    description:
      "Learn how SnowMind distributes your USDC across protocols to maximize yield.",
    href: "/learn/how-snowmind-works",
    icon: BarChart3,
  },
  {
    title: "Security Model",
    description:
      "Non-custodial smart accounts, session key scoping, and defense in depth.",
    href: "/security/smart-accounts",
    icon: Shield,
  },
  {
    title: "Protocol Assessment",
    description:
      "How we evaluate and score every protocol before listing it on SnowMind.",
    href: "/learn/protocol-assessment",
    icon: BookOpen,
  },
  {
    title: "Developers",
    description:
      "Integrate SnowMind via REST API. Automate deposits, withdrawals, and portfolio management.",
    href: "/developers/api-overview",
    icon: Code,
  },
];

export default function DocsHome() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        SnowMind Documentation
      </h1>
      <p className="mt-4 text-lg text-snow-muted leading-relaxed max-w-2xl">
        Everything you need to understand how SnowMind optimizes your yield on
        Avalanche — safely, transparently, and autonomously.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group rounded-xl border border-snow-border bg-snow-surface p-5 transition-all hover:-translate-y-0.5 hover:border-snow-red/30 hover:shadow-md"
          >
            <card.icon className="h-6 w-6 text-snow-red" />
            <h2 className="mt-3 font-semibold text-snow-text group-hover:text-snow-red transition-colors">
              {card.title}
            </h2>
            <p className="mt-1.5 text-sm text-snow-muted">{card.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-12 rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="font-semibold text-amber-800">Beta Notice</p>
        <p className="mt-1 text-sm text-amber-700">
          SnowMind is currently in beta on Avalanche mainnet with a $50K deposit
          cap. Start with small amounts. All deposits earn real yield.
        </p>
      </div>
    </div>
  );
}
