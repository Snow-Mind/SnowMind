import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Protocol Assessment",
  description: "How SnowMind evaluates and scores the risk of each supported protocol using a transparent 9-point framework.",
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
        This scoring is purely to help users decide which protocols to activate. Scores reflect
        SnowMind&apos;s independent assessment based on publicly available on-chain data and
        documentation. They are not endorsements or financial advice. Users should conduct their
        own research before making decisions.
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
              <td>At least 1 completed security audit from a recognized firm</td>
            </tr>
            <tr>
              <td>Exploit history</td>
              <td>No exploits in the past 12 months (any version or deployment)</td>
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
      <p>
        Each listed protocol is scored across five categories. Three categories are reviewed
        manually when a protocol is onboarded. Two categories — Liquidity and Yield Profile —
        are updated automatically every 24 hours from on-chain data, so scores reflect current
        market conditions.
      </p>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Category</th>
              <th>Max Points</th>
              <th>Data Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>Oracle Quality</td>
              <td>2</td>
              <td>Manual review</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Liquidity</td>
              <td>3</td>
              <td>On-chain (updated daily)</td>
            </tr>
            <tr>
              <td>3</td>
              <td>Collateral Quality</td>
              <td>2</td>
              <td>Manual review</td>
            </tr>
            <tr>
              <td>4</td>
              <td>Yield Profile</td>
              <td>1</td>
              <td>On-chain (updated daily)</td>
            </tr>
            <tr>
              <td>5</td>
              <td>Architecture</td>
              <td>1</td>
              <td>Manual review</td>
            </tr>
            <tr>
              <td></td>
              <td><strong>Total</strong></td>
              <td><strong>9</strong></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>1. Oracle Quality (max 2 points)</h3>
      <p>
        How reliable and trustworthy are the price feeds that the protocol depends on?
        Oracle manipulation is one of the most common exploit vectors in DeFi lending,
        so the quality and independence of price feeds matters.
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
              <td>2</td>
              <td>
                Industry-standard oracle provider (e.g. Chainlink, Chronicle, Pyth) with
                multi-source aggregation and on-chain verifiable configuration. Or no external
                oracle dependency (e.g. yield rate set directly by protocol governance).
              </td>
            </tr>
            <tr>
              <td>1</td>
              <td>
                Reputable oracle provider, but with trust assumptions — for example, oracle
                selection is controlled by a third party (e.g. a vault curator), only a single
                price source with no fallback, or the provider has limited battle-testing at scale.
              </td>
            </tr>
            <tr>
              <td>0</td>
              <td>
                Custom or proprietary oracle, TWAP based on a low-liquidity pool, no fallback
                mechanism, or oracle logic that is not publicly verifiable on-chain.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>2. Liquidity (max 3 points)</h3>
      <p>
        How much USDC is actually available for withdrawal? This is checked every 24 hours
        from on-chain data.
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
              <td>Available liquidity &gt; $10M — deep liquidity, reliable withdrawal capacity</td>
            </tr>
            <tr>
              <td>2</td>
              <td>Available liquidity &gt; $1M — sufficient for most deposit sizes</td>
            </tr>
            <tr>
              <td>1</td>
              <td>Available liquidity &gt; $500K — limited capacity, may impact rates</td>
            </tr>
            <tr>
              <td>0</td>
              <td>Available liquidity &lt; $500K — withdrawals may be constrained</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout variant="info" title="How We Measure Liquidity">
        For lending protocols, available liquidity is total USDC supplied minus total USDC
        borrowed in the specific market SnowMind uses — not protocol-wide TVL. For savings
        vaults, it is the total USDC deposited (TVL) in the vault. This ensures the score
        reflects the actual capacity of each market.
      </Callout>

      <h3>3. Collateral Quality (max 2 points)</h3>
      <p>
        What assets are backing the USDC that SnowMind deposits? In lending protocols,
        borrowers post collateral to borrow USDC. If that collateral loses value faster
        than liquidators can act, it can create bad debt that affects depositors. For savings
        vaults with no borrowers, collateral quality considers the underlying asset risk instead.
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
              <td>2</td>
              <td>
                Blue-chip only — collateral consists of major, proven assets (BTC, ETH,
                USDC, etc.). Also applies to savings vaults where there are no borrowers
                and therefore no collateral risk.
              </td>
            </tr>
            <tr>
              <td>1</td>
              <td>
                Mixed — includes yield-bearing or wrapped assets (e.g. liquid staking tokens,
                yield-bearing stablecoins) that carry additional depeg or slashing risk.
              </td>
            </tr>
            <tr>
              <td>0</td>
              <td>
                Exotic or synthetic — primarily newer, unproven, or highly volatile collateral
                assets.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>4. Yield Profile (max 1 point)</h3>
      <p>
        How stable is the yield? This is calculated every 24 hours from on-chain data.
        SnowMind only considers organic yield (real borrower interest or protocol-set rates)
        — token incentives and airdrops are excluded from APY calculations.
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
              <td>
                Organic and stable — the 30-day APY standard deviation is less than 30%
                of the mean APY.
              </td>
            </tr>
            <tr>
              <td>0</td>
              <td>
                Organic but volatile — the 30-day APY standard deviation is 30% or more
                of the mean APY.
              </td>
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
              <th>Points</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>1</td>
              <td>
                Direct deposit — USDC is deposited directly into the lending pool or vault
                contract with no intermediary.
              </td>
            </tr>
            <tr>
              <td>0</td>
              <td>
                Through curator or wrapper — an additional contract layer sits between
                SnowMind and the yield source (e.g. a vault curator, meta-vault, PSM
                conversion, or savings wrapper).
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Dynamic vs. Static Scores</h2>
      <p>
        Three categories (Oracle Quality, Collateral Quality, Architecture) are scored once
        during our manual protocol review and only change when we reassess a protocol.
      </p>
      <p>
        Two categories (Liquidity, Yield Profile) are recalculated every 24 hours from
        on-chain data. This means a protocol&apos;s total score can change daily as market
        conditions shift — for example, if available liquidity drops below a threshold or
        yield becomes more volatile.
      </p>
    </article>
  );
}
