import type { Metadata } from "next";
import { Callout } from "@/components/callout";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API Overview",
  description: "Integrate SnowMind programmatically. Automate deposits, withdrawals, and portfolio management via REST API.",
};

export default function APIOverviewPage() {
  return (
    <article className="prose max-w-none">
      <h1>API Overview</h1>
      <p className="lead">
        Build custom integrations with SnowMind. Programmatically manage deposits, withdrawals, allocations, and portfolio state without the web UI.
      </p>

      <h2>What You Can Do</h2>
      <p>
        The SnowMind API enables external agents, bots, and applications to:
      </p>
      <ul>
        <li><strong>Deposit USDC</strong> with protocol selection and allocation caps</li>
        <li><strong>Withdraw</strong> fully or partially, triggering atomic on-chain execution</li>
        <li><strong>Update protocol scope</strong> on-the-fly without redeploying</li>
        <li><strong>Adjust allocation caps</strong> per protocol (0–100%)</li>
        <li><strong>Query portfolio state</strong> in real-time (balances, APY, rebalance history)</li>
        <li><strong>Manage session keys</strong> for programmatic access</li>
      </ul>

      <h2>Use Cases</h2>
      <ul>
        <li><strong>Treasury management</strong> — Automate institutional yield farming</li>
        <li><strong>Discord/Telegram bots</strong> — Let users deposit/withdraw via chat</li>
        <li><strong>Third-party portfolio optimizers</strong> — Route yield to SnowMind as one option</li>
        <li><strong>Mobile apps</strong> — Alternative UI for SnowMind integration</li>
        <li><strong>Yield aggregators</strong> — Compare SnowMind performance alongside other protocols</li>
      </ul>

      <h2>Authentication</h2>
      <p>
        All API endpoints require <strong>Privy authentication</strong>. You will:
      </p>
      <ol>
        <li>Create a Privy account (or use existing login)</li>
        <li>Extract the <code>authorizationToken</code> from your Privy session</li>
        <li>Include it in the <code>Authorization: Bearer</code> header</li>
      </ol>

      <Callout variant="info" title="Privy Required">
        Privy handles user identity and session management. Your smart account address is derived from your wallet and Privy ID.
      </Callout>

      <h2>Base URL</h2>
      <p>
        All requests go to:
      </p>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto">
        <code>https://api.snowmind.xyz/api/v1</code>
      </pre>

      <h2>Response Format</h2>
      <p>
        All responses are JSON. Success responses return data directly; errors return:
      </p>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "detail": "Error message describing what went wrong"
}`}</code>
      </pre>

      <h2>Rate Limits</h2>
      <p>
        API endpoints have per-minute rate limits:
      </p>
      <ul>
        <li><strong>Deposit</strong>: 15 requests/minute</li>
        <li><strong>Withdraw</strong>: 15 requests/minute</li>
        <li><strong>Update protocols</strong>: 20 requests/minute</li>
        <li><strong>Portfolio queries</strong>: 30 requests/minute</li>
      </ul>
      <p>
        Exceeding limits returns HTTP 429. Retry after a short delay with exponential backoff.
      </p>

      <h2>Common Workflow</h2>
      <ol>
        <li>Register your smart account via <code>POST /accounts/register</code></li>
        <li>Grant a session key with <code>POST /accounts/{'{address}'}/store-session-key</code></li>
        <li>Deposit USDC with protocol selection via <code>POST /accounts/{'{address}'}/deposit</code></li>
        <li>Monitor portfolio with <code>GET /portfolio/{'{address}'}</code></li>
        <li>Withdraw when needed via <code>POST /accounts/{'{address}'}/withdraw</code></li>
      </ol>

      <h2>Next Steps</h2>
      <p>
        Ready to integrate? Check out:
      </p>
      <ul>
        <li>
          <Link href="/developers/api-endpoints" className="text-snow-red hover:underline">
            API Endpoints Reference
          </Link>
          {" — Details on every endpoint"}
        </li>
        <li>
          <Link href="/developers/sdk-examples" className="text-snow-red hover:underline">
            SDK Examples
          </Link>
          {" — Code samples for TypeScript and Python"}
        </li>
      </ul>

      <Callout variant="warning" title="Beta API">
        The SnowMind API is in beta. Endpoints and response shapes may change. Subscribe to updates on GitHub for breaking changes.
      </Callout>
    </article>
  );
}
