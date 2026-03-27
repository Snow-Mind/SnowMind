# ZeroDev Kernel — Smart Account Architecture Deep Dive

## For SnowMind Technical Reference

---

## Table of Contents

1. [The Big Picture — Why Smart Accounts Exist](#1-the-big-picture)
2. [ERC-4337 — The Foundation Layer](#2-erc-4337)
3. [ERC-7579 — The Modular Standard](#3-erc-7579)
4. [ZeroDev Kernel — The Implementation](#4-zerodev-kernel)
5. [Plugin System — Sudo vs Regular Validators](#5-plugin-system)
6. [Session Keys & Permissions — The Heart of Automation](#6-session-keys--permissions)
7. [Policy Types — Granular Control](#7-policy-types)
8. [Transaction Automation Flow — End to End](#8-transaction-automation-flow)
9. [Gas Sponsorship & Paymaster](#9-gas-sponsorship--paymaster)
10. [UserOperation Lifecycle — Step by Step](#10-useroperation-lifecycle)
11. [How Kernel Connects to SnowMind](#11-how-kernel-connects-to-snowmind)
12. [Comparison with Competitor Smart Account Choices](#12-comparison-with-competitors)
13. [Key Architectural Diagrams](#13-key-architectural-diagrams)

---

## 1. The Big Picture

### The Problem with Normal Wallets (EOAs)

A normal Ethereum wallet (MetaMask, etc.) is called an **EOA — Externally Owned Account**. It's just a private key that signs transactions. The problem:

- **It can't think for itself.** Every transaction needs a human to sign it manually.
- **No custom rules.** You can't say "only allow transactions to these 3 contracts" or "max spend $500/day."
- **No automation.** An AI agent can't autonomously rebalance your yield positions because it would need your private key — which means it could steal everything.
- **You pay gas yourself.** Every transaction costs gas, paid from your own ETH balance.

### The Solution: Smart Accounts

A **smart account** is a smart contract that acts as your wallet. Instead of a private key directly controlling funds, a **contract** controls funds — and that contract can have programmable rules.

Think of it like this:
- **EOA** = A house with one key. Whoever has the key can do anything.
- **Smart Account** = A house with a security system. You can give a guest a limited key that only opens the front door between 9am-5pm, and the security system enforces it.

For SnowMind, this means: **the user's funds stay in their smart account, and SnowMind's AI agent gets a limited "session key" that can ONLY call approved DeFi protocols with approved parameters.** The agent can rebalance yields, but can never steal funds.

---

## 2. ERC-4337 — The Foundation Layer

ERC-4337 is the Ethereum standard that makes smart accounts work **without changing the core Ethereum protocol**. It was designed by Vitalik Buterin and others.

### The Key Idea

Instead of sending regular transactions (which only EOAs can initiate), ERC-4337 introduces a new object called a **UserOperation** (UserOp). A UserOp is like a "meta-transaction" — it describes what the smart account should do, and a separate infrastructure handles executing it.

### The Four Actors

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│    USER      │────▶│   BUNDLER    │────▶│  ENTRYPOINT  │────▶│ SMART ACCOUNT │
│ (or Agent)   │     │  (Relayer)   │     │ (Singleton)  │     │  (Kernel)     │
└─────────────┘     └──────────────┘     └──────────────┘     └───────────────┘
                                               │
                                               ▼
                                         ┌──────────────┐
                                         │  PAYMASTER   │
                                         │ (Gas Sponsor)│
                                         └──────────────┘
```

1. **User (or Agent)** — Creates and signs a UserOperation. In SnowMind's case, the AI agent creates UserOps to rebalance yield positions.

2. **Bundler** — A specialized node that collects UserOps from multiple users, validates them, and bundles them into a single regular Ethereum transaction. Think of it as a "post office" that batches letters. ZeroDev's bundler is called **UltraRelay** (30% less gas, 20% faster than standard bundlers).

3. **EntryPoint** — A singleton smart contract deployed once on each chain. It's the "gatekeeper." The Bundler sends the bundled transaction to the EntryPoint, which then:
   - **Verification Loop**: Checks each UserOp is valid (correct signature, enough gas, etc.)
   - **Execution Loop**: Calls each smart account to execute the requested action

4. **Paymaster** — An optional contract that can **pay gas on behalf of the user**. This means the user (or agent) doesn't need ETH for gas. In SnowMind, the project sponsors gas so the AI agent can operate without holding ETH.

### The UserOperation Structure

A UserOperation contains everything needed to execute an action:

```solidity
struct PackedUserOperation {
    address sender;          // The smart account address
    uint256 nonce;           // Replay protection (192-bit key + 64-bit sequence)
    bytes initCode;          // Factory address + data (only for first-time deployment)
    bytes callData;          // What the account should actually DO (e.g., "swap 100 USDC for AVAX")
    bytes32 accountGasLimits; // Packed: verificationGasLimit + callGasLimit
    uint256 preVerificationGas; // Gas for bundler overhead
    bytes32 gasFees;         // Packed: maxFeePerGas + maxPriorityFeePerGas
    bytes paymasterAndData;  // Paymaster address + verification/post-op gas + paymaster-specific data
    bytes signature;         // Signed by the account's validator (ECDSA, passkey, or session key)
}
```

**In simple terms:** A UserOp is a package that says "I am smart account X, I want to do Y, here's my signature proving I'm allowed to, and here's who's paying for gas."

### Account Creation (Counterfactual Deployment)

Smart accounts use **CREATE2** for deterministic addresses. This means:

1. **Before deployment**: You can calculate the account's address from the owner's public key + a salt (index number). The account "exists" at that address even before it's deployed.
2. **First UserOperation**: When the account sends its first UserOp, the `initCode` field tells the EntryPoint to call the Factory contract, which deploys the smart account to that pre-calculated address.
3. **Subsequent UserOps**: The `initCode` is empty because the account is already deployed.

**This is powerful because:** You can send funds to a smart account address before it even exists on-chain. It only actually deploys when it first needs to act. This saves gas for accounts that are created but never used.

### Nonce System

ERC-4337 uses a **semi-abstracted nonce**:
- **Key (192 bits)**: Identifies a "channel" — you can have parallel, non-interfering sequences
- **Sequence (64 bits)**: Must increment sequentially within each channel

This allows an agent to send multiple independent UserOps in parallel using different nonce keys, without them blocking each other.

---

## 3. ERC-7579 — The Modular Standard

ERC-7579 builds on top of ERC-4337. While 4337 defines *how* smart accounts interact with the network, 7579 defines *how smart accounts are built internally* — specifically, how they support **swappable, composable modules**.

### Why Modularity Matters

Without ERC-7579, every smart account implementation is different. A validator written for Safe won't work with Kernel, and vice versa. ERC-7579 standardizes the interfaces so modules become **portable**. Write once, use in any 7579-compliant account.

For SnowMind, this means: if a better validator or security module comes out, you can swap it into Kernel without rewriting your entire security architecture.

### The Four Module Types

ERC-7579 defines exactly four types of modules:

#### Type 1: Validator
**Purpose:** Decides if a UserOperation is authorized.

```
UserOp arrives → EntryPoint calls account.validateUserOp() → Account calls Validator module
                                                                      │
                                                          ✅ Valid signature → Execute
                                                          ❌ Invalid → Reject
```

- The validator checks the `signature` field of the UserOp
- Returns `SIG_VALIDATION_SUCCESS` (0) or `SIG_VALIDATION_FAILED` (1)
- Can also return a time range (validAfter, validUntil) for time-limited access

**For SnowMind:** The ECDSA validator checks the owner's signature. Session key validators check the AI agent's limited key + enforce policies.

#### Type 2: Executor
**Purpose:** Can trigger actions *on behalf of* the account, via a callback.

```
External trigger → Executor module → calls account.executeFromExecutor() → Action executed
```

- Executors can call arbitrary functions through the account
- They use a special callback: `executeFromExecutor(mode, executionCalldata)`
- Used for: automated actions, scheduled tasks, conditional execution

**For SnowMind:** An executor module could allow the optimizer to trigger rebalancing based on external conditions (e.g., a keeper network calling the executor when yield drops).

#### Type 3: Fallback Handler
**Purpose:** Extends the account with new functions it doesn't natively have.

When someone calls a function on the smart account that doesn't exist in its code, the `fallback()` function routes it to the appropriate Fallback Handler module. This lets you add new capabilities (like ERC-721 receiving, or custom DeFi interactions) without upgrading the core account.

#### Type 4: Hook
**Purpose:** Runs code *before and after* every execution — like middleware.

```
UserOp validated → Hook.preCheck(msg.sender, msgValue, msgData) → Execute → Hook.postCheck(hookData)
                         │                                                        │
                    "Should this run?"                                   "Did anything go wrong?"
```

- `preCheck()`: Can inspect the incoming call and return context data. If it reverts, the execution is blocked.
- `postCheck()`: Receives the context from preCheck and can verify post-conditions.

**For SnowMind:** A hook could enforce invariants like "total portfolio value must not decrease by more than 2% in a single transaction" — the preCheck snapshots the balance, and postCheck verifies it.

### Execution Modes

ERC-7579 encodes how an execution should happen in a `bytes32` mode:

```
| callType (1 byte) | execType (1 byte) | unused (4 bytes) | modeSelector (4 bytes) | modePayload (22 bytes) |
```

- **callType**: `0x00` = single call, `0x01` = batch (multiple calls), `0xfe` = staticcall, `0xff` = delegatecall
- **execType**: `0x00` = revert on failure, `0x01` = try (continue on failure, return success/failure data)

### Module Lifecycle

```
Install: account.installModule(moduleTypeId, module, initData) → module.onInstall(initData)
Remove:  account.uninstallModule(moduleTypeId, module, deInitData) → module.onUninstall(deInitData)
Check:   account.isModuleInstalled(moduleTypeId, module, additionalContext) → bool
```

Modules store their state per-account (using `msg.sender` as the key), so one module can serve many accounts without state conflicts.

---

## 4. ZeroDev Kernel — The Implementation

### What Kernel Actually Is

**Kernel** is ZeroDev's implementation of an ERC-4337 + ERC-7579 compatible smart account. It's the most widely used modular smart account — powering **6 million+ accounts across 50+ networks**.

| Property | Value |
|----------|-------|
| Current Version | v3.1 (recommended for new projects) |
| EntryPoint | v0.7 (latest ERC-4337) |
| Language | Solidity (99.7% of codebase) |
| License | MIT |
| GitHub Stars | 238 |
| Audit Status | Winner of inaugural Ethereum AA grant |
| Deployment | Via [kernel.zerodev.app](https://kernel.zerodev.app) portal |

### Kernel's Architecture in One Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        KERNEL v3.1                                 │
│                   (ERC-4337 + ERC-7579)                           │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    MODULE SLOTS                              │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │  │
│  │  │   SUDO      │  │   REGULAR    │  │    FALLBACK        │  │  │
│  │  │ VALIDATOR   │  │  VALIDATORS  │  │    HANDLERS        │  │  │
│  │  │ (Owner)     │  │ (Session keys│  │ (Extensions)       │  │  │
│  │  │             │  │  Passkeys,   │  │                    │  │  │
│  │  │ Can:        │  │  Multisig)   │  │                    │  │  │
│  │  │ - Do all    │  │              │  │                    │  │  │
│  │  │ - Enable/   │  │ Can:         │  │                    │  │  │
│  │  │   disable   │  │ - Limited    │  │                    │  │  │
│  │  │   plugins   │  │   actions    │  │                    │  │  │
│  │  └─────────────┘  └──────────────┘  └────────────────────┘  │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌──────────────┐                          │  │
│  │  │  EXECUTORS  │  │    HOOKS     │                          │  │
│  │  │ (Automation │  │ (Pre/Post    │                          │  │
│  │  │  triggers)  │  │  checks)     │                          │  │
│  │  └─────────────┘  └──────────────┘                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                 CORE LOGIC                                  │    │
│  │  - validateUserOp() → routes to correct validator           │    │
│  │  - execute() → ERC-7579 execution modes                    │    │
│  │  - installModule() / uninstallModule()                      │    │
│  │  - Fallback routing                                         │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  ┌──────────────┐              ┌──────────────┐
  │  ENTRYPOINT  │              │   PAYMASTER   │
  │    v0.7      │              │  (ZeroDev /   │
  │              │              │   UltraRelay) │
  └──────────────┘              └──────────────┘
```

### The ZeroDev SDK

The SDK is built on top of **Viem** (a TypeScript Ethereum library) and provides high-level functions:

```typescript
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk"
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"
import { KERNEL_V3_1, ENTRYPOINT_ADDRESS_V07 } from "@zerodev/sdk/constants"

// Step 1: Create a validator from the owner's signer
const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
  signer: ownerSigner,           // The owner's private key / wallet
  entryPoint: ENTRYPOINT_ADDRESS_V07,
  kernelVersion: KERNEL_V3_1,
})

// Step 2: Create the Kernel account
const account = await createKernelAccount(publicClient, {
  plugins: {
    sudo: ecdsaValidator,        // Owner = sudo validator
  },
  entryPoint: ENTRYPOINT_ADDRESS_V07,
  kernelVersion: KERNEL_V3_1,
  index: 0n,                     // Salt for deterministic address (BigInt)
})

// Step 3: Create the account client (sends UserOps)
const kernelClient = createKernelAccountClient({
  account,
  chain: avalanche,
  bundlerTransport: http(BUNDLER_URL),
  paymaster: {
    getPaymasterData: paymasterClient.sponsorUserOperation,
  },
})
```

**Key Insight:** The `index` parameter is a BigInt salt. The same owner with different indices gets different account addresses. This is useful for having multiple smart accounts per user.

---

## 5. Plugin System — Sudo vs Regular Validators

Kernel has exactly two tiers of validators — this is its core security model.

### Sudo Validator (The Owner)

- Set during account creation
- Has **full control** over the account — can do anything
- Can **enable and disable** other (regular) validators
- Typically an ECDSA signer (the user's wallet key), but could be a passkey or multisig

**Analogy:** The sudo validator is the building owner who has the master key and can issue/revoke guest keycards.

### Regular Validators (Session Keys, etc.)

- Enabled by the sudo validator
- Have **limited permissions** — defined by policies
- Used for: AI agents, session keys, automated bots, dApps
- Can be revoked at any time by the sudo validator

**Analogy:** A regular validator is a guest keycard that only opens specific doors during specific hours.

### Lazy Enabling

Kernel's clever optimization: regular validators are **not enabled on-chain until they're first used**. When the sudo validator creates a session key, it signs an approval off-chain. The first time the session key is used in a UserOp, the approval is included and the regular validator gets enabled on-chain automatically.

This saves gas because you don't need a separate transaction just to enable a session key.

```
Owner signs approval off-chain (free)
         │
         ▼
Agent's first UserOp includes the approval
         │
         ▼
Kernel sees: "Oh, this regular validator isn't enabled yet, 
              but there's a valid sudo signature approving it."
         │
         ▼
Kernel enables the validator on-chain + executes the UserOp
         │
         (All in one transaction)
```

---

## 6. Session Keys & Permissions — The Heart of Automation

This is the most important section for SnowMind. Session keys are how the AI agent gets limited, revocable access to the user's smart account.

### The Permission Formula

```
Permission = 1 Signer + N Policies + 1 Action
```

- **Signer**: The cryptographic identity. Who is making the request? (ECDSA key, passkey, multisig)
- **Policies**: The rules. What are they allowed to do? (Call certain contracts, spend max $X, rate limits)
- **Action**: The capability. What function can they execute on the account? (Usually `execute()` or a custom function)

### Creating a Permission Validator

```typescript
import { toPermissionValidator } from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"
import { toCallPolicy } from "@zerodev/permissions/policies"

// 1. Create an ECDSA signer for the AI agent
const agentSigner = toECDSASigner({
  signer: agentPrivateKey,   // Agent's own key (NOT the owner's key!)
})

// 2. Define policies (what the agent can do)
const callPolicy = toCallPolicy({
  permissions: [
    {
      target: BENQI_POOL_ADDRESS,          // Can only call Benqi
      valueLimit: 0n,                       // Can't send native AVAX
      abi: benqiAbi,                        // The contract ABI
      functionName: "supply",               // Can only call supply()
      args: [
        {
          condition: ParamCondition.EQUAL,
          value: USDC_ADDRESS,              // Can only supply USDC
        },
        null,                               // Any amount (or add a LESS_THAN constraint)
      ],
    },
    {
      target: AAVE_V3_POOL_ADDRESS,        // Can also call Aave V3
      valueLimit: 0n,
      abi: aaveAbi,
      functionName: "supply",
      args: [
        {
          condition: ParamCondition.EQUAL,
          value: USDC_ADDRESS,
        },
        null,
        null,
        null,
      ],
    },
  ],
})

// 3. Combine into a permission validator
const permissionPlugin = await toPermissionValidator(publicClient, {
  entryPoint: ENTRYPOINT_ADDRESS_V07,
  kernelVersion: KERNEL_V3_1,
  signer: agentSigner,
  policies: [callPolicy],    // Can stack multiple policies!
})
```

### How Permissions Flow Through the System

```
Agent creates UserOp (signed with session key)
         │
         ▼
EntryPoint calls Kernel.validateUserOp(userOp, userOpHash, missingAccountFunds)
         │
         ▼
Kernel sees: "This signature maps to a REGULAR validator (permission plugin)"
         │
         ▼
Permission Plugin checks:
  1. ✅ Signer: Is the signature valid for this session key?
  2. ✅ Policies: Does callData target an allowed contract?
  3. ✅ Policies: Is the function name allowed?
  4. ✅ Policies: Do the arguments satisfy all ParamConditions?
  5. ✅ Policies: Is the rate limit within bounds?
  6. ✅ Policies: Is the current time within the validity window?
  7. ✅ Action: Is the account-level function allowed?
         │
All pass ──▶ Return SIG_VALIDATION_SUCCESS (0)
Any fail ──▶ Return SIG_VALIDATION_FAILED (1) ──▶ UserOp rejected
```

---

## 7. Policy Types — Granular Control

Kernel provides 6 built-in policy types that can be **composed together** on a single session key. ALL policies must pass for a UserOp to be valid.

### 7.1 Call Policy (Most Important for SnowMind)

Controls which contracts, functions, and parameters the session key can call.

```typescript
import { toCallPolicy, ParamCondition, CallPolicyVersion } from "@zerodev/permissions/policies"

const policy = toCallPolicy({
  policyVersion: CallPolicyVersion.V0_0_4,  // Latest version
  permissions: [
    {
      target: CONTRACT_ADDRESS,      // Which contract
      valueLimit: 0n,                // Max native token (AVAX) sent with call
      abi: contractAbi,              // ABI for type-safe arg checking
      functionName: "deposit",       // Which function
      args: [
        {
          condition: ParamCondition.EQUAL,
          value: TOKEN_ADDRESS,       // First arg must equal this
        },
        {
          condition: ParamCondition.LESS_THAN,
          value: parseEther("1000"), // Second arg must be < 1000
        },
      ],
    },
  ],
})
```

**ParamCondition Operators:**
| Operator | Meaning |
|----------|---------|
| `EQUAL` | Argument must exactly equal the value |
| `GREATER_THAN` | Argument must be > value |
| `LESS_THAN` | Argument must be < value |
| `GREATER_THAN_OR_EQUAL` | Argument must be >= value |
| `LESS_THAN_OR_EQUAL` | Argument must be <= value |
| `NOT_EQUAL` | Argument must not equal value |

**For SnowMind:** The call policy defines which DeFi protocols (Benqi, Aave V3, Euler V2, Fluid) the AI agent can interact with, which functions it can call (supply, withdraw, borrow, repay), and what parameter bounds exist.

### 7.2 Gas Policy

Limits the total gas the session key can spend:

```typescript
import { toGasPolicy } from "@zerodev/permissions/policies"

const gasPolicy = toGasPolicy({
  allowed: parseEther("0.5"),  // Max 0.5 AVAX in gas total
})
```

**For SnowMind:** Prevents a runaway agent from burning unlimited gas.

### 7.3 Rate Limit Policy

Controls how many UserOps the session key can send per time interval:

```typescript
import { toRateLimitPolicy } from "@zerodev/permissions/policies"

// With automatic reset (e.g., 10 operations per hour, resets every hour)
const rateLimitWithReset = toRateLimitPolicy({
  count: 10,
  interval: 3600,  // seconds (1 hour)
})

// Without reset (e.g., 100 operations total, ever)
const rateLimitNoReset = toRateLimitPolicy({
  count: 100,
  interval: 0,  // 0 means no reset — just a lifetime cap
})
```

**For SnowMind:** Limits the agent to a reasonable number of rebalancing operations (e.g., 6 per day for standard tier, 12 per day for premium — similar to ZYF.AI's tiered model).

### 7.4 Timestamp Policy

Limits the session key to a specific time window:

```typescript
import { toTimestampPolicy } from "@zerodev/permissions/policies"

const timestampPolicy = toTimestampPolicy({
  validAfter: 1700000000,   // Unix timestamp — key becomes valid
  validUntil: 1700086400,   // Unix timestamp — key expires (24 hours later)
})
```

**For SnowMind:** Session keys can auto-expire after 24 hours, requiring the user to re-approve. This limits damage from a compromised session key.

### 7.5 Signature Policy

Controls what messages the session key can sign (ERC-1271 signatures):

```typescript
import { toSignaturePolicy } from "@zerodev/permissions/policies"

const sigPolicy = toSignaturePolicy({
  allowedRequestors: [DAPP_ADDRESS],  // Only this contract can request signatures
})
```

### 7.6 Sudo Policy

Grants unrestricted access — the session key can do anything. **Never use this for an AI agent.** Only for owner-equivalent access.

```typescript
import { toSudoPolicy } from "@zerodev/permissions/policies"
const sudoPolicy = toSudoPolicy()  // Unrestricted
```

### Composing Multiple Policies

The real power is **stacking policies**. ALL must pass:

```typescript
const permissionPlugin = await toPermissionValidator(publicClient, {
  entryPoint: ENTRYPOINT_ADDRESS_V07,
  kernelVersion: KERNEL_V3_1,
  signer: agentSigner,
  policies: [
    callPolicy,       // Can only call approved contracts + functions
    gasPolicy,        // Max 0.5 AVAX gas total
    rateLimitPolicy,  // Max 6 rebalances per day
    timestampPolicy,  // Expires in 24 hours
  ],
})
```

The agent's UserOp must satisfy **every single policy** to be valid. If any one fails, the entire operation is rejected.

---

## 8. Transaction Automation Flow — End to End

This is the complete flow for how SnowMind's AI agent would operate:

### Phase 1: Setup (One-Time)

```
┌────────────────────────────────────────────────────────────┐
│ USER (Owner)                                                │
│                                                            │
│ 1. Creates Kernel smart account (ECDSA sudo validator)     │
│ 2. Deposits USDC into the smart account                    │
│ 3. Connects to SnowMind frontend                          │
│ 4. Reviews & approves session key policies                 │
└────────────────────────────────────────────────────────────┘
```

### Phase 2: Session Key Creation

```
┌──────────────┐                           ┌──────────────┐
│  SNOWMIND    │                           │    USER      │
│  BACKEND     │                           │  (Frontend)  │
│              │  1. Generate ECDSA key    │              │
│              │     (agent's own key)      │              │
│              │                           │              │
│              │  2. Send public key ──────▶│              │
│              │                           │              │
│              │                           │ 3. User sees: │
│              │                           │   "SnowMind  │
│              │                           │    wants      │
│              │                           │    permission │
│              │                           │    to call    │
│              │                           │    Benqi,     │
│              │                           │    Aave V3,   │
│              │                           │    Euler V2   │
│              │                           │    Max 6x/day │
│              │                           │    Expires    │
│              │                           │    24 hours"  │
│              │                           │              │
│              │                           │ 4. User signs │
│              │                           │    approval   │
│              │◀── 5. Serialized ─────────│    (off-chain)│
│              │       permission account  │              │
└──────────────┘                           └──────────────┘
```

The serialization step is crucial. The SDK provides:

```typescript
// On the USER'S side (frontend):
const serialized = await serializePermissionAccount(permissionAccount)
// This is a string containing everything the agent needs

// On the AGENT'S side (backend):
const kernelClient = await deserializePermissionAccount(
  publicClient,
  ENTRYPOINT_ADDRESS_V07,
  KERNEL_V3_1,
  serialized,         // The serialized permission
  bundlerTransport,
)
// Now the agent has a fully functional client with limited permissions
```

### Phase 3: Autonomous Operation

```
┌──────────────────────────────────────────────────────────────────┐
│ SNOWMIND AI AGENT (runs continuously)                            │
│                                                                  │
│  MILP Optimizer: "Benqi USDC rate dropped to 3.2%.              │
│                   Aave V3 USDC rate is 4.7%.                     │
│                   Recommended: Move 60% from Benqi to Aave V3." │
│                                                                  │
│  Agent constructs UserOp:                                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Step 1: Withdraw 6000 USDC from Benqi                     │  │
│  │ Step 2: Supply 6000 USDC to Aave V3                       │  │
│  │ (Batched as a single atomic UserOp via encodeCalls)        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Agent signs UserOp with session key                             │
│  Agent sends UserOp to Bundler                                   │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────┐
│   BUNDLER    │  Validates UserOp, bundles it
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  ENTRYPOINT  │  Calls Kernel.validateUserOp()
│    v0.7      │         │
└──────┬───────┘         ▼
       │          ┌──────────────────┐
       │          │ PERMISSION PLUGIN │
       │          │ ✅ Valid session key signature
       │          │ ✅ Target = Benqi (allowed)
       │          │ ✅ Function = withdraw (allowed)
       │          │ ✅ Amount < maxLimit
       │          │ ✅ Rate: 3rd of 6 today
       │          │ ✅ Time: within 24h window
       │          └──────────────────┘
       │
       ▼
┌──────────────┐
│    KERNEL    │  Executes batch:
│  (Smart Acct)│  1. Benqi.withdraw(6000 USDC) ✅
│              │  2. Aave.supply(6000 USDC)    ✅
└──────────────┘
       │
       ▼
  ┌──────────────┐
  │  PAYMASTER   │  Sponsors gas (user pays nothing)
  └──────────────┘
```

### Phase 4: Monitoring & Revocation

```typescript
// Batch operations using encodeCalls
const txHash = await kernelClient.sendTransaction({
  calls: [
    {
      to: BENQI_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: benqiAbi,
        functionName: "withdraw",
        args: [USDC_ADDRESS, 6000n * 10n**6n, account.address],
      }),
    },
    {
      to: AAVE_V3_POOL,
      value: 0n,
      data: encodeFunctionData({
        abi: aaveAbi,
        functionName: "supply",
        args: [USDC_ADDRESS, 6000n * 10n**6n, account.address, 0],
      }),
    },
  ],
})
```

**Revocation:** The owner can revoke the session key at any time:

```typescript
await sudoKernelClient.uninstallPlugin({
  plugin: permissionPlugin,
})
// Agent immediately loses all access — next UserOp will fail validation
```

---

## 9. Gas Sponsorship & Paymaster

### How It Works

The Paymaster is a contract that **pays gas on behalf of the user**. The flow:

```
UserOp.paymasterAndData = [paymaster_address | verification_gas | post_op_gas | paymaster_data]

1. EntryPoint calls Paymaster.validatePaymasterUserOp(userOp, userOpHash, maxCost)
2. Paymaster checks: "Should I sponsor this? Is the project's gas credits sufficient?"
3. If yes: returns context data
4. EntryPoint executes the UserOp (gas is paid by Paymaster's deposit in EntryPoint)
5. EntryPoint calls Paymaster.postOp() for any cleanup/accounting
```

### ZeroDev Paymaster Setup

```typescript
import { createZeroDevPaymasterClient } from "@zerodev/sdk"

const paymasterClient = createZeroDevPaymasterClient({
  chain: avalanche,
  transport: http(PAYMASTER_URL),
})

// Use it when creating the kernel client:
const kernelClient = createKernelAccountClient({
  account,
  chain: avalanche,
  bundlerTransport: http(BUNDLER_URL),
  paymaster: {
    getPaymasterData(userOperation) {
      return paymasterClient.sponsorUserOperation({ userOperation })
    },
  },
})
```

### UltraRelay

ZeroDev's **UltraRelay** combines the Bundler and Paymaster into a single service:
- **30% less gas** than standard bundler+paymaster setups
- **20% lower latency** (fewer network hops)
- Currently supports: Base, Arbitrum, Optimism, Polygon, HyperEVM, and others
- **NOT yet on Avalanche** — SnowMind would need to check for Avalanche support or use standard bundler/paymaster

### Gas Funding Options

1. **Gas Credits** — Pre-purchase gas credits on ZeroDev dashboard
2. **Credit Card** — Direct payment for gas sponsorship
3. **Gas Policies** — Configure on dashboard: max gas per UserOp, max total gas per day, whitelist contracts

---

## 10. UserOperation Lifecycle — Step by Step

Here's the complete lifecycle of a single UserOperation from creation to on-chain execution:

```
Step 1: CONSTRUCTION
─────────────────────
Agent's code creates a UserOp object:
  - sender: user's Kernel smart account address
  - nonce: fetched from EntryPoint.getNonce(sender, key)
  - callData: encoded function call (e.g., execute(mode, encodedBatchCalls))
  - signature: empty (will be filled after signing)
  - paymasterAndData: empty (will be filled by paymaster)

Step 2: GAS ESTIMATION
─────────────────────
SDK calls Bundler's eth_estimateUserOperationGas:
  - Returns: preVerificationGas, verificationGasLimit, callGasLimit
  - Bundler simulates the UserOp against the EntryPoint

Step 3: PAYMASTER STAMPING
─────────────────────
SDK calls Paymaster.sponsorUserOperation:
  - Paymaster checks if the UserOp should be sponsored
  - Returns: paymasterAndData (including paymaster address + signature)
  - SDK fills in the paymasterAndData field

Step 4: SIGNING
─────────────────────
SDK calls the session key signer to sign the UserOp hash:
  - userOpHash = EntryPoint.getUserOpHash(userOp)
  - signature = signer.sign(userOpHash)
  - SDK fills in the signature field

Step 5: SUBMISSION
─────────────────────
SDK calls Bundler's eth_sendUserOperation(userOp, entryPointAddress):
  - Bundler receives the UserOp
  - Returns: userOpHash (for tracking)

Step 6: BUNDLER VALIDATION
─────────────────────
Bundler performs local validation:
  - Simulates validateUserOp on EntryPoint (without execution)
  - Checks: signature valid, gas limits sufficient, nonce correct
  - If invalid: rejects immediately

Step 7: BUNDLING
─────────────────────
Bundler collects multiple valid UserOps and creates one regular transaction:
  - tx.to = EntryPoint address
  - tx.data = handleOps([userOp1, userOp2, ...], beneficiary)
  - Bundler signs and submits this transaction to the blockchain

Step 8: ENTRYPOINT VERIFICATION LOOP
─────────────────────
For each UserOp in the bundle:
  a. Create account if needed (call Factory via initCode)
  b. Call account.validateUserOp(userOp, userOpHash, missingAccountFunds)
     → Kernel routes to the correct validator (sudo or regular/session key)
     → Validator checks signature + policies
     → Returns validation result
  c. If paymaster: call paymaster.validatePaymasterUserOp()
  d. Collect: account pays missingAccountFunds to EntryPoint

Step 9: ENTRYPOINT EXECUTION LOOP
─────────────────────
For each validated UserOp:
  a. Call account with userOp.callData
     → Kernel.execute(mode, executionCalldata)
     → If batch: decode and execute each sub-call sequentially
     → Sub-calls: Benqi.withdraw(), Aave.supply(), etc.
  b. If paymaster: call paymaster.postOp() for accounting
  c. Refund unused gas to account or paymaster

Step 10: COMPLETION
─────────────────────
  - UserOp receipt available via eth_getUserOperationReceipt
  - Events emitted: UserOperationEvent(userOpHash, sender, paymaster, nonce, success, actualGasCost, actualGasUsed)
  - SnowMind records the result and updates portfolio state
```

---

## 11. How Kernel Connects to SnowMind

### SnowMind's 5-Layer Security Model (Using Kernel)

SnowMind's technical spec defines a 5-layer security architecture. Here's how each layer maps to Kernel:

| SnowMind Layer | Kernel Feature | What It Does |
|---|---|---|
| **Layer 1: Session Keys** | Regular Validator (Permission Plugin) | AI agent gets a limited key, never sees the owner's private key |
| **Layer 2: Contract Allowlist** | Call Policy (`target` field) | Only Benqi, Aave V3, Euler V2, Fluid addresses are callable |
| **Layer 3: Function Allowlist** | Call Policy (`functionName` field) | Only supply, withdraw, borrow, repay are callable |
| **Layer 4: Parameter Bounds** | Call Policy (`args` + ParamConditions) | Max amounts, specific token addresses enforced on-chain |
| **Layer 5: Operational Limits** | Rate Limit + Timestamp + Gas Policies | Max rebalances/day, session expiry, gas caps |

### Why This Architecture Is Secure

The security guarantee is **enforced at the EVM level**. The Permission Plugin's validation logic runs inside `validateUserOp()` on the EntryPoint — this is consensus-level enforcement. There is no off-chain trust assumption.

```
Can the agent steal funds? NO.
─────────────────────────────
- withdraw() to an arbitrary address? ❌ Call Policy blocks it (wrong target)
- Transfer USDC to agent's wallet?    ❌ Call Policy blocks it (transfer not in function allowlist)
- Call unapproved contract?           ❌ Call Policy blocks it (target not in allowlist)
- Drain via gas?                      ❌ Gas Policy caps total gas spend
- Spam operations?                    ❌ Rate Limit Policy caps count
- Use key after user revokes?         ❌ uninstallPlugin makes all future UserOps fail
- Use key after 24 hours?             ❌ Timestamp Policy expires the key
```

### SnowMind Transaction Example

A complete SnowMind rebalancing cycle through Kernel:

```typescript
// SnowMind's MILP optimizer outputs:
// { action: "rebalance", from: "benqi", to: "aave_v3", amount: "6000", token: "USDC" }

// Step 1: Agent constructs batch call
const calls = [
  {
    to: BENQI_CERC20_USDC,               // Benqi cToken contract
    data: encodeFunctionData({
      abi: benqiCErc20Abi,
      functionName: "redeemUnderlying",   // Withdraw USDC from Benqi
      args: [6000n * 10n**6n],            // 6000 USDC (6 decimals)
    }),
  },
  {
    to: USDC_CONTRACT,                     // Approve Aave to spend USDC
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [AAVE_V3_POOL, 6000n * 10n**6n],
    }),
  },
  {
    to: AAVE_V3_POOL,                     // Supply USDC to Aave V3
    data: encodeFunctionData({
      abi: aaveV3PoolAbi,
      functionName: "supply",
      args: [USDC_CONTRACT, 6000n * 10n**6n, KERNEL_ACCOUNT_ADDRESS, 0],
    }),
  },
]

// Step 2: Send as batch UserOp (atomic — all or nothing)
const txHash = await agentKernelClient.sendTransaction({ calls })
```

This entire batch is:
- **Atomic**: If any step fails, all revert (no partial rebalance)
- **Validated**: Permission Plugin checks every sub-call against policies
- **Sponsored**: Paymaster pays gas
- **Auditable**: Emits events for every step

---

## 12. Comparison with Competitors

### Smart Account Choices Across DeFi AI Products

| Feature | SnowMind (Kernel) | Giza (Kernel) | ZYF.AI (Safe7579) | SurfLiquid (Custom Vaults) | Sail (Thirdweb 7702) |
|---|---|---|---|---|---|
| **Standard** | ERC-4337 + ERC-7579 | ERC-4337 + ERC-7579 | ERC-4337 + ERC-7579 | Non-standard | EIP-7702 |
| **Account Contract** | ZeroDev Kernel v3.1 | ZeroDev Kernel v0.3.3 | Safe + 7579 adapter | Custom Smart Vaults | Thirdweb |
| **Session Keys** | Native (Permission Plugin) | Native (Permission Plugin) | Native (Session Key Module) | N/A — MPC signing | 7702 delegations |
| **Modular Plugins** | ✅ Full ERC-7579 | ✅ Full ERC-7579 | ✅ Full ERC-7579 | ❌ Monolithic | ⚠️ Limited |
| **Validation** | On-chain (EVM-level) | On-chain (EVM-level) | On-chain (EVM-level) | Off-chain (Guardian Layer) | On-chain |
| **Revocation** | Instant (uninstallPlugin) | Instant (uninstallPlugin) | Instant (removeSessionKey) | N/A | Revoke delegation |
| **Batching** | ✅ Native (encodeCalls) | ✅ Native | ✅ Native | ✅ Custom | ✅ Native |
| **Gas Sponsoring** | ✅ Paymaster | ✅ Paymaster | ✅ Pimlico Paymaster | ❌ User pays | ✅ Paymaster |
| **Maturity** | 6M+ accounts, 50+ chains | Proven in production | $2B+ volume | $140M+ volume | Newer |

### Key Observations

1. **SnowMind vs Giza**: Both use Kernel, but SnowMind should use v3.1 (latest) while Giza is on v0.3.3 (older). SnowMind gets better gas efficiency and newer features.

2. **SnowMind vs ZYF.AI**: ZYF uses Safe7579 (Safe + 7579 adapter). Safe is the most battle-tested smart account ($100B+ secured) but adds adapter overhead. Kernel is natively 7579-compliant — no adapter needed, cleaner architecture.

3. **SnowMind vs SurfLiquid**: Surf uses entirely custom Smart Vaults with off-chain Guardian validation. More flexible but non-standard and harder to audit. SnowMind's Kernel approach is standards-compliant and benefits from the broader ERC-4337 ecosystem.

4. **SnowMind vs Sail**: Sail uses EIP-7702, which is newer and turns EOAs into smart accounts directly. More gas-efficient for simple cases but less mature ecosystem. Note: Kernel also supports 7702 via `VALIDATION_TYPE_7702`.

---

## 13. Key Architectural Diagrams

### The Complete Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SnowMind Application                         │
│                                                                     │
│  ┌───────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │
│  │   Frontend    │  │  MILP Optimizer   │  │    AI Agent         │  │
│  │  (React/Next) │  │  (PuLP/OR-Tools) │  │  (TD3-BC / DQN)    │  │
│  └───────┬───────┘  └────────┬─────────┘  └──────────┬──────────┘  │
│          │                   │                        │             │
│          ▼                   ▼                        ▼             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   ZeroDev SDK Layer                          │   │
│  │  createKernelAccount() | createKernelAccountClient()        │   │
│  │  toPermissionValidator() | encodeCalls()                    │   │
│  └────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
           ┌──────────┐ ┌──────────┐ ┌──────────┐
           │ BUNDLER  │ │PAYMASTER │ │  RPC     │
           │(UltraRe- │ │(ZeroDev) │ │(Avalanche│
           │ lay or   │ │          │ │ C-Chain) │
           │ standard)│ │          │ │          │
           └─────┬────┘ └────┬─────┘ └──────────┘
                 │           │
                 ▼           ▼
           ┌─────────────────────────┐
           │      ENTRYPOINT v0.7   │
           │    (Avalanche C-Chain) │
           └────────────┬────────────┘
                        │
                        ▼
           ┌─────────────────────────┐
           │    KERNEL v3.1         │
           │   (User's Smart Acct)  │
           │                        │
           │  ┌───────┐ ┌────────┐ │         ┌──────────┐
           │  │ SUDO  │ │SESSION │ │────────▶│  Benqi   │
           │  │VALID. │ │KEY     │ │────────▶│  Aave V3 │
           │  │       │ │VALID.  │ │────────▶│  Euler V2│
           │  │       │ │+Policies│ │────────▶│  Fluid   │
           │  └───────┘ └────────┘ │         └──────────┘
           └─────────────────────────┘
```

### Permission Validation Detail

```
                    UserOp.signature
                         │
                         ▼
              ┌─────────────────────┐
              │  KERNEL DISPATCHER  │
              │  "Which validator   │
              │   handles this?"    │
              └─────────┬───────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
    ┌───────────────┐      ┌───────────────┐
    │ SUDO VALIDATOR│      │  PERMISSION   │
    │               │      │   VALIDATOR   │
    │ Check: owner  │      │              │
    │ signature     │      │  ┌─────────┐ │
    │               │      │  │ SIGNER  │ │
    │ Result: full  │      │  │ Check   │ │
    │ access        │      │  └────┬────┘ │
    └───────────────┘      │       │      │
                           │  ┌────▼────┐ │
                           │  │POLICIES │ │
                           │  │ ┌─────┐ │ │
                           │  │ │Call │ │ │
                           │  │ ├─────┤ │ │
                           │  │ │Gas  │ │ │
                           │  │ ├─────┤ │ │
                           │  │ │Rate │ │ │
                           │  │ ├─────┤ │ │
                           │  │ │Time │ │ │
                           │  │ └─────┘ │ │
                           │  └────┬────┘ │
                           │       │      │
                           │  ┌────▼────┐ │
                           │  │ ACTION  │ │
                           │  │ Check   │ │
                           │  └────┬────┘ │
                           │       │      │
                           │  Result:     │
                           │  limited     │
                           │  access      │
                           └──────────────┘
```

---

## Quick Reference

### Essential SDK Imports

```typescript
// Core
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { KERNEL_V3_1, ENTRYPOINT_ADDRESS_V07 } from "@zerodev/sdk/constants"

// Validators
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"

// Permissions
import { toPermissionValidator } from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"
import { serializePermissionAccount, deserializePermissionAccount } from "@zerodev/permissions"

// Policies
import { toCallPolicy, ParamCondition } from "@zerodev/permissions/policies"
import { toGasPolicy } from "@zerodev/permissions/policies"
import { toRateLimitPolicy } from "@zerodev/permissions/policies"
import { toTimestampPolicy } from "@zerodev/permissions/policies"
import { toSignaturePolicy } from "@zerodev/permissions/policies"
import { toSudoPolicy } from "@zerodev/permissions/policies"
```

### Key Constants for SnowMind

```typescript
const ENTRYPOINT = ENTRYPOINT_ADDRESS_V07     // "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
const KERNEL_VERSION = KERNEL_V3_1             // Latest recommended
const CHAIN = avalanche                         // Avalanche C-Chain (43114)
```

### Important Considerations for SnowMind on Avalanche

1. **UltraRelay Availability**: As of the latest docs, UltraRelay does NOT list Avalanche. SnowMind needs to either:
   - Use a standard ERC-4337 bundler on Avalanche (e.g., Pimlico, Alchemy, Stackup)
   - Request ZeroDev to add Avalanche support
   - Run a self-hosted bundler

2. **EntryPoint Deployment**: Verify EntryPoint v0.7 is deployed on Avalanche C-Chain. The canonical address is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.

3. **Kernel Deployment**: Kernel contracts need to be deployed on Avalanche, or verified via ZeroDev's deployment portal at kernel.zerodev.app.

4. **EIP-7702 Support**: Avalanche's latest upgrades may support EIP-7702. If so, Kernel's 7702 path could be an alternative — letting users keep their existing EOA while adding smart account capabilities.

---

*Document created for SnowMind project reference. Based on ZeroDev Kernel v3.1, ERC-4337 (EntryPoint v0.7), and ERC-7579 specifications.*
