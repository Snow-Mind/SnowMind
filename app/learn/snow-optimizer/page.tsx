import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Snow Optimizer",
  description: "How the Snow Optimizer allocates your USDC across approved integrations to maximize yield.",
};

export default function SnowOptimizerPage() {
  return (
    <article className="prose max-w-none">
      <h1>Snow Optimizer</h1>
      <p className="lead">
        The Snow Optimizer continuously runs safety checks across all supported protocols,
        then routes your USDC to the best-qualified destination — not just the highest number.
      </p>

      <h2>How It Works</h2>
      <p>
        Every cycle, the optimizer screens all integrated protocols through a series of health
        and safety checks before making any allocation decision:
      </p>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`1. Run safety checks on every protocol (rates, TVL, anomalies)
2. Discard any protocol that fails a check
3. Among protocols that pass, identify the best yield opportunity
4. Allocate capital — respecting TVL caps and user limits
5. Park any remainder in the base allocation layer`}</code></pre>
      <p>
        Learn about specific health checks at:{" "}
        <a href="/learn/risk-management">Risk Management</a>
      </p>

      <h2>Allocation Limits</h2>
      <ul>
        <li><strong>User-specified limits:</strong> You can set your own maximum allocation per protocol, or leave it uncapped for full flexibility</li>
        <li><strong>15% liquidity cap:</strong> Never deposits more than 15% of a protocol&apos;s available USDC liquidity to ensure withdrawals are always possible</li>
        <li><strong>Minimum liquidity threshold:</strong> Protocols below the minimum liquidity threshold are excluded</li>
      </ul>

      <h2>Rate Sources</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Protocol</th>
              <th>On-Chain Source</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pool-based lending market</td>
              <td><code>Pool.getReserveData(asset).currentLiquidityRate</code></td>
              <td>RAY (÷ 1e27)</td>
            </tr>
            <tr>
              <td>Interest-bearing token market</td>
              <td><code>qiToken.supplyRatePerTimestamp()</code></td>
              <td>Per-second rate</td>
            </tr>
            <tr>
              <td>Vault-style market</td>
              <td>ERC-4626 vault share price growth</td>
              <td>Share price delta</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        All rates are TWAP-smoothed over a 15-minute window before being used in allocation decisions.
      </p>

    </article>
  );
}
