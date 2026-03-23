import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Protocol Assessment",
  description: "How SnowMind evaluates and scores the risk of each supported protocol using a transparent 10-point framework.",
};

export default function ProtocolAssessmentPage() {
  return (
    <article className="prose max-w-none">
      <h1>Protocol Assessment</h1>
      <p className="lead">
        SnowMind evaluates every protocol using a transparent 10-point risk scoring framework.
        Scores help users assess risk at a glance and inform the AI assistant&apos;s explanations.
      </p>

      <Callout variant="info" title="Scores Are Informational">
        Scores are not used for rebalancing decisions — the optimizer has its own separate logic.
        This scoring is purely to help users decide which protocols to activate.
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

      <h2>Scoring Categories (10 points max)</h2>

      <h3>1. Protocol Safety (max 2 points)</h3>
      <p>How secure and trustworthy is the protocol itself?</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Points</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Audited</td>
              <td>1</td>
              <td>At least 1 completed audit from a recognized firm</td>
            </tr>
            <tr>
              <td>No exploit history ever</td>
              <td>1</td>
              <td>Never exploited across any deployment or version</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Exploit history considers all versions. If v1 was exploited but v2 is a full rewrite,
        the point is still lost — the team&apos;s track record matters.
      </p>
      <p>
        Governance structure (DAO multisig vs EOA) is not scored separately but should be
        noted when explaining a protocol&apos;s risk profile.
      </p>

      <h3>2. Liquidity (max 3 points)</h3>
      <p>How much capital is in the protocol and how reliable is access to it? Checked every 24 hours.</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Points</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>TVL &gt; $10M</td>
              <td>3</td>
              <td>Large, established pool with deep liquidity</td>
            </tr>
            <tr>
              <td>TVL &gt; $1M</td>
              <td>2</td>
              <td>Moderate liquidity, sufficient for most deposit sizes</td>
            </tr>
            <tr>
              <td>TVL &gt; $500K</td>
              <td>1</td>
              <td>Smaller pool, limited capacity</td>
            </tr>
            <tr>
              <td>TVL &lt; $500K</td>
              <td>0</td>
              <td>Very small, deposits may significantly impact rates</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        TVL is measured as the total USDC deposited in the specific market/vault SnowMind
        interacts with, not the protocol&apos;s overall TVL across all assets and chains.
      </p>

      <h3>3. Collateral Quality (max 2 points)</h3>
      <p>What assets are borrowers posting as collateral against the USDC that SnowMind lends?</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Points</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Blue chip only or N/A</td>
              <td>2</td>
              <td>Collateral is BTC, ETH, USDC, or other major assets</td>
            </tr>
            <tr>
              <td>Mixed or yield-bearing stablecoins</td>
              <td>1</td>
              <td>Includes yield-bearing assets like sUSDe, savUSD with additional depeg risk</td>
            </tr>
            <tr>
              <td>Exotic or synthetic only</td>
              <td>0</td>
              <td>Entirely newer, less proven synthetic or algorithmic assets</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>4. Yield Profile (max 2 points)</h3>
      <p>How sustainable and predictable is the yield? Checked every 24 hours.</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Points</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Organic and stable</td>
              <td>2</td>
              <td>Yield from real borrower interest or protocol-set rates with low variance</td>
            </tr>
            <tr>
              <td>Organic but volatile</td>
              <td>1</td>
              <td>Real lending activity but fluctuates significantly</td>
            </tr>
            <tr>
              <td>Mostly incentive-driven</td>
              <td>0</td>
              <td>Primarily from token incentives that can end at any time</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>5. Architecture (max 1 point)</h3>
      <p>How directly does SnowMind interact with the yield source?</p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Points</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Direct deposit</td>
              <td>1</td>
              <td>USDC deposited directly into the lending pool or savings contract</td>
            </tr>
            <tr>
              <td>Through curator or wrapper</td>
              <td>0</td>
              <td>Additional layer (vault curator, meta-vault, savings wrapper)</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
