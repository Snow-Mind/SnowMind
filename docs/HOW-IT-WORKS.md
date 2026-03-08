# SnowMind — How It Works

> An autonomous, non-custodial AI yield optimizer on Avalanche.

---

## The Problem

DeFi users holding stablecoins on Avalanche face a frustrating choice:

1. **Leave funds idle** — your USDC sits in your wallet earning 0%.
2. **Manually hunt for yield** — check Aave, Benqi, and other protocols daily, compare APYs, pay gas to move funds, and hope you timed it right.
3. **Trust a custodial service** — hand over your keys to someone else's smart contract and pray they don't get hacked.

Most users choose option 1 because option 2 is exhausting and option 3 is terrifying.

**SnowMind solves all three.**

---

## The Solution — In Plain English

SnowMind is an autopilot for your stablecoins. Here's what happens:

1. **You connect your wallet** (Google, email, or any Ethereum wallet via Privy).
2. **We create a smart account for you** — a secure on-chain wallet (ZeroDev Kernel v3.1) that only you control.
3. **You deposit USDC** into your smart account.
4. **SnowMind's AI brain kicks in** — every 30 minutes, it checks the best lending rates across Aave V3 and Benqi on Avalanche.
5. **If it finds a better deal**, it automatically moves your funds to earn more — no action needed from you.
6. **You watch your yield grow** on a real-time dashboard.

**Your keys, your funds, your yield.** We never hold your money. We can only move it between pre-approved lending protocols — nothing else.

---

## User Journey

```
┌──────────────┐    ┌───────────────┐    ┌────────────────┐    ┌──────────────┐
│  Connect     │    │ Smart Account │    │   Deposit      │    │  Autopilot   │
│  Wallet      │───▸│ Created       │───▸│   USDC         │───▸│  Optimizes   │
│  (Privy)     │    │ (ZeroDev)     │    │                │    │  24/7        │
└──────────────┘    └───────────────┘    └────────────────┘    └──────────────┘
                                                                      │
                         ┌────────────────────────────────────────────┘
                         ▼
                  ┌──────────────────────────────────────┐
                  │  Dashboard shows:                     │
                  │  • Total deposited & yield earned     │
                  │  • Current allocation across protocols│
                  │  • Rebalance history with tx links    │
                  │  • Live protocol rates                │
                  └──────────────────────────────────────┘
```

---

## How the Optimization Works — Technical Deep Dive

### Step 1: Rate Fetching

Every 30 minutes, the backend reads live interest rates directly from the blockchain:

- **Aave V3**: Reads `currentLiquidityRate` from the Aave Pool contract, converts from RAY (1e27) to APY using compound interest formula.
- **Benqi**: Reads `supplyRatePerTimestamp()` from the qiToken contract, annualizes it.

These aren't API calls to a third party — they're direct on-chain reads, which means they can't be faked.

### Step 2: TWAP Smoothing

A single rate reading can be unreliable (flash loan attacks can temporarily spike rates). SnowMind uses a **TWAP (Time-Weighted Average Price)** over a 15-minute window:

- Stores rate snapshots in the database.
- Computes a time-weighted average across recent samples.
- Rejects outliers that deviate >2 standard deviations from the median.

This prevents the optimizer from chasing flash-in-the-pan rate spikes.

### Step 3: Cross-Validation

Before trusting the rates, SnowMind cross-validates against **DefiLlama** (an independent rate aggregator). If the on-chain rate diverges more than 2% from DefiLlama's data, rebalancing is automatically halted. This catches bugs, exploits, and oracle failures.

### Step 4: MILP Optimization

This is the brain of SnowMind. We solve a **Mixed-Integer Linear Programming (MILP)** problem using the PuLP library with the CBC solver:

```
MAXIMIZE:  Σ(allocation_i × yield_i) − λ × Σ(allocation_i × risk_i)
```

In human terms: **maximize yield while penalizing risky protocols.**

Subject to these hard constraints:

| Constraint | Rule | Why |
|------------|------|-----|
| Budget equality | All funds must be allocated (no idle cash) | Maximize capital efficiency |
| Max per protocol | No protocol gets more than 60% | Diversification |
| Min position | Either $0 or at least $500 per protocol | Avoid dust positions |
| Min protocols | At least 2 protocols active | Never all-eggs-in-one-basket |
| Max protocols | At most 4 protocols | Keep it manageable |

