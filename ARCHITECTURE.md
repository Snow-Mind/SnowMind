# SnowMind — How It Works

> A plain-English explanation of the SnowMind mainnet architecture.
> Written for founders, investors, and new developers.

---

## What Is SnowMind?

SnowMind is a **yield optimization agent** for USDC on Avalanche. You deposit USDC, and an AI agent automatically moves your money between DeFi lending protocols to earn the best yield — while you sleep.

Think of it like a robo-advisor for DeFi. Instead of you manually checking Aave vs Benqi vs Euler vs Spark every day, SnowMind does it for you every 30 minutes and moves your funds when it finds a better rate.

**Key facts:**
- Runs on **Avalanche C-Chain** (mainnet, chain ID 43114)
- Supports **4 protocols**: Aave V3, Benqi, Euler V2, Spark
- Only handles **USDC** (native Circle-issued stablecoin)
- **Non-custodial**: You own your smart account. SnowMind has limited permissions, not full control.
- **10% performance fee**: Only charged on yield earned, never on your principal.

---

## The Big Picture

```
  YOU (MetaMask / Social Login)
   │
   │  1. Connect wallet
   ▼
┌──────────────────────────────────────────────┐
│          FRONTEND  (Next.js on Vercel)        │
│                                               │
│  Privy Auth ─► ZeroDev Smart Account          │
│  Dashboard: see your yield, allocations       │
│  Deposit USDC ─► Grant Session Key            │
│  Emergency Withdraw ─► Get your money back    │
└────────────────────┬─────────────────────────┘
                     │
                     │  API calls (HTTPS + JWT)
                     ▼
┌──────────────────────────────────────────────┐
│          BACKEND  (Python FastAPI on Railway)  │
│                                               │
│  Rate Fetcher ─► reads APYs from protocols    │
│  Rate Validator ─► cross-checks with oracle   │
│  Waterfall Allocator ─► decides where to put  │
│  Rebalancer ─► orchestrates the move          │
│  Fee Calculator ─► computes 10% on profit     │
│  Scheduler ─► runs every 30 minutes           │
└────────┬───────────────────┬─────────────────┘
         │                   │
         │                   │  HTTP (internal)
         ▼                   ▼
┌─────────────────┐  ┌──────────────────────────┐
│   Supabase DB   │  │  Execution Service        │
│   (PostgreSQL)  │  │  (Node.js on Railway)     │
│                 │  │                            │
│  - accounts     │  │  ZeroDev SDK               │
│  - session_keys │  │  ─► signs UserOperation    │
│  - allocations  │  │  ─► sends to Pimlico       │
│  - rebalance    │  │     (bundler)               │
│    _logs        │  │  ─► lands on Avalanche     │
│  - rate_snaps   │  │                            │
│  - yield_track  │  └────────────┬───────────────┘
└─────────────────┘               │
                                  │  UserOperation (ERC-4337)
                                  ▼
                   ┌──────────────────────────────┐
                   │     AVALANCHE  C-CHAIN        │
                   │                               │
                   │  Smart Account (Kernel v3.1)  │
                   │       │                       │
                   │       ├─► Aave V3 Pool        │
                   │       ├─► Benqi qiUSDCn       │
                   │       ├─► Euler V2 Vault      │
                   │       ├─► Spark spUSDC Vault  │
                   │       └─► USDC (ERC-20)       │
                   │                               │
                   │  SnowMind Registry (logging)  │
                   │  EntryPoint v0.7 (ERC-4337)   │
                   └───────────────────────────────┘
```

---

## Step By Step: What Happens When You Use SnowMind

### Step 1: You Connect Your Wallet

You visit the SnowMind app and sign in. We use **Privy** for authentication — you can use MetaMask, a social login (Google, email), or an embedded wallet. Privy handles all the wallet complexity.

**Technology**: Privy SDK (frontend authentication)

### Step 2: A Smart Account Is Created For You

