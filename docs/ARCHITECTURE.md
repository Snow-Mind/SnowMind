# SnowMind — Architecture

## System Overview

SnowMind is an autonomous, non-custodial AI yield optimizer on Avalanche C-Chain. Users deposit stablecoins into their own ZeroDev Kernel v3.1 smart account. A Python FastAPI backend continuously solves a MILP optimization problem and rebalances funds across Avalanche lending protocols to maximize risk-adjusted yield.

```
┌────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15 · Vercel)                            │
│  Privy Auth → ZeroDev Kernel v3.1 Smart Account            │
│  → Session key grant → Dashboard                           │
└──────────────────┬─────────────────────────────────────────┘
                   │ HTTPS (REST/JSON)
┌──────────────────▼─────────────────────────────────────────┐
│  BACKEND (FastAPI · Railway)                               │
│  Rate Fetcher → MILP Solver → Rebalance Engine             │
│  Session Key Manager → Pimlico Bundler → On-chain          │
│  Supabase (PostgreSQL) for state persistence               │
└──────────────────┬─────────────────────────────────────────┘
                   │ ERC-4337 UserOperations
┌──────────────────▼─────────────────────────────────────────┐
│  AVALANCHE C-CHAIN (On-chain)                              │
│  ZeroDev Kernel v3.1 Smart Accounts                        │
│  Pimlico Paymaster (gas sponsoring)                        │
│  Aave V3 (supply/withdraw) · Benqi (mint/redeem)           │
│  SnowMindRegistry (immutable event log)                    │
└────────────────────────────────────────────────────────────┘
```

---

## Smart Account Architecture

### Why Smart Accounts?

A normal wallet (EOA) requires manual signing for every transaction. A **smart account** is a smart contract acting as the user's wallet, with programmable rules. For SnowMind:

- The user's funds stay in **their own** smart account
- SnowMind's AI agent gets a **limited session key** that can ONLY call approved DeFi protocol functions
- The agent can rebalance yields but **can never steal funds**

### ZeroDev Kernel v3.1

| Property | Value |
|----------|-------|
| Standard | ERC-4337 + ERC-7579 |
| EntryPoint | v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) |
| Modules | Validators, Executors, Hooks, Fallback Handlers |
| Deployment | Counterfactual (CREATE2) — address known before deployment |

### ERC-4337 Transaction Flow

```
AI Agent creates UserOperation
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
  ✅ Signature valid for this session key?
  ✅ Target contract is whitelisted?
  ✅ Function selector is whitelisted?
  ✅ Rate limit not exceeded?
  ✅ Timestamp within valid window?
        ↓
All pass → Execute → Protocol interaction
Any fail → Reject UserOp
```

### Session Key Permissions

```
Permission = 1 Signer + N Policies + 1 Action
```

**Policies composed on SnowMind session keys:**

| Policy | Configuration |
|--------|---------------|
| Call Policy | Only `supply()`/`withdraw()` on Aave V3; `mint()`/`redeem()` on Benqi |
| Rate Limit | Max N transactions per day |
| Timestamp | Valid for 30 days from creation |
| Gas Policy | Maximum total gas budget |

**The session key CANNOT:**
- Call `transfer()` or `approve()` (not in function whitelist)
- Interact with contracts not in the whitelist
- Operate after revocation (immediate on-chain effect)

---

## MILP Optimizer

### The Optimization Problem

```
MAXIMIZE:  Σ(allocation_i × apy_i) − λ × Σ(allocation_i × risk_i)

SUBJECT TO:
  Σ allocation_i = total_deposit            (1) Budget constraint
  allocation_i  ≤ 0.60 × total              (2) Max 60% per protocol
  allocation_i  ≥ $500 OR allocation_i = 0   (3) Min position or zero
  active_protocols ≥ 2                       (4) Diversification
  allocation_i  ∈ {0} ∪ [MIN, MAX]           (5) Binary: in or out
```

Where:
- `apy_i` = TWAP-smoothed supply rate from protocol `i`
- `risk_i` = Static risk score (Aave = 2, Benqi = 3, Euler = 5)
- `λ` = Risk aversion parameter (varies by user preference)

### Solver

- **Engine**: PuLP (Python) with CBC backend
- **Solve time**: < 1 second for 4-5 protocols
- **Variables**: `allocation_i` (continuous) + `active_i` (binary indicator)

### Rebalancing Decision Gate

A rebalance only executes when **ALL** conditions are met:

1. `|proposed_allocation_i - current_allocation_i| > 5%` for at least one protocol
2. `cost_adjusted_apr_improvement > 0` (net positive after gas)
3. `time_since_last_rebalance > 6 hours`
4. `twap_confirmation >= 2 consecutive reads` (anti-flash-loan)
5. `no_rate_anomaly` (all rates < 25% APY, cross-validated with DefiLlama)

---

## Rate Fetching & Validation

### APY Sources

