import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Getting Started",
  description: "Connect your wallet and start earning optimized yield on Avalanche with SnowMind.",
};

export default function GettingStartedPage() {
  return (
    <article className="prose max-w-none">
      <h1>Getting Started</h1>
      <p className="lead">
        Deposit USDC and start earning optimized yield on Avalanche in under two minutes.
      </p>

      <h2>Prerequisites</h2>
      <ul>
        <li>A wallet with USDC on Avalanche C-Chain (MetaMask, Rabby, or any EVM wallet)</li>
        <li>A small amount of AVAX for the initial smart account deployment (gas is sponsored after setup)</li>
      </ul>

      <h2>Step 1: Connect Your Wallet</h2>
      <p>
        Visit <strong>snowmind.xyz</strong> and click <strong>Launch App</strong>. SnowMind supports
        wallet connect, email, and social login. Choose whichever method you prefer.
      </p>

      <h2>Step 2: Create Your Smart Account</h2>
      <p>
        On first login, SnowMind deploys a <strong>ZeroDev Kernel v3.1 smart account</strong> for you.
        This is your personal, non-custodial vault — you retain full ownership at all times.
      </p>
      <p>
        The smart account is deployed using <strong>CREATE2</strong> (counterfactual deployment), meaning
        its address is deterministic and known before the deployment transaction.
      </p>

      <h2>Step 3: Grant a Session Key</h2>
      <p>
        You will be asked to sign a transaction that grants SnowMind a <strong>scoped session key</strong>.
        This key allows the AI agent to execute <em>only</em> supply and withdraw operations on
        whitelisted DeFi protocols. It cannot transfer your funds anywhere else.
      </p>
      <h2>Step 4: Deposit USDC</h2>
      <p>
        Transfer USDC to your smart account address. Once the deposit is detected, SnowMind
        immediately begins optimizing your yield across supported protocols.
      </p>

      <Callout variant="warning" title="Beta Deposit Cap">
        During beta, there is a <strong>$50,000 deposit cap</strong> per account. Start with
        small amounts to get comfortable with the system. All deposits earn real yield.
      </Callout>

      <h2>Step 5: Monitor on the Dashboard</h2>
      <p>
        Your dashboard shows real-time allocations, current APY per protocol, rebalance history,
        and a full explanation of every allocation decision. SnowMind rebalances automatically
        every 30 minutes when conditions warrant it.
      </p>

      <h2>Withdrawing</h2>
      <p>
        Click <strong>Withdraw All</strong> at any time. SnowMind atomically exits all protocol
        positions and returns your balance to your wallet in a single transaction.
      </p>
      <p>
        If SnowMind is ever unavailable, you retain full access to your smart account via your
        master key. You can interact directly with the protocols to withdraw your funds.
      </p>
    </article>
  );
}
