import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about SnowMind's yield optimization, custody, and security.",
};

const faqs = [
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
    a: "SnowMind runs health and safety checks on each integrated protocol, then allocates your USDC among the ones that pass — weighing TWAP-smoothed APY against risk and operational limits. Each protocol is capped at 15% of its available USDC liquidity to ensure withdrawals are always possible, and you can set your own per-protocol allocation limits.",
  },
  {
    q: "What are session keys?",
    a: "Session keys are scoped permissions that allow our backend to execute specific operations on your behalf. They're encrypted (AES-256-GCM) at rest, limited to approved contracts and functions, and rate-limited.",
  },
  {
    q: "Which protocols does SnowMind support?",
    a: "SnowMind supports a curated set of lending and yield protocols on Avalanche mainnet. The active set evolves over time as integrations are added or removed. We vet each integration for security, liquidity, and audit history using our 10-point risk scoring framework before enabling it.",
  },
  {
    q: "How often does SnowMind rebalance?",
    a: "The optimizer runs every 30 minutes but only rebalances when it's profitable to do so. A rebalance must clear multiple safety gates: APY improvement above 0.1%, movement above $1, gas cost justified by yield gain, and at least 6 hours since the last rebalance.",
  },
  {
    q: "How are protocol risk scores calculated?",
    a: "Each protocol is scored out of 10 across five categories: Protocol Safety (3 pts), Liquidity (3 pts), Collateral Quality (2 pts), Yield Profile (2 pts), and Architecture (1 pt). See the Protocol Assessment page for full details.",
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