| Protocol | On-Chain Source | Units |
|----------|----------------|-------|
| Aave V3 | `Pool.getReserveData(asset).currentLiquidityRate` | RAY (÷ 1e27) |
| Benqi | `qiToken.supplyRatePerTimestamp()` + `exchangeRateStored()` | Per-second rate |

### TWAP Smoothing

Raw spot rates are smoothed using a 15-minute Time-Weighted Average Price:

```
twap_rate = Σ(rate_i × Δt_i) / Σ(Δt_i)   over 15-minute window
```

### Cross-Validation

Every TWAP rate is compared against DefiLlama's yield API:

```
if |twap_rate - defillama_rate| > 2%:
    HALT rebalancing
    LOG rate_anomaly alert
```

### Sanity Bounds

Any protocol reporting > 25% APY triggers:
1. Immediate halt of auto-rebalancing
2. Alert logged with severity CRITICAL
3. Protocol excluded from optimizer until manually cleared

---

## Database Schema (Supabase)

### accounts

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| owner_address | text | EOA address |
| smart_account_address | text | Kernel smart account |
| session_key_encrypted | text | AES-256-GCM encrypted session key |
| session_key_expires_at | timestamptz | Expiration |
| risk_tolerance | text | conservative / moderate / aggressive |
| created_at | timestamptz | Registration time |

### allocations

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| account_id | uuid | FK → accounts |
| protocol_id | text | aave_v3, benqi, etc. |
| amount_usdc | numeric | Current allocation (wei) |
| percentage | numeric | % of total |
| apy | numeric | Current APY |
| updated_at | timestamptz | Last update |

### rebalance_logs

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| account_id | uuid | FK → accounts |
| tx_hash | text | On-chain transaction hash |
| from_allocations | jsonb | Previous state |
| to_allocations | jsonb | New state |
| gas_cost_usd | numeric | Gas cost in USD |
| apr_improvement | numeric | Net APR change |
| status | text | pending / confirmed / failed |
| created_at | timestamptz | Execution time |

### protocol_configs

| Column | Type | Description |
|--------|------|-------------|
| id | text | Protocol identifier |
| name | text | Display name |
| contract_address | text | On-chain address |
| risk_score | numeric | 1-10 risk rating |
| max_allocation_pct | numeric | Max % of total |
| is_active | boolean | In optimizer scope? |
| circuit_breaker_count | integer | Consecutive failures |

---

## Security Architecture

### Defense in Depth

```
Layer 1: Session Key Scoping (on-chain, EVM-enforced)
         → Only approved contracts + functions
         → Rate limits, time bounds, gas caps

Layer 2: TWAP + Cross-Validation (off-chain)
         → 15-min smoothed rates, DefiLlama cross-check
         → 25% APY sanity cap

Layer 3: MILP Hard Constraints (off-chain)
         → 60% max per protocol
         → Min 2 active protocols
         → Net-positive gas gate

Layer 4: Application Security (off-chain)
         → AES-256-GCM session key encryption at rest
         → JWT authentication, API key auth
         → Rate limiting (100 req/min per IP)
         → No session keys or secrets in logs

Layer 5: Emergency (user-controlled)
         → Instant session key revocation
         → Direct smart account access via master key
         → Works even if SnowMind backend is down
```

### Session Key Storage

```
Session Key → AES-256-GCM encrypt → Supabase (encrypted blob)
                                          ↓
              AES key from SESSION_KEY_ENCRYPTION_KEY env var
              (32 bytes, hex-encoded, in Railway secrets)
```

Never stored in plaintext. Decrypted only in-memory when building a UserOperation.

---

## Infrastructure

| Service | Purpose | Region |
|---------|---------|--------|
| Vercel | Frontend hosting | Mumbai (bom1) |
| Railway | Backend hosting | Auto |
| Supabase | PostgreSQL + RLS | (nearest) |
| Pimlico | ERC-4337 bundler + paymaster | Avalanche Fuji/Mainnet |
| ZeroDev | Smart account SDK + deployment | Avalanche |
| Snowtrace | Block explorer (verification) | Avalanche |

---

## Key Design Decisions

1. **MILP over heuristics**: Competitors (ZYF.AI, Sail) use greedy or simulated annealing — no global optimality guarantee. MILP finds the provably optimal allocation.

2. **Kernel v3.1 over Safe**: Native ERC-7579 (no adapter overhead), latest EntryPoint v0.7, 6M+ accounts deployed.

3. **Avalanche specialization**: No dominant yield optimizer on Avalanche. Gas costs 10-50x lower than Ethereum, making multi-protocol splitting efficient from $5K.

4. **Non-custodial by design**: Session keys enforce supply/withdraw-only permissions at the EVM level. Even a fully compromised backend cannot steal funds.

5. **Stateless optimizer + TWAP**: Rate fetcher smooths over 15 minutes, cross-validates with DefiLlama. Prevents flash loan manipulation.




1. Waterfall Allocator
What it does: Decides where your USDC goes across 4 protocols.

