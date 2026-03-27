import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Risk Management",
  description: "How SnowMind manages risk through allocation caps, rate validation, circuit breakers, and safety gates.",
};

export default function RiskManagementPage() {
  return (
    <article className="prose max-w-none">
      <h1>Risk Management</h1>
      <p className="lead">
        SnowMind prioritizes safety over yield. Multiple independent safeguards protect
        your funds at every layer of the stack.
      </p>

      <h2>Allocation Constraints</h2>
      <p>The optimizer enforces hard limits on every allocation:</p>
      <ul>
        <li><strong>7.5% TVL cap:</strong> SnowMind never deposits more than 7.5% of a protocol&apos;s total USDC TVL to prevent market impact</li>
        <li><strong>$100K minimum TVL:</strong> Protocols below the minimum liquidity threshold are excluded from new deposits</li>
        <li><strong>Beat margin:</strong> A rebalance is skipped unless net APY improvement is at least 0.1%</li>
      </ul>

      <h2>Rate Validation</h2>

      <h3>TWAP Smoothing</h3>
      <p>
        Raw spot rates are smoothed using a <strong>15-minute Time-Weighted Average Price</strong> (TWAP)
        before allocation decisions. Outlier snapshots are excluded and at least two snapshots are
        required before a TWAP is treated as reliable.
      </p>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`twap_rate = Σ(rate_i × Δt_i) / Σ(Δt_i)   over 15-minute window`}</code></pre>

      <h3>Sanity Bounds</h3>
      <p>
        Any protocol reporting a TWAP APY greater than <strong>25%</strong> is excluded from deposits
        and marked as anomalous.
      </p>

      <h2>Protocol Health Checks</h2>
      <p>
        Before every allocation run, SnowMind evaluates each protocol with additional risk gates:
      </p>
      <ol>
        <li><strong>Protocol status checks:</strong> emergency state, deposits paused, withdrawals paused</li>
        <li><strong>Utilization guard:</strong> utilization above 90% excludes new deposits</li>
        <li><strong>Velocity check:</strong> APY change above 25% in 30 minutes excludes new deposits</li>
        <li><strong>Exploit detection:</strong> TWAP APY above 2× yesterday&apos;s average plus utilization above 90% triggers an immediate withdrawal from that protocol</li>
        <li><strong>7-day stability check:</strong> relative APY swing above 50% excludes new deposits</li>
        <li><strong>Circuit breaker:</strong> 3+ consecutive RPC failures exclude the protocol until recovery</li>
        <li><strong>Existing position cap check:</strong> if a live position exceeds the TVL cap share, SnowMind forces a rebalance out of the excess</li>
      </ol>

      <h2>Rebalance Execution Gates</h2>
      <p>
        Even after target allocations are computed, a rebalance only executes if execution gates pass:
      </p>
      <ol>
        <li><strong>Cooldown:</strong> at least 6 hours since the last successful rebalance</li>
        <li><strong>Minimum movement:</strong> total movement must be at least $1</li>
        <li><strong>Profitability:</strong> estimated daily gain must exceed estimated execution cost</li>
        <li><strong>Max rebalance size:</strong> if a single rebalance would move more than the configured cap, it is halted for manual review</li>
        <li><strong>Idempotency guard:</strong> identical target allocations executed recently are skipped</li>
        <li><strong>Portfolio circuit breaker:</strong> if portfolio value drops more than 10% between runs, rebalancing is halted and alerts fire</li>
      </ol>

    </article>
  );
}