When you first connect, **ZeroDev** deploys an ERC-4337 **smart account** (Kernel v3.1) on Avalanche for you. This is different from a normal wallet:

- Your MetaMask/Privy wallet is the **owner** (full control)
- The smart account can execute **batched transactions** (do 3 things in 1 tx)
- The smart account supports **session keys** (limited permissions for the agent)

Your smart account address is deterministic — same owner always gets the same address.

**Technology**: ZeroDev SDK, Kernel v3.1 smart accounts, ERC-4337

### Step 3: You Deposit USDC

You transfer USDC into your smart account. The frontend detects the deposit and immediately routes it to the **highest-APY protocol** in a single transaction:

1. Approve USDC spending on the target protocol
2. Deposit USDC into that protocol (e.g., Aave V3 `supply()` or Benqi `mint()`)

Both steps happen atomically in one UserOperation — if either fails, nothing happens.

**Technology**: Viem (Ethereum library), ERC-4337 batched UserOperations

### Step 4: You Grant a Session Key

This is the key step. You approve a **session key** — a limited-permission key that allows the SnowMind agent to move your funds between whitelisted protocols.

**What the session key CAN do:**
- Call `supply()` / `withdraw()` on Aave V3
- Call `mint()` / `redeem()` on Benqi
- Call `deposit()` / `redeem()` on Euler V2 and Spark vaults
- Call `approve()` for USDC on those protocols
- Call `transfer()` on USDC — but ONLY to the SnowMind treasury address (for fees)

**What the session key CANNOT do:**
- Transfer USDC to any arbitrary address
- Call any function not in the whitelist
- Operate after 30 days (auto-expires)
- Exceed gas or rate limits (max 20 ops/day)

All of these restrictions are **enforced on-chain** by the Kernel smart account's call policy. Even if someone steals the session key, they can only do what the policy allows.

The session key is serialized (including the ephemeral signing key), encrypted with **AES-256-GCM**, and stored in Supabase. The backend decrypts it only when it needs to execute a rebalance.

**Technology**: ZeroDev permission validators, Kernel call policies (on-chain), AES-256-GCM encryption

### Step 5: The Agent Monitors Rates (Every 30 Minutes)

A **scheduler** runs on the backend every 30 minutes. For each registered user account, it runs the full rebalance pipeline:

#### 5a. Fetch Rates

The **Rate Fetcher** calls each protocol adapter simultaneously:

| Protocol | How It Reads APY | Contract |
|----------|-----------------|----------|
| **Aave V3** | `getReserveData()` → `currentLiquidityRate` (RAY math) | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` |
| **Benqi** | `supplyRatePerTimestamp()` (Compound-style) | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` |
| **Euler V2** | `interestRatePerSecond()` (ERC-4626 vault) | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` |
| **Spark** | `interestRatePerSecond()` (ERC-4626 vault) | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` |

Each adapter also reads the protocol's **TVL** (total value locked) to assess liquidity depth.

A **circuit breaker** tracks consecutive failures per protocol. If a protocol fails 3 times in a row, it's excluded until it recovers.

Protocols with TVL below $100,000 are automatically skipped — this prevents depositing into illiquid pools where withdrawal might be difficult.

**Technology**: Web3.py (async), on-chain contract reads via Avalanche RPC

#### 5b. Validate Rates

The **Rate Validator** runs three safety checks before any decision:

1. **TWAP Smoothing**: Averages rates over a 15-minute window (not single-point reads). This prevents flash manipulation.

2. **DefiLlama Cross-Validation**: Compares on-chain rates against DefiLlama's API (an independent oracle). If they diverge by more than 2%, the entire rebalance halts.

3. **Velocity Check**: If any protocol's rate jumps more than 25% between consecutive reads, it's flagged as suspicious and excluded for that cycle.

4. **Sanity Bound**: Any APY above 25% is automatically rejected.

**Technology**: DefiLlama Yields API, in-memory TWAP ring buffer

#### 5c. Run the Waterfall Allocator

