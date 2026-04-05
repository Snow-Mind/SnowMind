import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Foundation",
  description: "Why SnowMind exists and what it does for USDC holders on Avalanche.",
};

export default function FoundationPage() {
  return (
    <article className="prose max-w-none">
      <h1>Foundation</h1>
      <p className="lead">
        SnowMind is an autonomous yield optimization agent that finds and captures the best
        stablecoin yield across Avalanche — automatically and within safe boundaries.
      </p>

      <h2>Why SnowMind?</h2>
      <p>
        Earning the best yield on Avalanche requires constant manual work. Lending rates shift
        across protocols as supply and demand fluctuate, and no one has the time to monitor
        every protocol, compare rates, assess risks, and move capital at the right moment.
      </p>
      <p>
        For larger deposits, it gets harder. Depositing a large amount into a single protocol
        pushes the rate down because you increase supply and reduce utilization. The advertised
        APY is not the APY you actually receive.
      </p>
      <p>
        SnowMind eliminates this burden. You deposit USDC and SnowMind handles everything:
      </p>
      <ul>
        <li>
          <strong>Yield curve modeling:</strong> The agent models yield curves across every supported
          lending protocol, calculating exactly how your deposit size affects each protocol&apos;s rate.
        </li>
        <li>
          <strong>Optimal allocation:</strong> It finds the optimal allocation across protocols to
          maximize your blended yield, keeping capital in each protocol&apos;s higher-yield range.
        </li>
        <li>
          <strong>Safe rebalancing:</strong> When market conditions change, SnowMind rebalances —
          but only when the yield improvement exceeds all transaction costs.
        </li>
        <li>
          <strong>Non-custodial:</strong> Each user gets their own smart account. SnowMind operates
          through scoped session keys that can only interact with whitelisted protocols.
        </li>
        <li>
          <strong>Full transparency:</strong> Every allocation decision is visible and explainable
          in the dashboard. You can withdraw anytime.
        </li>
      </ul>

      <h2>What We Believe</h2>

      <h3>Transparent by Default</h3>
      <p>
        Every allocation, every rebalance, every risk decision is visible and explainable. You
        never have to wonder what is happening with your money or why.
      </p>

      <h3>Safety over Yield</h3>
      <p>
        We would rather miss 1% upside than expose you to unnecessary risk. Allocation limits
        and conservative defaults are not weaknesses — they are the product working correctly.
      </p>

      <h3>Simplicity is Respect</h3>
      <p>
        Complexity is our job to absorb, not yours to learn. Deposit, earn, understand why —
        that is the entire experience.
      </p>
    </article>
  );
}
