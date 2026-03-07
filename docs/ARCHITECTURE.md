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