The **Waterfall Allocator** decides where your money should go. It's simple and predictable:

```
1. Spark is the "base layer" — the safe default (MakerDAO-backed).

2. Sort all other protocols by APY (highest first).

3. For each protocol (Aave, Benqi, Euler):
   - Does it beat Spark by at least 0.5% (50 basis points)?
   - If YES: allocate funds there (up to caps)
   - If NO: skip it, not worth the gas

4. Anything left over → goes to Spark.
```

**Caps that limit how much goes to each protocol:**
- **40% exposure cap**: No single protocol gets more than 40% of your total deposit
- **15% TVL cap**: We never put in more than 15% of a protocol's total liquidity (prevents moving the market)
- **$100K TVL minimum**: Skip protocols with very low liquidity

**Example with $10,000 deposit:**
```
  Spark APY:   3.0%  (base layer)
  Benqi APY:    3.3%  (only 0.3% above Spark — below 0.5% margin, SKIP)
  Euler V2 APY: 4.2%  (1.2% above Spark — qualifies!)
  Aave V3 APY:  3.8%  (0.8% above Spark — qualifies!)

  Result:
    Euler V2: $4,000  (40% exposure cap)
    Aave V3:  $4,000  (40% exposure cap)
    Spark:    $2,000  (remainder → base layer)
```

**Technology**: Pure Python, Decimal math (no floating point errors)

#### 5d. Check If Rebalance Is Worth It

Before moving any money, two more gates:

- **Yield Gate**: The expected APY improvement must exceed the gas cost. On Avalanche, a rebalance costs ~$0.008, so even small improvements clear this gate.
- **Time Gate**: At least 6 hours since the last rebalance. Prevents excessive churning.
- **Move Cap**: No single rebalance can move more than 30% of total funds (protects against miscalculation).

### Step 6: The Agent Executes the Rebalance

If all checks pass, the **Rebalancer** builds the transaction:

1. **Withdrawals first**: Pull USDC out of the old protocol (e.g., `aavePool.withdraw()`)
2. **Deposits second**: Put USDC into the new protocol (e.g., `eulerVault.deposit()`)

The rebalancer sends this to the **Execution Service** (a Node.js sidecar running alongside the Python backend):

```
Python Backend                    Node.js Execution Service
     │                                      │
     │  POST /execute-rebalance             │
     │  {                                   │
     │    serializedPermission: "...",       │
     │    withdrawals: [...],               │
     │    deposits: [...]                   │
     │  }                                   │
     │ ────────────────────────────────────► │
     │                                      │
     │                          deserializePermissionAccount()
     │                          build UserOperation
     │                          sign with session key
     │                                      │
     │                          POST to Pimlico Bundler
     │                          ────────────────────────►
     │                                      │       Pimlico bundles it
     │                                      │       submits to Avalanche
     │                                      │       ◄────────────────
     │                                      │
     │  { txHash: "0x..." }                 │
     │ ◄──────────────────────────────────── │
```

The Pimlico bundler packages the UserOperation and submits it to the Avalanche network. Gas is sponsored by ZeroDev's paymaster — users don't pay gas.

**Technology**: ZeroDev SDK (deserialize + sign), Pimlico (bundler + paymaster), ERC-4337

### Step 7: Database Is Updated

After successful execution:
- The `allocations` table is updated with the new protocol positions
- A `rebalance_logs` entry records what happened (status, tx hash, APY improvement)
- A `rate_snapshots` entry records the APYs at decision time

### Step 8: You Withdraw (When You Want)

When you click "Withdraw All" in the dashboard:

1. The backend reads your current positions across all protocols
2. Calculates the **10% profit fee**:
   ```
   profit = current_balance - total_deposited
   fee = profit * 0.10
   ```
