import type { Metadata } from "next";
import { Callout } from "@/components/callout";

export const metadata: Metadata = {
  title: "Smart Accounts",
  description: "How ZeroDev Kernel v3.1 smart accounts provide non-custodial fund safety in SnowMind.",
};

export default function SmartAccountsPage() {
  return (
    <article className="prose max-w-none">
      <h1>Smart Accounts</h1>
      <p className="lead">
        Every SnowMind user gets their own non-custodial smart account. Your funds stay in
        your account at all times — SnowMind never holds custody.
      </p>

      <h2>Why Smart Accounts?</h2>
      <p>
        A normal wallet (EOA) requires manual signing for every transaction. A smart account
        is a smart contract acting as the user&apos;s wallet, with programmable rules:
      </p>
      <ul>
        <li>Your funds stay in <strong>your own</strong> smart account</li>
        <li>SnowMind&apos;s AI agent gets a <strong>limited session key</strong> that can only call approved DeFi protocol functions</li>
        <li>The agent can rebalance yields but <strong>can never steal funds</strong></li>
      </ul>

      <h2>ZeroDev Kernel v3.1</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Standards</td>
              <td>ERC-4337 + ERC-7579</td>
            </tr>
            <tr>
              <td>EntryPoint</td>
              <td>v0.7 (<code>0x0000000071727De22E5E9d8BAf0edAc6f37da032</code>)</td>
            </tr>
            <tr>
              <td>Modules</td>
              <td>Validators, Executors, Hooks, Fallback Handlers</td>
            </tr>
            <tr>
              <td>Deployment</td>
              <td>Counterfactual (CREATE2) — address known before deployment</td>
            </tr>
            <tr>
              <td>Accounts deployed</td>
              <td>6M+ across production systems</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>ERC-4337 Transaction Flow</h2>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`AI Agent creates UserOperation
        ↓
Pimlico Bundler validates and bundles UserOp
        ↓
EntryPoint contract receives the bundle
        ↓
EntryPoint → Kernel.validateUserOp()
        ↓
Kernel routes to Permission Validator (session key)
        ↓
Permission Validator checks:
  ✓ Signature valid for this session key?
  ✓ Target contract is whitelisted?
  ✓ Function selector is whitelisted?
  ✓ Rate limit not exceeded?
  ✓ Timestamp within valid window?
        ↓
All pass → Execute → Protocol interaction
Any fail → Reject UserOp`}</code></pre>

      <Callout variant="success" title="Non-Custodial by Design">
        Even if SnowMind&apos;s backend is fully compromised, the attacker can only execute
        supply/withdraw operations on whitelisted protocols. They cannot transfer your funds
        to an arbitrary address — this is enforced at the EVM level by the smart account.
      </Callout>

      <h2>Defense in Depth</h2>
      <pre className="bg-snow-surface border border-snow-border text-sm"><code>{`Layer 1: Session Key Scoping (on-chain, EVM-enforced)
         → Only approved contracts + functions
         → Rate limits, time bounds, gas caps

Layer 2: TWAP + Cross-Validation (off-chain)
         → 15-min smoothed rates
         → 25% APY sanity cap

Layer 3: Allocator Constraints (off-chain)
         → 7.5% TVL cap per protocol
         → Beat-margin and movement gates

Layer 4: Application Security (off-chain)
         → AES-256-GCM session key encryption at rest
         → Authenticated API access
         → Rate limiting

Layer 5: Emergency (user-controlled)
         → Withdraw full balance at any time
         → Direct smart account access via master key
         → Works even if SnowMind backend is down`}</code></pre>

      <h2>Key Infrastructure</h2>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pimlico</td>
              <td>ERC-4337 bundler + paymaster (gas sponsoring)</td>
            </tr>
            <tr>
              <td>ZeroDev</td>
              <td>Smart account SDK + deployment</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  );
}
