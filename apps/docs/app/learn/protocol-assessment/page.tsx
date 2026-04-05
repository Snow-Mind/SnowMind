import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Protocol Assessment",
  description: "How SnowMind evaluates protocol risk using a transparent 9-point framework with daily dynamic updates.",
};

export default function ProtocolAssessmentPage() {
  return (
    <article className="prose max-w-none">
      <h1>Protocol Assessment</h1>
      <p className="lead">
        SnowMind evaluates every protocol using a transparent 9-point risk scoring framework.
        Scores help users assess risk at a glance and inform the AI assistant&apos;s explanations.
      </p>

      <Callout variant="info" title="Scores Are Informational">
        Scores are not used for rebalancing decisions — the optimizer has its own separate logic.
        This scoring is purely to help users decide which protocols to activate.
      </Callout>

      <Callout variant="warning" title="Daily Dynamic Updates">
        Liquidity and Yield Profile are refreshed every 24 hours from on-chain data.
        Oracle, Collateral, and Architecture are manual-review categories.
      </Callout>

      <h2>Hard Filters</h2>
      <p>
        Every protocol must pass all of the following to be listed on SnowMind. These are
        non-negotiable.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Filter</th>
              <th>Requirement</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Audit</td>
              <td>At least 1 completed security audit</td>
            </tr>
            <tr>
              <td>Exploit history</td>
              <td>No exploits in the past 12 months</td>
            </tr>
            <tr>
              <td>Source code</td>
              <td>Verified and published on a block explorer (e.g. Snowtrace)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        If a protocol fails any hard filter, it is excluded entirely — no score is given and
        it does not appear on the protocol selection page.
      </p>

      <h2>Scoring Categories (9 points max)</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Max Points</th>
              <th>Data Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Oracle Quality</td>
              <td>2</td>
              <td>Manual review</td>
            </tr>
            <tr>
              <td>Liquidity</td>
              <td>3</td>
              <td>On-chain (daily)</td>
            </tr>
            <tr>
              <td>Collateral Quality</td>
              <td>2</td>
              <td>Manual review</td>
            </tr>
            <tr>
              <td>Yield Profile</td>
              <td>1</td>
              <td>On-chain (daily)</td>
            </tr>
            <tr>
              <td>Architecture</td>
              <td>1</td>
              <td>Manual review</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>1. Oracle Quality (max 2 points)</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2</td>
              <td>
                Industry-standard oracle (Chainlink, Chronicle, Pyth, Edge/Chaos Labs)
                with on-chain verifiable configuration, or no external oracle dependency.
              </td>
            </tr>
            <tr>
              <td>1</td>
              <td>
                Reputable provider with additional trust assumptions (for example curator-controlled
                selection or limited battle testing).
              </td>
            </tr>
            <tr>
              <td>0</td>
              <td>
                Custom or unverifiable oracle logic, weak fallback design, or low-liquidity TWAP dependence.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>2. Liquidity (max 3 points)</h3>
      <p>
        Liquidity reflects available withdrawable USDC, not protocol-wide headline TVL.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>3</td>
              <td>Available liquidity &gt; $10M</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Available liquidity &gt; $1M</td>
            </tr>
            <tr>
              <td>1</td>
              <td>Available liquidity &gt; $500K</td>
            </tr>
            <tr>
              <td>0</td>
              <td>Available liquidity &lt;= $500K</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Lending markets use supplied minus borrowed as available liquidity.
        Spark uses vault instant buffer plus PSM USDC liquidity.
      </p>

      <h3>3. Collateral Quality (max 2 points)</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>2</td>
              <td>Blue-chip collateral or N/A for savings-vault style products</td>
            </tr>
            <tr>
              <td>1</td>
              <td>Mixed quality, including yield-bearing assets with additional depeg/slashing risk</td>
            </tr>
            <tr>
              <td>0</td>
              <td>Predominantly exotic, synthetic, or less-proven collateral</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>4. Yield Profile (max 1 point)</h3>
      <p>
        Yield profile is based on 30-day APY volatility from daily snapshots.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>APY std dev is less than 30% of mean APY</td>
            </tr>
            <tr>
              <td>0</td>
              <td>APY std dev is 30% or more of mean APY</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        At least 7 days of APY data are required. Before that, Yield Profile defaults to 0.
      </p>

      <h3>5. Architecture (max 1 point)</h3>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Direct deposit to the yield source</td>
            </tr>
            <tr>
              <td>0</td>
              <td>Curator or wrapper layer between SnowMind and the yield source</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Current Static Subtotals</h2>
      <p>
        Static subtotals are manual-review categories only (Oracle + Collateral + Architecture).
        Dynamic categories (Liquidity + Yield Profile) are added daily in runtime API responses.
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Protocol</th>
              <th>Oracle</th>
              <th>Collateral</th>
              <th>Architecture</th>
              <th>Static Total (/5)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Aave V3</td>
              <td>2</td>
              <td>1</td>
              <td>1</td>
              <td><strong>4</strong></td>
            </tr>
            <tr>
              <td>Benqi</td>
              <td>2</td>
              <td>2</td>
              <td>1</td>
              <td><strong>5</strong></td>
            </tr>
            <tr>
              <td>Spark (spUSDC)</td>
              <td>2</td>
              <td>2</td>
              <td>0</td>
              <td><strong>4</strong></td>
            </tr>
            <tr>
              <td>Euler V2 (9Summits)</td>
              <td>1</td>
              <td>1</td>
              <td>0</td>
              <td><strong>2</strong></td>
            </tr>
            <tr>
              <td>Silo (savUSD/USDC)</td>
              <td>2</td>
              <td>1</td>
              <td>1</td>
              <td><strong>4</strong></td>
            </tr>
            <tr>
              <td>Silo (sUSDp/USDC)</td>
              <td>0</td>
              <td>1</td>
              <td>1</td>
              <td><strong>2</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Runtime risk APIs return total score out of 9, category breakdown, and report-grounded
        explanation context for assistant flows.
      </p>
    </article>
  );
}