3. Builds an **atomic batch transaction**:
   - Call 1: Withdraw from Aave (`withdraw(USDC, MAX, smartAccount)`)
   - Call 2: Redeem from Benqi (`redeem(qiTokenBalance)`)
   - Call 3: Redeem from Euler (`redeem(shares, smartAccount, smartAccount)`)
   - Call 4: Redeem from Spark (`redeem(shares, smartAccount, smartAccount)`)
   - Call 5: Transfer fee to treasury (`USDC.transfer(treasury, feeAmount)`)

All 5 calls happen atomically — if any fails, nothing happens. The fee is deducted in the same transaction, not separately.

After withdrawal, the session key is revoked and the account is deactivated. The user keeps their smart account and can re-deposit anytime.

**Technology**: Atomic batched UserOperations, Gnosis Safe (treasury multisig)

---

## The Four Protocols

### Spark — The Base Layer (MakerDAO-Backed)

- **Contract**: `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` (spUSDC)
- **Type**: ERC-4626 vault (deposit USDC → receive spUSDC shares)
- **Interface**: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **Risk Score**: 3/10 (backed by MakerDAO/Sky, well-audited, ~$10M TVL)
- **Role in SnowMind**: Default "parking spot" for funds. If no other protocol beats it by 0.5%, everything stays here.

### Aave V3 — The Blue Chip

- **Contract**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- **Type**: Lending pool (supply USDC → receive aUSDC)
- **Interface**: `supply(asset, amount, onBehalfOf, referralCode)` / `withdraw(asset, amount, to)`
- **Risk Score**: 2/10 (safest — $10B+ TVL globally, battle-tested since 2020)
- **Exposure cap**: 40% max

### Benqi — The Avalanche Native

- **Contract**: `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` (qiUSDCn)
- **Type**: Compound-fork (supply USDC → receive qiTokens)
- **Interface**: `mint(amount)` / `redeem(qiTokenAmount)`
- **Risk Score**: 3/10 (well-established on Avalanche since 2021)
- **Special handling**: qiToken amounts differ from USDC amounts — the adapter converts between them using `exchangeRateCurrent()`.

### Euler V2 — The Modular Newcomer

- **Contract**: `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e`
- **Type**: ERC-4626 vault (deposit USDC → receive vault shares)
- **Interface**: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **Risk Score**: 5/10 (newer protocol, audited on Ethereum, lower TVL ~$489K)
- **Exposure cap**: 20% max (more conservative than other protocols)

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16, React, TypeScript | User interface |
| **Auth** | Privy | Social login + wallet connection |
| **Smart Accounts** | ZeroDev SDK, Kernel v3.1 | ERC-4337 accounts with session keys |
| **Bundler** | Pimlico | Packages and submits UserOperations |
| **Paymaster** | ZeroDev | Sponsors gas fees for users |
| **Backend** | FastAPI (Python 3.12) | API + scheduler + optimizer |
| **Execution** | Node.js sidecar | Signs and submits UserOps |
| **Database** | Supabase (PostgreSQL) | Accounts, keys, allocations, logs |
| **Blockchain** | Avalanche C-Chain (43114) | Where the money lives |
| **Oracle** | DefiLlama Yields API | Independent rate cross-validation |
| **Encryption** | AES-256-GCM | Session key storage at rest |
| **Treasury** | Gnosis Safe multisig | Fee collection address |
| **Monitoring** | Circuit breaker + audit logs | Protocol health + session key tracking |

---

## Security Model

### What the user controls
- **EOA (MetaMask/Privy wallet)**: Full owner of the smart account. Can do anything — withdraw directly, revoke session keys, interact with any contract.
- **Emergency withdrawal**: One-click in the UI. Pulls all funds back immediately.

### What SnowMind controls (via session key)
- Move USDC between 4 whitelisted protocols only
- Transfer USDC to the treasury address only (for fees)
- Cannot send USDC to any other address
- Key expires in 30 days automatically
- Max 20 operations per day
- Total gas capped at 0.5 AVAX

### Defense layers

