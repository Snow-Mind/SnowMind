import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Permissions & Keys",
  description: "How SnowMind's session keys work — scoped permissions, encryption, and user control.",
};

export default function PermissionsAndKeysPage() {
  return (
    <article className="prose max-w-none">
      <h1>Permissions &amp; Keys</h1>
      <p className="lead">
        Session keys are the mechanism that allows SnowMind to manage your yield without
        holding custody of your funds. They are temporary, scoped, and revocable.
      </p>

      <h2>What Are Session Keys?</h2>
      <p>
        A session key is a temporary cryptographic key granted to SnowMind&apos;s backend. Unlike
        your master key (which has full control), session keys are constrained by on-chain
        policies that limit exactly what operations they can perform.
      </p>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`Permission = 1 Signer + N Policies + 1 Action`}</code></pre>

      <h2>Session Key Policies</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Policy</th>
              <th>Configuration</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Call Policy</td>
              <td><code>supply()</code>/<code>withdraw()</code> and equivalent deposit/redeem functions on approved protocol adapters only</td>
            </tr>
            <tr>
              <td>Rate Limit</td>
              <td>Maximum N transactions per day</td>
            </tr>
            <tr>
              <td>Gas Policy</td>
              <td>Maximum total gas budget</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>What the Session Key Cannot Do</h2>
      <ul>
        <li>Call <code>transfer()</code> or <code>approve()</code> to arbitrary addresses (not in function whitelist)</li>
        <li>Interact with contracts not in the whitelist</li>
        <li>Exceed the daily transaction rate limit</li>
        <li>Exceed the gas budget</li>
      </ul>

      <Callout variant="success" title="On-Chain Enforcement">
        All session key policies are enforced by the smart account&apos;s Permission Validator
        at the EVM level. This means even if SnowMind&apos;s backend is compromised, the attacker
        is still bound by these constraints.
      </Callout>

      <h2>Session Key Storage</h2>
      <p>
        Session keys are <strong>never stored in plaintext</strong>. They are encrypted with
        AES-256-GCM at rest and decrypted only in-memory when building a UserOperation.
        The encryption key is stored separately from the database for additional security.
      </p>

      <h2>Withdrawing</h2>
      <p>
        You can withdraw your full balance at any time. This exits all protocol positions
        and returns your funds to your wallet. If you want to reset permissions, simply
        withdraw everything and re-deposit when ready.
      </p>

      <h2>Key Lifecycle</h2>
      <ol>
        <li><strong>Grant:</strong> User signs a transaction creating the session key with scoped policies</li>
        <li><strong>Active:</strong> SnowMind uses the key to execute rebalances (supply/withdraw only)</li>
      </ol>
    </article>
  );
}
