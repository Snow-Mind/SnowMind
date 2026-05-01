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
      <p>Fetch real-time portfolio balances, APY, and rebalance history for an account.</p>

      <h4>Parameters</h4>
      <ul>
        <li><code>address</code> (path, required) — Smart account address (0x-prefixed)</li>
      </ul>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "accountAddress": "0x...",
  "totalDepositedUsd": "1000.50",
  "totalYieldUsd": "12.34",
  "allocations": [
    {
      "protocolId": "aave",
      "balanceUsd": "500.25",
      "apy": 5.2,
      "weight": 50
    }
  ],
  "rebalanceHistory": [
    {
      "timestamp": "2026-05-01T10:30:00Z",
      "status": "completed",
      "changes": [...],
      "txHash": "0x..."
    }
  ]
}`}</code>
      </pre>

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

      <h4>Errors</h4>
      <ul>
        <li><code>400</code> — Invalid protocol list or allocation caps</li>
        <li><code>404</code> — Account not found</li>
        <li><code>409</code> — No active session key; grant one first</li>
      </ul>

      <h2>Withdrawal Endpoints</h2>

      <h3>Preview Withdrawal</h3>
      <p>
        <strong>POST</strong> <code>/accounts/{'{address}'}/withdraw/preview</code>
      </p>
      <p>Calculate fees and final balance for a withdrawal without executing it.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "withdrawAmountUsdc": "500.00",
  "withdrawAll": false
}`}</code>
      </pre>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "withdrawAmountUsdc": "500.00",
  "feeAmountUsdc": "2.50",
  "netProceeds": "497.50",
  "timestamp": "2026-05-01T10:30:00Z"
}`}</code>
      </pre>

      <h3>Execute Withdrawal</h3>
      <p>
        <strong>POST</strong> <code>/accounts/{'{address}'}/withdraw</code>
      </p>
      <p>Execute a full or partial withdrawal. Atomically exits all protocol positions.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "withdrawAmountUsdc": "500.00",
  "withdrawAll": false,
  "ownerSignature": "0x..."
}`}</code>
      </pre>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "success": true,
  "userOpHash": "0x...",
  "finalBalance": "500.00",
  "feeAmount": "2.50",
  "txHash": "0x...",
  "status": "pending"
}`}</code>
      </pre>

      <h2>Protocol Management Endpoints</h2>

      <h3>Update Allowed Protocols</h3>
      <p>
        <strong>PUT</strong> <code>/accounts/{'{address}'}/allowed-protocols</code>
      </p>
      <p>Change the set of protocols SnowMind can use for your account.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allowedProtocols": ["aave", "benqi"]
}`}</code>
      </pre>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allowedProtocols": ["aave", "benqi"],
  "allocationCaps": {
    "aave": 50,
    "benqi": 50
  },
  "effectiveCapTotalPct": 100,
  "idleRemainderPossible": false,
  "updatedRows": 1
}`}</code>
      </pre>

      <h3>Update Allocation Caps</h3>
      <p>
        <strong>PUT</strong> <code>/accounts/{'{address}'}/allocation-caps</code>
      </p>
      <p>Adjust the maximum % allocation per protocol.</p>

      <h4>Request Body</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allocationCaps": {
    "aave": 60,
    "benqi": 40
  }
}`}</code>
      </pre>

      <h4>Response</h4>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>{`{
  "allocationCaps": {
    "aave": 60,
    "benqi": 40
  },
  "allowedProtocols": ["aave", "benqi"],
  "effectiveCapTotalPct": 100,
  "idleRemainderPossible": false,
  "updatedRows": 1
}`}</code>
      </pre>

      <h2>Authentication Header</h2>
      <p>
        Include your Privy auth token in every request:
      </p>
      <pre className="bg-snow-surface border border-snow-border p-4 rounded-lg overflow-x-auto text-sm">
        <code>Authorization: Bearer {'{YOUR_PRIVY_AUTH_TOKEN}'}</code>
      </pre>

      <Callout variant="info" title="Getting Your Auth Token">
        After logging in to SnowMind with Privy, retrieve your token from the Privy session. See <strong>SDK Examples</strong> for code.
      </Callout>

      <h2>Error Responses</h2>
      <p>
        All errors return JSON with an HTTP status code:
      </p>
      <ul>
        <li><code>400 Bad Request</code> — Invalid parameters</li>
        <li><code>401 Unauthorized</code> — Missing or invalid auth token</li>
        <li><code>404 Not Found</code> — Account or resource not found</li>
        <li><code>409 Conflict</code> — State conflict (e.g., funded protocol cannot be deselected)</li>
        <li><code>429 Too Many Requests</code> — Rate limit exceeded</li>
        <li><code>500 Internal Server Error</code> — Server error; retry later</li>
      </ul>

      <Callout variant="warning" title="Retry Logic">
        Implement exponential backoff for 429 and 5xx errors. Do not retry 400/401/404 errors.
      </Callout>
    </article>
  );
}