```
Layer 1: Session Key Call Policy (on-chain)
  └─ Only whitelisted functions on whitelisted contracts
  └─ USDC.transfer ONLY to treasury address
  └─ Amount caps per transaction
  └─ 30-day expiry, 20 ops/day rate limit

Layer 2: Rate Validation (backend)
  └─ TWAP smoothing (15-min average, not spot)
  └─ DefiLlama cross-check (>2% divergence → halt)
  └─ Velocity spike detection (>25% jump → skip)
  └─ Sanity bound (>25% APY → reject)

Layer 3: Execution Guards (backend)
  └─ 6-hour minimum between rebalances
  └─ 30% max move per rebalance
  └─ Gas gate (improvement must exceed gas cost)
  └─ Circuit breaker (3 failures → exclude protocol)
  └─ $100K minimum TVL to participate

Layer 4: Platform Guards
  └─ $50K total platform deposit cap (guarded beta)
  └─ Session key encryption at rest (AES-256-GCM)
  └─ RLS policies block frontend from reading session keys
  └─ Invalid session keys auto-revoked on detection

Layer 5: User Always Has the Exit
  └─ Owner EOA has full control of smart account
  └─ Can withdraw directly via Snowtrace (no UI needed)
  └─ Can revoke session key at any time
  └─ Non-custodial: SnowMind never holds user funds
```

### The trade-off we accept

A technically sophisticated user could bypass the 10% fee by crafting a raw UserOperation through the EntryPoint, calling `execute()` as the root validator. This is by design — the user is the owner of their smart account. Every major yield agent (Giza, Zyfai, Sail) accepts this same trade-off. It's the price of being truly non-custodial.

---

## Database Schema (Supabase)

| Table | Purpose |
|-------|---------|
| `accounts` | Smart account addresses + owner EOAs |
| `session_keys` | AES-256-GCM encrypted session key blobs |
| `allocations` | Current USDC positions per protocol per user |
| `rebalance_logs` | History of every rebalance decision (skip/execute/fail) |
| `rate_snapshots` | Raw APY readings per protocol (7-day rolling window) |
| `daily_apy_snapshots` | Daily APY averages per protocol (for 30-day moving average) |
| `account_yield_tracking` | Total deposited / withdrawn per user (for fee calculation) |
| `protocol_health` | Circuit breaker state per protocol |
| `scheduler_locks` | Distributed lock preventing duplicate scheduler runs |
| `session_key_audit` | Audit trail of every session key operation |

Row-Level Security ensures users can only read their own accounts and allocations. Session keys are completely blocked from frontend access (`USING (false)` policy).

---

## Fee Collection Flow

```
User clicks "Withdraw All"
     │
     ▼
Backend reads current positions
     │  Aave: $5,200
     │  Euler: $5,300
     │  Total: $10,500
     │
     ▼
Backend reads deposit history
     │  Total deposited: $10,000
     │
     ▼
Calculate fee
     │  profit = $10,500 - $10,000 = $500
     │  fee = $500 × 10% = $50
     │  user receives = $10,500 - $50 = $10,450
     │
     ▼
Build atomic batch (ONE UserOperation)
     │  Call 1: aavePool.withdraw(USDC, MAX, smartAccount)
     │  Call 2: eulerVault.redeem(shares, smartAccount, smartAccount)
     │  Call 3: USDC.transfer(treasury, $50)    ← fee
     │
     ▼
Execution service signs & submits via Pimlico
     │
     ▼
One transaction on Avalanche
     │  All calls succeed atomically
     │  Fee goes to Gnosis Safe treasury
     │  USDC lands in user's smart account
     │
     ▼
Session key revoked, account deactivated
User can transfer USDC from smart account to their EOA
```

---

## Mainnet Contract Addresses

