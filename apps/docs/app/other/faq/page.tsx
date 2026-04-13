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
    a: "Your funds continue earning yield in whichever protocol they're currently deposited in. You retain full ownership and can withdraw directly through the protocol interfaces or by using your smart account's master key.",
  },
  {
    q: "How does the optimizer decide where to put my funds?",
    a: "SnowMind's optimizer ranks protocols by TWAP-smoothed APY and allocates capital starting from the highest-yielding protocol. Each protocol is capped at 7.5% of its TVL to prevent market impact. You can set your own allocation limits per protocol, and your diversification preference (Max Yield, Balanced, or Diversified) controls how funds are spread.",
  },
  {
    q: "What are session keys?",
    a: "Session keys are scoped permissions that allow our backend to execute specific operations on your behalf. They're encrypted (AES-256-GCM) at rest, limited to approved contracts and functions, and rate-limited.",
  },
  {
    q: "Which protocols does SnowMind support?",
    a: "SnowMind supports a curated set of lending and yield protocols on Avalanche mainnet. The active set evolves over time as integrations are added or removed. Each integration must pass hard filters (audit, exploit history, source verification), and then receives a 9-point informational risk score.",
  },
  {
    q: "How often does SnowMind rebalance?",
    a: "SnowMind checks rates continuously and rebalances when safety checks pass and the new allocation is meaningfully better. Cadence depends on deposit size: <=$3,000 (12h), <=$10,000 (4h), <=$100,000 (2h), >$100,000 (1h).",
  },
  {
    q: "What is the deposit limit?",
    a: "During beta, there is a $50,000 deposit cap per account. This limit will be raised as the system matures and undergoes formal audits.",
  },
  {
    q: "Can SnowMind steal my funds?",
    a: "No. The session key's permissions are enforced on-chain by the smart account's Permission Validator. Even a fully compromised backend can only execute supply/withdraw operations on whitelisted protocols. It cannot transfer funds to an arbitrary address.",
  },
  {
    q: "How are protocol risk scores calculated?",
    a: "Each protocol is scored out of 9 across five categories: Oracle Quality (2), Liquidity (3), Collateral Quality (2), Yield Profile (1), and Architecture (1). Liquidity and Yield Profile are dynamic and update daily from on-chain data. Scores are informational and do not control rebalancing execution.",
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
