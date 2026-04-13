import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Snow Optimizer",
  description: "How the Snow Optimizer allocates your USDC across approved integrations to maximize yield.",
};

export default function SnowOptimizerPage() {
  return (
    <article className="prose max-w-none">
      <h1>Snow Optimizer</h1>
      <p className="lead">
        The Snow Optimizer continuously evaluates yield across all supported protocols and
        allocates your USDC to maximize your blended APY within safe boundaries.
      </p>

      <h2>How the Algorithm Works</h2>
      <p>
        The optimizer ranks all healthy protocols by their effective TWAP APY and allocates
        capital starting from the highest-yielding protocol down:
      </p>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`1. Rank all healthy protocols by effective TWAP APY (highest first)
2. For each protocol in ranked order:
     - Check if it beats the base layer by the required margin
     - Allocate capital up to the protocol's TVL cap (7.5% of its TVL)
     - Respect any user-specified allocation limits
3. Park any remainder in the base allocation layer
4. If remaining > 0 after all protocols: hold idle in smart account`}</code></pre>

      <h2>Worked Example</h2>
      <p>With a $10,000 deposit and the following current rates:</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Protocol</th>
              <th>APY</th>
              <th>vs Baseline</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Protocol A</td>
              <td>4.2%</td>
              <td>+1.2%</td>
              <td>Accept (above 0.1% margin)</td>
            </tr>
            <tr>
              <td>Base Layer</td>
              <td>3.8%</td>
              <td>base layer</td>
              <td>Accept (base layer)</td>
            </tr>
            <tr>
              <td>Protocol B</td>
              <td>3.3%</td>
              <td>-0.5%</td>
              <td>Skip (below margin)</td>
            </tr>
            <tr>
              <td>Protocol C</td>
              <td>3.0%</td>
              <td>-0.8%</td>
              <td>Skip (below margin)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>Result:</p>
      <ul>
        <li><strong>Protocol A:</strong> $5,000</li>
        <li><strong>Base Layer:</strong> $5,000 (base layer receives the remainder)</li>
      </ul>

      <Callout variant="info" title="Why keep a beat margin?">
        A tiny APY gap can flip quickly and cause churn. The beat margin avoids
        unnecessary back-and-forth movement when differences are noise-level.
      </Callout>

      <h2>Allocation Limits</h2>
      <ul>
        <li><strong>User-specified limits:</strong> You can set your own maximum allocation per protocol, or leave it uncapped for full flexibility</li>
        <li><strong>7.5% TVL cap:</strong> Never deposits more than 7.5% of a protocol&apos;s total TVL to avoid impacting rates</li>
        <li><strong>$100K minimum TVL:</strong> Protocols below this threshold are excluded</li>
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
              <td>Per-second factor (1e18-scaled)</td>
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
        All rates are TWAP-smoothed over a 15-minute window before allocation decisions.
        On-chain protocol reads are authoritative.
      </p>

      <h2>Diversification Preferences</h2>
      <p>Users can choose a diversification preference that affects how the optimizer distributes funds:</p>
      <ul>
        <li><strong>Max Yield:</strong> Concentrate in the highest-yielding protocols</li>
        <li><strong>Balanced:</strong> Moderate spread across qualifying protocols</li>
        <li><strong>Diversified:</strong> Maximize the number of protocols used, reducing single-protocol exposure</li>
      </ul>

    </article>
  );
}
