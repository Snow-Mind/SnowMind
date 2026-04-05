import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "How SnowMind Works",
  description: "A complete walkthrough of how SnowMind optimizes your yield across approved Avalanche integrations.",
};

export default function HowItWorksPage() {
  return (
    <article className="prose max-w-none">
      <h1>How SnowMind Works</h1>
      <p className="lead">
        SnowMind is built around three layers: a web app for user interaction, an optimization
        engine for yield decisions, and on-chain smart accounts for fund custody.
      </p>

      <h2>System Architecture</h2>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`┌──────────────────────────────────────────────────────┐
│  WEB APP                                             │
│  Authentication → ZeroDev Smart Account → Dashboard  │
└────────────────────┬─────────────────────────────────┘
                     │ HTTPS
┌────────────────────▼─────────────────────────────────┐
│  OPTIMIZATION ENGINE                                 │
│  Rate Fetcher → Allocator → Rebalancer → Executor    │
└────────────────────┬─────────────────────────────────┘
                     │ ERC-4337 UserOperations
┌────────────────────▼─────────────────────────────────┐
│  AVALANCHE C-CHAIN                                   │
│  ZeroDev Kernel v3.1 Smart Accounts                  │
│  Pimlico Paymaster (gas sponsoring)                  │
│  Whitelisted Lending & Yield Adapters                │
└──────────────────────────────────────────────────────┘`}</code></pre>

      <h2>Web App</h2>
      <p>
        The web app handles user-facing interactions:
      </p>
      <ul>
        <li><strong>Authentication:</strong> Wallet connect, email, and social login</li>
        <li><strong>Smart account creation:</strong> ZeroDev Kernel v3.1 (ERC-4337 + ERC-7579)</li>
        <li><strong>Session key grant:</strong> Scoped permissions signed by the user</li>
        <li><strong>Dashboard:</strong> Real-time portfolio view, allocation breakdown, and rebalance history</li>
      </ul>

      <h2>Optimization Engine</h2>
      <p>
        The backend optimization engine orchestrates the entire yield optimization loop:
      </p>
      <ol>
        <li><strong>Rate Fetcher:</strong> Reads on-chain APY from each protocol every 30 minutes</li>
        <li><strong>TWAP Smoothing:</strong> Applies 15-minute time-weighted averaging to prevent spot-rate manipulation</li>
        <li><strong>Cross-Validation:</strong> Compares on-chain rates against DefiLlama&apos;s yield API</li>
        <li><strong>Optimizer:</strong> Ranks protocols by APY and allocates capital optimally</li>
        <li><strong>Rebalancer:</strong> Builds ERC-4337 UserOperations for withdrawals and deposits</li>
        <li><strong>Executor:</strong> Signs UserOps with the session key and submits via Pimlico bundler</li>
      </ol>

      <h2>On-Chain</h2>
      <p>
        All fund custody happens on Avalanche C-Chain through ERC-4337 smart accounts:
      </p>
      <ul>
        <li><strong>ZeroDev Kernel v3.1:</strong> Smart account with modular validators and executors</li>
        <li><strong>Pimlico Paymaster:</strong> Sponsors gas for all rebalancing transactions (free to users)</li>
        <li><strong>Protocol interactions:</strong> Direct supply/withdraw via approved protocol adapters</li>
      </ul>

      <h2>The Rebalancing Loop</h2>
      <p>
        Every 30 minutes, the backend runs the following loop for each account:
      </p>
      <ol>
        <li>Fetch current APY from all active protocols</li>
        <li>Smooth rates with TWAP and cross-validate against DefiLlama</li>
        <li>Run the optimizer to compute the optimal allocation</li>
        <li>Check if the rebalance meets all safety gates (see below)</li>
        <li>If approved, build and execute a batch UserOperation</li>
      </ol>

      <Callout variant="info" title="Rebalance Safety Gates">
        A rebalance only executes when <strong>all</strong> conditions are met: total movement
        exceeds $1, APY improvement exceeds 0.1%, daily yield gain exceeds gas cost, at
        least 6 hours since last rebalance, and no rate anomalies detected.
      </Callout>

      <h2>Fee Model</h2>
      <p>
        SnowMind charges <strong>10% on profits only</strong>. There are no deposit fees, no
        management fees, and gas costs are sponsored.
      </p>
      <h2>Key Design Decisions</h2>
      <ul>
        <li>
          <strong>Yield optimizer:</strong> Ranks protocols by APY and allocates capital to maximize
          your blended yield — transparent, auditable, and deterministic.
        </li>
        <li>
          <strong>ZeroDev Kernel v3.1:</strong> Native ERC-7579 modular smart accounts with
          EntryPoint v0.7 and 6M+ accounts deployed in production.
        </li>
        <li>
          <strong>Avalanche-native:</strong> Gas costs are significantly lower than on Ethereum,
          allowing the agent to rebalance even when APY improvements are relatively small.
        </li>
        <li>
          <strong>Non-custodial by design:</strong> Session keys enforce supply/withdraw-only
          permissions at the EVM level. Even a fully compromised backend cannot steal funds.
        </li>
      </ul>
    </article>
  );
}
