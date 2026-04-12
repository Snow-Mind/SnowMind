import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about SnowMind's yield optimization, custody, and security.",
};

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I know my agent won't do anything unexpected?",
    a: "SnowMind's agent operates through session keys that are scoped to specific contracts and functions — it can only supply and withdraw on protocols you've approved. It cannot transfer funds to external addresses, interact with unapproved contracts, or perform any action outside its defined permissions. The Snow Optimizer is fully deterministic — given the same inputs, it will always produce the same allocation. All operations are rate-limited and logged, so you can verify exactly what the agent has done at any time.",
  },
  {
    q: "Is SnowMind custodial?",
    a: "No. Your funds are held in your own ZeroDev smart account. SnowMind's backend can only execute the specific operations you've authorized via session keys (supply/withdraw on approved protocols). You can withdraw your full balance at any time.",
  },
  {
    q: "What happens if SnowMind goes down?",
    a: "Your funds continue earning yield in whichever protocol they're currently deposited in. You retain full ownership.",
  },
  {
    q: "How does the optimizer decide where to put my funds?",
    a: (
      <>
        Every cycle, the optimizer runs safety checks on each protocol — including utilization guards, APY velocity checks, sanity bounds, and circuit breakers — and discards any that fail. Among the protocols that pass, it identifies the best yield opportunity and allocates capital while respecting the 15% liquidity cap and your per-protocol limits. Rates are TWAP-smoothed over a 15-minute window to avoid chasing short-lived spikes. See the{" "}
        <a href="/learn/snow-optimizer" className="underline text-snow-accent">Snow Optimizer</a> page for the full breakdown.
      </>
    ),
  },
  {
    q: "What are session keys?",
    a: "Session keys are scoped permissions that allow our backend to execute specific operations on your behalf. They're encrypted (AES-256-GCM) at rest, limited to approved contracts and functions, and rate-limited.",
  },
  {
    q: "Which protocols does SnowMind support?",
    a: "SnowMind supports a curated set of lending and yield protocols on Avalanche mainnet. The active set evolves over time as integrations are added or removed. We vet each integration for security, liquidity, and audit history using our 9-point risk scoring framework before enabling it.",
  },
  {
    q: "How often does SnowMind rebalance?",
    a: "The optimizer runs every 30 minutes but only rebalances when it's profitable to do so. A rebalance must clear multiple safety gates: APY improvement above 0.1%, movement above $1, gas cost justified by yield gain, and at least 6 hours since the last rebalance.",
  },
  {
    q: "How are protocol risk scores calculated?",
    a: (
      <>
        Each protocol must first pass hard filters (audit, no recent exploits, verified source code). Those that pass are scored out of 9 across five categories: Oracle Quality (2 pts), Liquidity (3 pts), Collateral Quality (2 pts), Yield Profile (1 pt), and Architecture (1 pt). Liquidity and Yield Profile are updated daily from on-chain data, so scores reflect current market conditions. See the{" "}
        <a href="/learn/protocol-assessment" className="underline text-snow-accent">Protocol Assessment</a> page for full details.
      </>
    ),
  },
];

export default function FAQPage() {
  return (
    <article className="prose max-w-none">
      <h1>Frequently Asked Questions</h1>
      <div className="mt-8 space-y-6 not-prose">
        {faqs.map((faq, i) => (
          <div
            key={i}
            className="rounded-xl border border-snow-border bg-snow-surface p-5"
          >
            <h3 className="font-semibold text-snow-text">{faq.q}</h3>
            <p className="mt-2 text-sm leading-relaxed text-snow-muted">{faq.a}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
