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
        SnowMind prioritizes safety over yield. The agent continuously monitors every
        protocol in real time and reacts to threats — like utilization spikes, oracle
        manipulation, or protocol emergencies — before they can impact your funds.
      </p>

      <h2>Live Monitoring</h2>
      <p>
        SnowMind runs two independent monitoring systems around the clock. These are not
        periodic checks — they run continuously and can trigger emergency actions within
        seconds.
      </p>

      <h3>Utilization Monitor</h3>
      <p>
        A dedicated monitor polls on-chain utilization rates every few seconds for each
        protocol. If utilization spikes above the emergency threshold — or rises too
        fast (velocity detection) — the agent executes an <strong>immediate partial
        withdrawal</strong> without waiting for a scheduled rebalance.
      </p>
      <p>
        This protects against scenarios where a sudden surge in borrowing could lock up
        deposited USDC or signal an exploit in progress (e.g. oracle manipulation driving
        abnormal borrowing activity).
      </p>

      <h3>Protocol Health Checks</h3>
      <p>
        On every rebalance cycle, the agent evaluates each protocol across multiple
        safety dimensions:
      </p>
      <ol>
        <li><strong>Protocol status:</strong> detects emergency states, paused deposits, or paused withdrawals — triggers immediate withdrawal if active position exists</li>
        <li><strong>Utilization guard:</strong> utilization above 90% blocks new deposits to that protocol</li>
        <li><strong>APY velocity check:</strong> APY change above 25% in 30 minutes blocks new deposits — sudden rate spikes can indicate manipulation</li>
        <li><strong>Sanity bounds:</strong> TWAP APY above 25% is flagged as anomalous and the protocol is excluded</li>
        <li><strong>7-day stability:</strong> relative APY swing above 50% over the past week blocks new deposits</li>
        <li><strong>Liquidity cap check:</strong> if a live position exceeds 15% of the protocol&apos;s available liquidity, the agent forces a rebalance to reduce exposure</li>
        <li><strong>Circuit breaker:</strong> 3+ consecutive RPC failures auto-exclude the protocol until it recovers</li>
      </ol>

      <h2>Allocation Constraints</h2>
      <p>The optimizer enforces hard limits on every allocation:</p>
      <ul>
        <li><strong>15% liquidity cap:</strong> SnowMind never deposits more than 15% of a protocol&apos;s available USDC liquidity to ensure withdrawals are always possible</li>
        <li><strong>Minimum liquidity threshold:</strong> protocols below the minimum liquidity threshold are excluded from new deposits</li>
        <li><strong>Beat margin:</strong> a rebalance is skipped unless net APY improvement is at least 0.1%</li>
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
        and marked as anomalous. This prevents the optimizer from chasing artificially inflated
        rates that may indicate oracle manipulation or exploit activity.
      </p>

      <h2>Rebalance Execution Gates</h2>
      <p>
        Even after target allocations are computed, a rebalance only executes if all
        execution gates pass:
      </p>
      <ol>
        <li><strong>Cooldown:</strong> at least 6 hours since the last successful rebalance</li>
        <li><strong>Minimum movement:</strong> total movement must be at least $1</li>
        <li><strong>Profitability:</strong> estimated daily gain must exceed estimated execution cost</li>
        <li><strong>Max rebalance size:</strong> if a single rebalance would move more than the configured cap, it is halted for manual review</li>
        <li><strong>Idempotency guard:</strong> identical target allocations executed recently are skipped</li>
        <li><strong>Portfolio circuit breaker:</strong> if portfolio value drops more than 10% between runs, rebalancing is halted and alerts fire</li>
      </ol>
      <p>
        Emergency actions (forced withdrawals from utilization spikes or protocol emergencies)
        bypass cooldown and beat-margin gates — safety always takes priority over efficiency.
      </p>

      <h2>Daily Reconciliation</h2>
      <p>
        Once per day, SnowMind compares its internal records against actual on-chain balances.
        Any discrepancies are automatically corrected and flagged for review. This ensures the
        system stays in sync even if an unexpected on-chain event occurs.
      </p>

    </article>
  );
}