The logic is simple — think of filling buckets from top to bottom:
Step 1:  Aave V3 is the "safe default" (base layer, risk score 2/10)

Step 2:  Sort other protocols by APY, highest first

Step 3:  For each protocol:
           "Does it beat Aave by at least 0.5%?"
             YES → put money there (up to caps)
             NO  → skip it, not worth the gas to move

Step 4:  Whatever is left → goes to Aave V3


Real example with $10,000:

Rates right now:
  Aave V3:   3.0%
  Benqi:     3.3%   ← only 0.3% above Aave (below 0.5% margin → SKIP)
  Euler V2:  4.2%   ← 1.2% above Aave (qualifies!)
  Spark:     3.8%   ← 0.8% above Aave (qualifies!)

Result:
  Euler V2:  $4,000  (40% cap hit)
  Spark:     $4,000  (40% cap hit)
  Aave V3:   $2,000  (remainder parked in base layer)


Why 0.5% margin? Moving money costs gas. If Benqi is only 0.3% better than Aave, the gas + risk isn't worth it. The 0.5% threshold prevents unnecessary rebalancing.

Safety caps that protect you:

No single protocol gets more than 40% of your deposit
We never put more than 15% of a protocol's total TVL (so we don't "move the market")
Protocols with less than $100K TVL are skipped entirely
Files: apps/backend/app/services/optimizer/waterfall_allocator.py  







2. Atomic Fee Collection
The problem before: The 10% profit fee was calculated in the code but never actually deducted. When you withdrew, you got 100% back — no fee went to the treasury.

How it works now:

You deposit $10,000
  ↓
Over time, yield grows it to $10,500
  ↓
You click "Withdraw All"
  ↓
Backend calculates:
  profit = $10,500 - $10,000 = $500
  fee    = $500 × 10% = $50
  you get = $10,500 - $50 = $10,450
  ↓
ONE single transaction is built with ALL these calls:
  Call 1: aavePool.withdraw(USDC, MAX)     ← pull from Aave
  Call 2: eulerVault.redeem(shares)         ← pull from Euler
  Call 3: USDC.transfer(treasury, $50)      ← fee to treasury
  ↓
All 3 calls happen ATOMICALLY — either ALL succeed or NONE do.
The fee can't be collected without the withdrawal, and vice versa.




Why "atomic" matters: If the fee transfer were a separate transaction, it could fail independently — user gets their money but treasury gets nothing. By batching everything into one UserOperation, it's all-or-nothing.

Files: apps/backend/app/services/optimizer/rebalancer.py (execute_emergency_withdrawal)

3. Treasury-Scoped USDC Transfer Permission
The problem: The session key (the AI agent's limited key) could call supply, withdraw, mint, redeem on protocols — but couldn't call USDC.transfer() to send the fee to the treasury.

What was added: A new permission in the session key's on-chain call policy:

USDC.transfer() is allowed BUT:
  - Recipient MUST equal the treasury address (enforced on-chain)
  - Amount MUST be ≤ maxAmount (enforced on-chain)


This means even if someone steals the session key, they can only send USDC to the treasury — not to their own wallet. The blockchain contract itself enforces this.

Files: apps/web/lib/zerodev.ts (call policy), apps/web/app/(app)/onboarding/page.tsx




4. Euler V2 + Spark Re-enabled for Mainnet
Before: Both were marked "coming soon" and disabled. Only Aave + Benqi were active.

After: Found real mainnet vault addresses and re-enabled both:

Euler V2: 0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e (~$489K TVL)
Spark spUSDC: 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d (~$10M TVL)
Both use ERC-4626 (standard vault interface), so the existing adapters work with just an address change.

Files: apps/backend/app/core/config.py, apps/web/lib/constants.ts, apps/backend/app/services/protocols/__init__.py

5. TVL-Based Protocol Filtering
What it does: Before the waterfall allocator runs, any protocol with less than $100K in total value locked is automatically skipped.

Why: Low TVL = low liquidity. If a vault only has $50K and we deposit $10K, our withdrawal could be difficult if other users withdraw first. The $100K floor is a safety net.

# In rate_fetcher.py
if result.tvl_usd > 0 and result.tvl_usd < $100K:
    skip this protocol for this cycle


Files: apps/backend/app/services/optimizer/rate_fetcher.py, apps/backend/app/core/config.py (MIN_PROTOCOL_TVL_USD)

6. Aave Adapter Bug Fix
Found and fixed a typo in the mainnet USDC address — 0x...48a6C (wrong) → 0x...48a6E (correct). Also removed hardcoded testnet/mainnet conditional logic and made it always use settings.USDC_ADDRESS directly.

Files: apps/backend/app/services/protocols/aave.py

7. Simplified Withdrawal Route
The /withdraw-all API endpoint had duplicate fee calculation — once in the route handler, once inside execute_emergency_withdrawal(). Cleaned it up so fee logic lives in one place only (inside the rebalancer). The route just calls it and returns the result.

Files: apps/backend/app/api/routes/rebalance.py