The risk weighting (`λ`) adjusts based on the user's risk tolerance:
- **Conservative**: λ = 0.3 (heavily penalizes risk)
- **Moderate**: λ = 0.2 (balanced)
- **Aggressive**: λ = 0.1 (chases yield)

### Step 5: Rebalance Decision Gate

Even when the optimizer finds a better allocation, we don't blindly move funds. All 5 conditions must pass:

1. **Material change**: At least one protocol's allocation changed by >5%.
2. **Net positive after gas**: The yield improvement (annualized) exceeds gas costs.
3. **Cooldown**: At least 6 hours since the last rebalance.
4. **TWAP confirmed**: Rate was consistent across ≥2 consecutive readings.
5. **No anomalies**: No protocol rate exceeds 25% APY (a sign of manipulation).

### Step 6: On-Chain Execution

When all conditions pass, SnowMind builds an **ERC-4337 UserOperation** — a transaction bundle executed through the user's smart account:

1. Withdraw from over-allocated protocols (e.g., `withdraw()` on Aave, `redeem()` on Benqi)
2. Supply to under-allocated protocols (e.g., `supply()` on Aave, `mint()` on Benqi)

This goes through the **Pimlico bundler** (which sponsors gas via a paymaster — users don't pay gas). The transaction is submitted to Avalanche and confirmed in ~2 seconds.

### Step 7: Logging & Dashboard Update

- The rebalance result is logged in the database (status, allocations, gas cost, tx hash).
- The frontend receives a **real-time update** via Supabase Realtime (WebSocket), refreshing the dashboard instantly.
- Users can click the transaction hash to verify on [Snowtrace](https://testnet.snowtrace.io).

---

## Security Architecture

### Non-Custodial Design

Users own their smart accounts. SnowMind cannot:
- Withdraw funds to any external address
- Transfer tokens to itself
- Upgrade or change the smart account logic

The backend only has a **session key** — a limited-permission key that can only call specific functions (`supply`, `withdraw`, `mint`, `redeem`) on specific contracts (Aave, Benqi). It cannot send USDC somewhere else.

### Session Key Scoping

```
Allowed contracts:  [Aave V3 Pool, Benqi Pool]
Allowed functions:  [supply(), withdraw(), mint(), redeem()]
Max per tx:         User-defined cap
Expiration:         30 days (then user must re-authorize)
Rate limit:         Max 10 operations per day
```

### Session Key Storage (MVP)

Session keys are encrypted with **AES-256-GCM** before being stored in the database. The encryption key lives in a Railway environment variable and never touches the codebase.

- 12-byte random nonce per encryption
- Decrypted only in-memory when building a transaction
- Never logged, never stored in plaintext
- All operations audit-logged in the `session_key_audit` table
- Row-Level Security denies any frontend (anon key) access to the `session_keys` table

**Post-MVP**: migrate to AWS KMS or Google Cloud KMS for hardware-backed key encryption.

### Safety Bounds

| Guard | Threshold | Action |
|-------|-----------|--------|
| APY sanity bound | > 25% | Halt rebalancing, log alert |
| Rate divergence | > 2% vs DefiLlama | Halt rebalancing |
| Circuit breaker | 3 consecutive failures | Exclude protocol from optimizer |
| Max allocation | 60% per protocol | Hard MILP constraint |
| Rebalance cooldown | 6 hours minimum | Prevent over-trading |

### What Happens If SnowMind Goes Down?

**Nothing bad.** Your funds are deposited in Aave/Benqi through your own smart account. They continue earning yield at the current rate. When SnowMind comes back online, it resumes optimization from where it left off.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND — Next.js 15 on Vercel                            │
│                                                             │
│  Privy Auth ─▸ ZeroDev Smart Account ─▸ Dashboard           │
│  (Google/Email/Wallet)  (Kernel v3.1)   (Real-time data)    │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS + API Key
┌────────────────────▼────────────────────────────────────────┐
│  BACKEND — FastAPI on Railway                               │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐               │
│  │ Rate     │ │ MILP     │ │ Rebalance     │               │
│  │ Fetcher  │▸│ Solver   │▸│ Engine        │               │
│  │ (TWAP)   │ │ (PuLP)   │ │ (5-gate check)│               │
│  └──────────┘ └──────────┘ └───────┬───────┘               │
│                                    │                         │
│  ┌─────────────────────────────────▼─────────────────────┐  │
│  │ UserOp Builder ─▸ Pimlico Bundler ─▸ Avalanche C-Chain│  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Supabase (PostgreSQL) — state, logs, encrypted keys        │
│  APScheduler — 30-min cron for auto-rebalancing             │
└─────────────────────────────────────────────────────────────┘
                     │ ERC-4337 UserOperations
┌────────────────────▼────────────────────────────────────────┐
│  AVALANCHE C-CHAIN                                          │
│                                                             │
│  ZeroDev Kernel v3.1 ── User's Smart Account                │
│  Pimlico Paymaster ──── Gas sponsoring (users pay $0 gas)   │
│  Aave V3 ──────────────  Lending protocol #1                │
│  Benqi ────────────────  Lending protocol #2                │
│  (Euler V2) ───────────  Coming soon                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Next.js 15, React 19, Tailwind CSS | Fast SSR, modern React |
| **Auth** | Privy | Social login + wallet connection in one SDK |
| **Smart Account** | ZeroDev Kernel v3.1 (ERC-4337 + ERC-7579) | Audited, modular, session key support |
| **Gas Sponsoring** | Pimlico Paymaster | Users never pay gas |
| **Backend** | FastAPI (Python 3.12) | Async, fast, great for data processing |
| **Optimizer** | PuLP (CBC solver) | Production-grade MILP solver |
| **Database** | Supabase (PostgreSQL) | Realtime subscriptions, RLS, managed |
| **Scheduler** | APScheduler | Reliable async cron jobs |
| **Encryption** | AES-256-GCM | Industry-standard symmetric encryption |
| **Blockchain** | Avalanche C-Chain | Fast (2s finality), cheap, EVM-compatible |
| **Protocols** | Aave V3, Benqi | Battle-tested, billions in TVL |

---

## What Makes SnowMind Different

| Feature | Manual DeFi | Custodial Yield Vaults | SnowMind |
|---------|------------|----------------------|----------|
| Who holds the keys? | You | The vault contract | **You** (your smart account) |
| Optimization | None — you guess | Fixed strategy | **MILP — mathematically optimal** |
| Gas costs | You pay every move | Hidden in fees | **Sponsored (free)** |
| Rebalancing | Manual, maybe monthly | Their schedule | **Every 30 min, automated** |
| Risk controls | None | Trust them | **5-gate check, circuit breakers, rate validation** |
| Transparency | Etherscan if you bother | Usually opaque | **Full dashboard, tx links, audit logs** |

---

## Protocols We Support

### Active (MVP)

| Protocol | What It Does | Risk Score | Max Allocation |
|----------|-------------|------------|----------------|
| **Aave V3** | Largest multi-chain lending protocol. $10B+ TVL globally. | 2/10 (safest) | 60% |
| **Benqi** | Native Avalanche lending protocol. The original Avalanche DeFi pillar. | 3/10 | 60% |

### Coming Soon

| Protocol | Status |
|----------|--------|
| **Euler V2** | Smart contract deployed on Fuji testnet. Starting with 20% max cap until proven. |

---

## Frequently Asked Questions

**Q: Can SnowMind steal my funds?**
No. The session key can only call `supply/withdraw` on approved lending protocols. It cannot transfer USDC to any other address.

**Q: What if a protocol gets hacked?**
SnowMind's 60% cap means at most 60% of your funds are in any single protocol. The circuit breaker (3 consecutive failures → auto-exclude) provides additional protection. But smart contract risk in DeFi can never be fully eliminated — this is a fundamental risk of using any DeFi protocol.

**Q: How much does it cost?**
Gas is sponsored by the Pimlico paymaster — users pay $0 in transaction fees on the Fuji testnet. The optimizer runs on our backend, so there's no on-chain compute cost.

**Q: How often does it rebalance?**
The optimizer checks every 30 minutes. It only rebalances when the yield improvement is material (>5% allocation shift) and net-positive after gas costs. In practice, this might be once a day or less.

**Q: What happens if the backend goes down?**
Your funds stay exactly where they are, continuing to earn yield in Aave/Benqi. When the backend recovers, it resumes optimization automatically.

**Q: Is this audited?**
The smart account (ZeroDev Kernel v3.1) is audited. Our own smart contracts (SnowMindRegistry, MockBenqiPool) are simple and deployed on Fuji testnet for the MVP. A full audit would be part of the mainnet launch roadmap.