| Contract | Address | What It Does |
|----------|---------|-------------|
| Native USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Circle-issued USDC on Avalanche |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | Lend/borrow pool |
| Benqi qiUSDCn | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` | Compound-style lending |
| Euler V2 Vault | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` | ERC-4626 USDC vault |
| Spark spUSDC | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` | ERC-4626 savings vault |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ERC-4337 entry point |
| SnowMindRegistry | *(deploy with Foundry)* | On-chain rebalance logging |
| Treasury | *(Gnosis Safe multisig)* | Fee collection |

---

## Key Files in the Codebase

| File | What It Does |
|------|-------------|
| `apps/web/lib/constants.ts` | All contract addresses, chain config, protocol metadata |
| `apps/web/lib/zerodev.ts` | Smart account creation, session key granting, call policies |
| `apps/web/app/(app)/onboarding/page.tsx` | User onboarding flow (deposit + session key) |
| `apps/backend/app/core/config.py` | All backend configuration (addresses, tuning params) |
| `apps/backend/app/services/optimizer/waterfall_allocator.py` | Waterfall allocation algorithm |
| `apps/backend/app/services/optimizer/rebalancer.py` | Full rebalance pipeline (rates → decision → execution) |
| `apps/backend/app/services/optimizer/rate_fetcher.py` | On-chain rate reading + circuit breaker |
| `apps/backend/app/services/optimizer/rate_validator.py` | TWAP, DefiLlama, velocity checks |
| `apps/backend/app/services/fee_calculator.py` | 10% profit fee calculation + tracking |
| `apps/backend/app/services/protocols/aave.py` | Aave V3 adapter (supply/withdraw/balance) |
| `apps/backend/app/services/protocols/benqi.py` | Benqi adapter (mint/redeem/balance) |
| `apps/backend/app/services/protocols/euler_v2.py` | Euler V2 adapter (ERC-4626) |
| `apps/backend/app/services/protocols/spark.py` | Spark adapter (ERC-4626) |
| `apps/backend/app/services/execution/session_key.py` | AES-256-GCM encrypt/decrypt + Supabase storage |
| `apps/backend/app/api/routes/rebalance.py` | REST API for rebalance, withdrawal, capacity |
| `contracts/src/SnowMindRegistry.sol` | Simple on-chain logging contract |
| `contracts/script/DeployMainnet.s.sol` | Foundry deploy script for mainnet |

---

## Glossary

| Term | Meaning |
|------|---------|
| **ERC-4337** | Account Abstraction standard. Lets smart contracts act as wallets. Users submit "UserOperations" instead of regular transactions. |
| **UserOperation** | A transaction-like object for smart accounts. Includes the calls to make, gas limits, and a signature. |
| **Bundler** | A service (Pimlico) that collects UserOperations and submits them to the blockchain. |
| **Paymaster** | A contract that pays gas fees on behalf of the user. ZeroDev sponsors gas so users pay nothing. |
| **Kernel v3.1** | The smart account implementation by ZeroDev. Supports plugins, validators, and permission-scoped session keys. |
| **Session Key** | A limited-permission key that can sign UserOperations on behalf of the smart account, but only for whitelisted actions. |
| **Call Policy** | On-chain rules that restrict what a session key can do — which contracts, which functions, what parameters. |
| **ERC-4626** | A standard for tokenized vaults. Deposit assets, get shares. Used by Euler V2 and Spark. |
| **TWAP** | Time-Weighted Average Price/Rate. Averaging over time prevents manipulation from single-point readings. |
| **Circuit Breaker** | Automatically excludes a protocol after 3 consecutive failures. Resets on success. |
| **Waterfall Allocator** | SnowMind's allocation strategy: fill highest-APY protocols first, park remainder in the base layer. |
| **Base Layer** | Spark — the safe default (MakerDAO-backed). Funds go here when nothing else beats it by enough. |
| **Beat Margin** | 0.5% (50 basis points). A protocol must beat the base layer by this much to justify moving funds. |
| **Gnosis Safe** | A multi-signature wallet. The SnowMind treasury is a Gnosis Safe requiring multiple signatures to move funds. |
| **RLS** | Row-Level Security. Supabase feature that restricts which rows a user can read based on their identity. |
