import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "API Endpoints",
  description: "Reference for all SnowMind API endpoints: deposit, withdraw, portfolio queries, and more.",
};

export default function APIEndpointsPage() {
  return (
    <article className="prose max-w-none">
      <h1>API Endpoints Reference</h1>
      <p className="lead">
        Complete reference for SnowMind REST API endpoints. All requests require Privy authentication.
      </p>

      <h2>Portfolio Endpoints</h2>

      <h3>Get Portfolio State</h3>
      <p>
        <strong>GET</strong> <code>/portfolio/{'{address}'}</code>
      </p>
      <p>Fetch real-time balances, APY, and allocations for a smart account.</p>

      <h4>Parameters</h4>
      <ul>
        <li><code>address</code> (path, required) — Smart account address (0x-prefixed)</li>
      </ul>

      <h2>Deposit Endpoints</h2>

      <h3>Deposit with Protocol Selection</h3>
      <p>
        <strong>POST</strong> <code>/accounts/{'{address}'}/deposit</code>
      </p>
      <p>Record a USDC deposit, select protocols, and optionally trigger rebalance.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allowedProtocols": ["aave", "benqi", "spark"],
  "fundingTxHash": "0xabcd1234...",
  "fundingAmountUsdc": "1000.50",
  "fundingSource": "dashboard_wallet_transfer",
  "allocationCaps": {
    "aave": 50,
    "benqi": 30,
    "spark": 20
  },
  "triggerRebalance": true
}`}</code>
      </pre>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allowedProtocols": ["aave", "benqi", "spark"],
  "allocationCaps": {
    "aave": 50,
    "benqi": 30,
    "spark": 20
  },
  "effectiveCapTotalPct": 100,
  "idleRemainderPossible": false,
  "updatedRows": 1,
  "fundingTxHash": "0xabcd1234...",
  "fundingAmountUsdc": "1000.50",
  "fundingRecorded": true,
  "rebalanceQueued": true
}`}</code>
      </pre>

      <h2>Withdrawal Endpoints</h2>

      <h3>Preview Withdrawal</h3>
      <p>
        <strong>POST</strong> <code>/withdrawals/preview</code>
      </p>
      <p>Calculate fees and withdrawable amount without executing.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "smartAccountAddress": "0x...",
  "withdrawAmount": "500.00",
  "isFullWithdrawal": false
}`}</code>
      </pre>

      <h3>Execute Withdrawal</h3>
      <p>
        <strong>POST</strong> <code>/withdrawals/execute</code>
      </p>
      <p>Execute a full or partial withdrawal with a signed authorization.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "smartAccountAddress": "0x...",
  "withdrawAmount": "500.00",
  "isFullWithdrawal": false,
  "ownerSignature": "0x...",
  "signatureMessage": "SnowMind Withdrawal Authorization...",
  "signatureTimestamp": 1714540000
}`}</code>
      </pre>

      <Callout variant="warning" title="Signature Required">
        Every withdrawal must include a fresh user signature from the owner wallet. Agents cannot withdraw without user authorization.
      </Callout>

      <h2>Protocol Management</h2>

      <h3>Update Allowed Protocols</h3>
      <p>
        <strong>PUT</strong> <code>/accounts/{'{address}'}/allowed-protocols</code>
      </p>
      <p>Change the set of protocols SnowMind can deploy into.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allowedProtocols": ["aave", "benqi"]
}`}</code>
      </pre>

      <h3>Update Allocation Caps</h3>
      <p>
        <strong>PUT</strong> <code>/accounts/{'{address}'}/allocation-caps</code>
      </p>
      <p>Adjust per-protocol max allocation percentages.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allocationCaps": {
    "aave": 60,
    "benqi": 40
  }
}`}</code>
      </pre>

      <h2>Session Key Endpoints</h2>
      <p>
        Session keys grant SnowMind scoped execution permissions. These are required for automated deposits and withdrawals.
      </p>

      <h3>Store Session Key</h3>
      <p>
        <strong>POST</strong> <code>/accounts/{'{address}'}/session-key</code>
      </p>

      <h3>Revoke Session Key</h3>
      <p>
        <strong>POST</strong> <code>/accounts/{'{address}'}/session-key/revoke</code>
      </p>

      <h2>Authentication Header</h2>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>Authorization: Bearer {'{YOUR_PRIVY_TOKEN}'}</code>
      </pre>

      <h2>Error Responses</h2>
      <ul>
        <li><code>400 Bad Request</code> — Invalid parameters</li>
        <li><code>401 Unauthorized</code> — Missing or invalid auth token</li>
        <li><code>404 Not Found</code> — Account not found</li>
        <li><code>409 Conflict</code> — State conflict (funded protocol exclusion)</li>
        <li><code>429 Too Many Requests</code> — Rate limit exceeded</li>
        <li><code>500 Internal Server Error</code> — Retry later</li>
      </ul>
    </article>
  );
}
