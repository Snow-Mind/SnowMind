import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "API Overview",
  description: "Integrate SnowMind programmatically. Automate deposits, withdrawals, and portfolio management via REST API.",
};

export default function APIOverviewPage() {
  return (
    <article className="prose max-w-none">
      <h1>API Overview</h1>
      <p className="lead">
        Build external integrations with SnowMind. Your agent can deposit, rebalance, and withdraw without using the web UI.
      </p>

      <h2>Who This Is For</h2>
      <ul>
        <li>Treasury automation bots</li>
        <li>AI agents (Claude Code, OpenClaw, custom scripts)</li>
        <li>Mobile or backend applications</li>
        <li>Portfolio managers and yield aggregators</li>
      </ul>

      <h2>Base URL</h2>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto">
        <code>https://api.snowmind.xyz/api/v1</code>
      </pre>

      <h2>Authentication</h2>
      <p>
        Every request requires a <strong>Privy auth token</strong> in the <code>Authorization</code> header.
      </p>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>Authorization: Bearer {'{YOUR_PRIVY_TOKEN}'}</code>
      </pre>

      <Callout variant="info" title="Privy Required">
        Privy is used for user identity and session management. Your agent must act on behalf of a logged-in user.
      </Callout>

      <h2>Credentials an Agent Needs</h2>
      <ul>
        <li><strong>Privy auth token</strong> for the user</li>
        <li><strong>Smart account address</strong> (0x-prefixed)</li>
        <li><strong>Active session key</strong> (already stored in SnowMind)</li>
        <li><strong>Wallet signing access</strong> for deposits and withdrawals</li>
      </ul>

      <h2>Where Private Keys Live</h2>
      <ul>
        <li><strong>User wallet private key</strong> stays in the user wallet (MetaMask, Rabby, WalletConnect). SnowMind never stores it.</li>
        <li><strong>Session key private key</strong> is stored server-side in SnowMind and is scoped to protocol actions only.</li>
      </ul>

      <Callout variant="warning" title="Never Share Wallet Keys">
        If an agent needs to sign on-chain transfers, it must run in a user-controlled environment (wallet extension, WalletConnect, or secure custody). SnowMind does not store user wallet keys.
      </Callout>

      <h2>Agent Deposit Flow</h2>
      <ol>
        <li>User funds the smart account with USDC (agent can do this only if it can sign the wallet transfer).</li>
        <li>Agent calls <code>POST /accounts/{'{address}'}/deposit</code> with selected protocols and the funding transaction hash.</li>
        <li>SnowMind records the deposit and queues a rebalance.</li>
      </ol>

      <h3>What the Agent Must Provide</h3>
      <ul>
        <li>USDC transfer transaction hash</li>
        <li>USDC amount deposited</li>
        <li>Allowed protocol list</li>
        <li>Optional allocation caps</li>
      </ul>

      <h2>Agent Withdrawal Flow</h2>
      <ol>
        <li>Agent calls <code>POST /withdrawals/preview</code> (optional) to calculate fees and available liquidity.</li>
        <li>User signs a withdrawal authorization message with their wallet.</li>
        <li>Agent submits <code>POST /withdrawals/execute</code> with that signature.</li>
        <li>SnowMind uses the session key to redeem positions and sends USDC to the user wallet.</li>
      </ol>

      <h3>What the Agent Must Provide</h3>
      <ul>
        <li>Withdrawal amount and full/partial flag</li>
        <li>Owner signature + signed message + timestamp</li>
      </ul>

      <Callout variant="info" title="No Automatic Withdrawals Without Wallet Access">
        Withdrawals require a fresh user signature. Fully automated withdrawals only work if the agent can request a signature or has delegated wallet access.
      </Callout>

      <h2>Next Steps</h2>
      <ul>
        <li>
          <Link href="/developers/api-endpoints" className="text-snow-red hover:underline">
            API Endpoints Reference
          </Link>
          {" — exact request and response shapes"}
        </li>
        <li>
          <Link href="/developers/sdk-examples" className="text-snow-red hover:underline">
            SDK Examples
          </Link>
          {" — TypeScript and Python snippets"}
        </li>
      </ul>
    </article>
  );
}
