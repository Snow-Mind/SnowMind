# SnowMind — Final Architecture
> Production mainnet reference. Written for founders, engineers, and auditors.
> Last updated: March 2026

---

## What Is SnowMind?

SnowMind is an **autonomous yield optimization agent** for USDC on Avalanche C-Chain. You deposit USDC, grant the agent limited on-chain permissions, and it automatically moves your money between DeFi lending protocols to earn the best available yield — while you retain full ownership and can exit at any time.

Think of it as a yield routing layer with your risk rules, not ours. Unlike competitors, users above $10,000 can set per-protocol allocation caps, disable specific protocols, and choose risk presets. The agent respects these preferences every cycle.

**Key facts:**
- Chain: Avalanche C-Chain (mainnet, chain ID 43114)
- Supported protocols: Aave V3, Benqi, Spark
- Asset: Native USDC only (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- Non-custodial: User's EOA owns the smart account. SnowMind has scoped permissions only.
- Agent fee: 10% of profit, charged proportionally on every withdrawal
- Beta users: Agent fee waived (flag set per account in database)
- Rebalance frequency: Every 30 minutes, subject to all pre-checks

---

## System Architecture Overview

```
  USER (MetaMask / Social Login via Privy)
   │
   ▼
┌─────────────────────────────────────────────┐
│         FRONTEND  (Next.js 15, Vercel)       │
│                                              │
│  Privy Auth → ZeroDev Smart Account         │
│  Dashboard: yield, allocations, history      │
│  Deposit (<$10K) → direct flow               │
│  Deposit (≥$10K) → allocation preferences   │
│  Emergency Withdraw → one-click exit         │
└─────────────────┬───────────────────────────┘
                  │  HTTPS + JWT
                  ▼
┌─────────────────────────────────────────────┐
│        BACKEND  (FastAPI, Python 3.12)       │
│              Railway (Pro)                   │
│                                              │
│  Scheduler (30 min) → per-account pipeline  │
│  Rate Fetcher → reads APYs on-chain         │
│  Health Checker → protocol safety checks    │
│  Allocator → ranks protocols, computes plan │
│  Pre-check Engine → 19-step gate            │
│  Fee Calculator → 10% proportional          │
│  Withdrawal Builder → atomic UserOp         │
└──────────┬──────────────────┬───────────────┘
           │                  │
           ▼                  ▼
┌──────────────────┐  ┌────────────────────────┐
│   Supabase DB    │  │  Execution Service      │
│   (PostgreSQL)   │  │  (Node.js, Railway)     │
│                  │  │                         │
│  accounts        │  │  ZeroDev SDK            │
│  session_keys    │  │  → deserialize session  │
│  allocations     │  │  → build UserOperation  │
│  rebalance_logs  │  │  → sign with session key│
│  rate_snapshots  │  │  → send to Pimlico      │
│  daily_apy_snaps │  │  → fallback: Alchemy AA │
│  protocol_health │  └──────────┬──────────────┘
│  user_prefs      │             │
│  yield_tracking  │             │ UserOperation (ERC-4337)
│  scheduler_locks │             ▼
└──────────────────┘  ┌────────────────────────┐
                       │    AVALANCHE C-CHAIN   │
                       │                        │
                       │  Kernel v3.1 Smart Acct│
                       │    ├─► Aave V3 Pool    │
                       │    ├─► Benqi qiUSDCn   │
                       │    └─► Spark spUSDC    │
                       │                        │
                       │  SnowMindRegistry      │
                       │  EntryPoint v0.7       │
                       └────────────────────────┘
```

---

## The Three Protocols

### Aave V3 — Primary Lending Protocol
- **Contract**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- **Type**: Lending pool with floating utilization-based APY
- **Interface**: `supply(asset, amount, onBehalfOf, referralCode)` / `withdraw(asset, amount, to)`
- **APY Source**: `getReserveData(USDC).currentLiquidityRate` → RAY (1e27) → annualized
- **TVL Cap**: 15% of total USDC supplied (prevents market impact)
- **Risk Score**: 2/10 — battle-tested since 2020, $10B+ TVL globally
- **Health checks**: Reserve flags (is_active, is_frozen, is_paused), utilization rate, exploit detection

### Benqi — Avalanche-Native Lending
- **Contract**: `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` (qiUSDCn)
- **Type**: Compound V2 fork with floating utilization-based APY
- **Interface**: `mint(amount)` / `redeem(qiTokenAmount)`
- **APY Source**: `supplyRatePerTimestamp()` → annualized (use `exchangeRateStored()` for balance, NOT `exchangeRateCurrent()`)
- **TVL Cap**: 15% of total USDC supplied
- **Risk Score**: 3/10 — established on Avalanche since 2021
- **Health checks**: Comptroller pause flags (mintGuardianPaused, redeemGuardianPaused), utilization, exploit detection

### Spark — Fixed-Rate Savings Vault
- **Contract**: `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` (spUSDC)
- **Type**: ERC-4626 vault. USDC bridges to Ethereum and earns MakerDAO DSR. Rate is governance-set.
- **Interface**: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **APY Source**: `convertToAssets(1e6)` delta vs 24h-ago snapshot × 365 (measured on Avalanche side)
- **Effective APY**: `gross_apy × 0.90` — only 90% of deposit is deployed for yield (10% instant-redemption buffer per Spark V2)
- **PSM Fee**: Read `psmWrapper.tin()` before every deposit. If `tin > 0`: `effective_apy -= (tin/1e18) × (365/expected_hold_days)`. If `tin == type(uint256).max`: deposits are disabled, exclude from allocation.
- **TVL Cap**: NONE — fixed rate does not compress under deposit pressure
- **Risk Score**: 3/10 — MakerDAO-backed, well-audited, but Avalanche deployment is < 6 months old
- **Health checks**: `vat.live() == 1` (MakerDAO global settlement), `tin` value only. NO utilization, NO TVL minimum, NO sanity bound, NO velocity check, NO APY stability check.

**Why Spark is different:** All other checks (utilization, rate volatility, velocity spikes, TVL depth) exist to detect borrow-side demand anomalies on lending protocols. Spark has no borrow side on Avalanche. Its rate is a governance parameter. Running lending-protocol checks on Spark produces meaningless output. The only real risks for Spark are MakerDAO global settlement (vat.live) and the PSM deposit gate (tin).

---

## Allocation Algorithm

### The Core Logic (No Base Layer)

There is no default "base layer." Every protocol competes on effective APY. The algorithm is:

```
1. Rank all healthy protocols by effective TWAP APY (highest first)
   Use spark_effective_apy = spark_gross_apy × 0.90 - annualized_psm_fee for Spark
   Use twap_apy directly for Aave and Benqi

2. For each protocol in ranked order:
   a. If protocol is Aave or Benqi:
      max_allowed = min(remaining_funds, 0.15 × protocol_tvl)
   b. If protocol is Spark:
      max_allowed = remaining_funds  (no TVL cap)
   c. Allocate min(remaining_funds, max_allowed)
   d. Subtract allocated amount from remaining_funds
   e. Stop when remaining_funds == 0

3. If remaining_funds > 0 after all protocols:
   → Hold as idle USDC in smart account
   → Alert ops team: "TVL overflow"
   → This means SnowMind's own TVL cap needs tightening
```

### Why This Works

Spark almost always ranks third (lowest APY) and absorbs overflow — giving it the same practical effect as the old "base layer" design, but without the artificial bias. If governance raises the DSR and Spark ranks first, it captures all funds, which is also correct. The algorithm is neutral and APY-driven.

### User Allocation Preferences (≥ $10,000 deposits)

Users can override system defaults with per-protocol caps:

```python
def get_effective_cap(protocol, user_prefs, total_balance, protocol_tvl):
    if not user_prefs[protocol]["enabled"]:
        return 0  # user disabled this protocol

    if protocol == "spark":
        user_cap = user_prefs["spark"]["max_pct"] * total_balance
        return user_cap  # no system TVL cap for Spark

    system_tvl_cap = 0.15 * protocol_tvl
    user_amount_cap = user_prefs[protocol]["max_pct"] * total_balance
    return min(system_tvl_cap, user_amount_cap)  # most restrictive wins
```

**Risk Presets:**
| Preset | Aave max | Benqi max | Spark |
|---|---|---|---|
| Conservative | 70% | 20% | unlimited |
| Balanced (default) | 50% | 40% | unlimited |
| Aggressive | 40% | 40% | unlimited |
| Custom | user-set | user-set | user-set |

**UX Flow:**
- Deposit < $10,000 → skip allocation preferences, auto-allocate to highest APY
- Deposit ≥ $10,000 → show allocation preferences page with preset selector + sliders
- Live projection: "Your allocation: 3.94% APY — Optimal would be 4.08% APY. You're leaving $140/yr on the table for this risk profile."

**Post-deposit preference changes:**
- Tightening a cap: if current allocation exceeds new cap → flag `FORCED_REBALANCE`
- Loosening a cap: let next natural cycle pick it up
- Disabling a protocol with funds in it: flag `FORCED_REBALANCE`

---

## Complete Pre-Rebalance Flow (19 Steps)

Every step runs in order. A SKIP at any step means this account is not rebalanced this cycle. A FORCED_REBALANCE or EMERGENCY_EXIT flag bypasses steps 3, 16, and 18.

```
SCHEDULER FIRES (every 30 minutes)

1. ACQUIRE DISTRIBUTED LOCK
   SELECT scheduler_lock FOR UPDATE SKIP LOCKED
   If lock held: EXIT (prevent parallel duplicate runs)
   Write: { locked_at: now(), expires_at: now() + 35min }

2. LOAD ACTIVE ACCOUNTS
   WHERE is_active = true
     AND session_key_expires_at > now() + INTERVAL '24 hours'
   (Skip accounts with expiring session keys — require renewal first)

   ═══ PER-ACCOUNT LOOP ═══════════════════════════════════════

3. TIME GATE
   If last_rebalance < 6h ago: SKIP
   Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

4. READ ON-CHAIN BALANCES [parallel RPC]
   aave_bal   = aavePool.getUserAccountData(smartAccount) → USDC supplied
   benqi_bal  = qiUSDCn.balanceOfUnderlying(smartAccount) → uses exchangeRateStored()
   spark_bal  = spUSDC.convertToAssets(spUSDC.balanceOf(smartAccount))
   total_bal  = sum
   If total_bal < $10: SKIP (dust)

5. PROTOCOL HEALTH CHECKS — AAVE [parallel with steps 6 and 7]
   reserve_config = aavePool.getReserveData(USDC)
   If is_paused OR is_frozen OR NOT is_active:
     → Exclude from allocation
     → If aave_bal > 0: flag FORCED_REBALANCE
   aave_cash = usdc.balanceOf(aToken_address)
   aave_utilization = 1 - (aave_cash / aToken.totalSupply())
   If utilization > 0.90: HIGH_UTILIZATION → exclude from new deposits only

6. PROTOCOL HEALTH CHECKS — BENQI [parallel with steps 5 and 7]
   If comptroller.mintGuardianPaused(qiUSDCn): exclude from deposits
   If comptroller.redeemGuardianPaused(qiUSDCn):
     → ALERT: withdrawals may be locked
     → If benqi_bal > 0: alert ops (cannot force exit)
   cash = qiUSDCn.getCash()
   total_borrows = qiUSDCn.totalBorrows()
   total_reserves = qiUSDCn.totalReserves()
   benqi_utilization = total_borrows / (cash + total_borrows - total_reserves)
   If utilization > 0.90: HIGH_UTILIZATION → exclude from new deposits only

7. PROTOCOL HEALTH CHECKS — SPARK [parallel with steps 5 and 6]
   tin = psmWrapper.tin()
   If tin == type(uint256).max: DEPOSITS_DISABLED → exclude from allocation
   spark_fee_rate = tin / 1e18
   vat_live = vat.live()
   If vat_live != 1: EMERGENCY_EXIT → move ALL spark funds immediately

8. FETCH APYs [only for non-excluded protocols, parallel]
   aave_apy   = currentLiquidityRate → RAY to APY conversion
   benqi_apy  = supplyRatePerTimestamp() → annualized
   spark_gross = (today_convertToAssets - yesterday_snapshot) / yesterday × 365
   spark_effective = spark_gross × 0.90 - (spark_fee_rate × 365 / expected_hold_days)

9. TWAP CALCULATION
   Load last 3 rate snapshots from rate_snapshots table (persisted, not in-memory)
   If < 3 snapshots exist for this account: SKIP (cold start guard)
   twap_apy[protocol] = average(last_3_snapshots)
   Write current rates to rate_snapshots NOW (before any decision)

10. VELOCITY CHECK [Aave and Benqi only — NOT Spark]
    delta = |current_apy - snapshot_30min_ago| / snapshot_30min_ago
    If delta > 25%: exclude protocol this cycle, increment circuit_breaker_counter
    Spark is exempt: governance rate changes are expected step changes

11. EXPLOIT DETECTION [Aave and Benqi only — NOT Spark]
    Load yesterday_avg from daily_apy_snapshots
    If twap_apy > 2× yesterday_avg AND utilization > 0.90:
      → EXPLOIT_SUSPECTED
      → Exclude from new deposits
      → If existing position > 0: EMERGENCY_EXIT (bypass 6h time gate)
    Spark exempt: no utilization curve, no borrow-side exploit vector

12. SANITY BOUND [Aave and Benqi only — NOT Spark]
    If twap_apy > 25%: exclude (unrealistic, possible oracle attack)
    Spark exempt: governed rate will never approach 25%

13. CIRCUIT BREAKER [all 3 protocols]
    If consecutive_rpc_failures >= 3: exclude
    Resets on first successful execution involving this protocol

14. APY STABILITY CHECK — 7-DAY [Aave and Benqi only — NOT Spark]
    Load 7 daily snapshots from daily_apy_snapshots
    relative_swing = (max_7d - min_7d) / avg_7d
    If relative_swing > 0.50 (50%): exclude from new deposits this cycle
    (Does NOT force-exit existing positions by itself)
    Spark exempt: step changes from governance are expected and meaningful

15. TVL CAP AUTO-WITHDRAW CHECK [Aave and Benqi only — NOT Spark]
    current_share = current_position / protocol_tvl
    If current_share > 0.15:
      → Set max_new_allocation = 0
      → Flag FORCED_REBALANCE to reduce to exactly 15% cap

16. BEAT MARGIN CHECK
    new_weighted_apy = Σ(new_alloc[p] / total_bal × twap_apy[p]) for each protocol
    current_weighted_apy = Σ(current_alloc[p] / total_bal × twap_apy[p])
    If new_weighted_apy - current_weighted_apy < 0.001 (0.1%): SKIP
    Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

17. DELTA CHECK
    total_movement = Σ|new_alloc[p] - current_alloc[p]| / 2
    If total_movement < $1: SKIP (already optimal, nothing to do)

18. PROFITABILITY GATE
    gas_cost = $0.008 (one Avalanche UserOp, all moves batched)
    spark_new_deposit = max(0, new_alloc["spark"] - current_alloc["spark"])
    psm_one_time_fee = spark_new_deposit × spark_fee_rate
    total_cost = gas_cost + psm_one_time_fee
    daily_gain = (new_weighted_apy - current_weighted_apy) × total_bal / 365
    If daily_gain < total_cost: SKIP
    Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

19. EXECUTE
    Build UserOperation:
      Withdrawal order: lowest-APY current position first
      Deposit order: highest-APY target first
      All calls batched in one atomic UserOperation
    Send to Execution Service → Pimlico (fallback: Alchemy AA API)
    On success: update allocations, write rebalance_log, reset circuit breakers
    On failure: increment circuit_breaker_counter for involved protocols, log failure

RELEASE LOCK
```

---

## Step-by-Step User Journey

### Step 1: Connect Wallet
User visits snowmind.xyz. Privy handles authentication — MetaMask, social login (Google/email), or embedded wallet.

### Step 2: Smart Account Created
ZeroDev deploys a Kernel v3.1 ERC-4337 smart account on Avalanche. The user's EOA becomes the permanent owner. Same owner always gets the same smart account address (deterministic CREATE2 deployment).

### Step 3: Deposit USDC

**Under $10,000:**
- User types amount
- Frontend shows: "Funds will go to highest-yield protocol automatically"
- Confirm → execute

**$10,000 and above:**
- User selects which protocols to allow
- Chooses risk preset or custom sliders
- Live APY projection updates as sliders move
- Confirm → execute

Deposit transaction (one atomic UserOperation):
1. `USDC.approve(targetProtocol, amount)`
2. `protocol.supply/mint/deposit(amount)`

### Step 4: Grant Session Key
User signs a session key. This is a limited-permission key the agent uses to rebalance without asking the user every time.

**Session key CAN do:**
- `aavePool.supply()` and `aavePool.withdraw()` (Aave V3)
- `qiUSDCn.mint()` and `qiUSDCn.redeem()` (Benqi)
- `spUSDC.deposit()` and `spUSDC.redeem()` (Spark)
- `USDC.approve()` on the three protocol contracts
- `USDC.transfer()` to SNOWMIND_TREASURY (agent fee, amount-capped)
- `USDC.transfer()` to user's EOA (withdrawal — read from on-chain owner, NEVER from DB)

**Session key CANNOT do:**
- Transfer USDC to any other address
- Call any function not listed above
- Operate after 7 days (expires, auto-renewal triggered on next frontend visit)
- Exceed 20 operations per day
- Exceed 0.5 AVAX total gas

All restrictions are enforced on-chain by Kernel v3.1 call policy. A stolen session key can only do what the policy allows.

Session key storage: serialized → AES-256-GCM encrypted → stored in Supabase. The encryption key lives in KMS (AWS KMS or Supabase Vault with envelope encryption). Never in Railway environment variables.

### Step 5: Agent Monitors and Rebalances (Every 30 Minutes)
The 19-step pre-rebalance flow runs for each active account. If all checks pass, the agent executes the rebalance using the session key. Users pay zero gas — ZeroDev paymaster sponsors it.

### Step 6: Withdrawals

**Partial Withdrawal (no amount cap from user):**
```
proportion = withdraw_amount / current_balance
accrued_profit = max(0, current_balance - net_principal)
attributable_profit = accrued_profit × proportion
agent_fee = attributable_profit × 0.10
  (If account is fee_exempt: agent_fee = 0)
user_receives = withdraw_amount - agent_fee

Update: net_principal -= (withdraw_amount - agent_fee)
```

**Full Withdrawal:**
```
Same formula as partial, applied to 100% of balance.
After withdrawal: session key revoked, account deactivated.
User keeps smart account, can re-deposit anytime.
```

**Atomic UserOperation for withdrawal:**
```
Call 1: aavePool.withdraw(USDC, MAX, smartAccount)
Call 2: qiUSDCn.redeem(full_qi_balance)
Call 3: spUSDC.redeem(full_share_balance, smartAccount, smartAccount)
Call 4: USDC.transfer(TREASURY, agent_fee_amount)  ← fixed amount
Call 5: USDC.transfer(userEOA, type(uint256).max)   ← sweep everything remaining
```

Call 5 uses MAX sweep — not a hardcoded amount — to avoid rounding residuals from interest accrued between balance-read and execution.

**Fee-exempt accounts:** If `accounts.fee_exempt = true`, Call 4 is omitted. The UserOperation has only 4 calls. This is set by SnowMind admin in the database for beta users.

---

## Agent Fee Model

- **Name**: Agent fee (not "performance fee")
- **Rate**: 10% of profit
- **Timing**: Proportional on every withdrawal, partial or full
- **Basis**: `net_principal = cumulative_deposited - cumulative_net_withdrawn`
- **Profit calculation**: `max(0, current_balance - net_principal)` — user never pays fee on a loss
- **Fee-exempt accounts**: Beta users, set via `accounts.fee_exempt = true` in DB
- **Treasury**: Gnosis Safe multisig (`SNOWMIND_TREASURY` address)

**Why proportional on every withdrawal (not only at full exit):**
Charging fee only at full withdrawal allows any user to extract all earned yield fee-free by doing one large partial withdrawal just below their full balance. The proportional model is unexploitable, simpler to explain, and correctly attributes fee to the profit actually extracted at each withdrawal.

**Bypass tradeoff:** A technically sophisticated user can call `execute()` on their smart account directly from their EOA via Snowtrace, bypassing the backend withdrawal flow entirely. This is intentional — the user owns their smart account. Every competitor (Giza, ZyFai, Sail) accepts this same tradeoff. It is the price of being truly non-custodial. Backend monitors for on-chain USDC outflows that don't go through the normal flow and flags those accounts for reconciliation.

---

## Security Model

### Defense Layers

```
Layer 1: On-Chain Session Key Call Policy (Kernel v3.1)
  ├─ Whitelisted functions only (supply, withdraw, mint, redeem, approve, transfer)
  ├─ Whitelisted contracts only (Aave V3, Benqi, Spark, USDC)
  ├─ USDC.transfer only to TREASURY and userEOA (two destinations, both verified)
  ├─ userEOA address read from on-chain owner record — NEVER from Supabase
  ├─ Amount cap on treasury transfer
  ├─ 7-day expiry, 20 ops/day rate limit
  └─ 0.5 AVAX total gas cap

Layer 2: Rate Validation (Backend)
  ├─ TWAP smoothing (3-snapshot average, persisted to DB — not in-memory)
  ├─ Velocity check (>25% rate jump → exclude)
  ├─ Exploit detection (APY spike + utilization spike → emergency exit)
  ├─ Sanity bound (>25% APY → exclude)
  └─ 7-day APY stability (>50% relative swing → skip)

Layer 3: Protocol Safety (Backend)
  ├─ Admin pause flag detection (Aave reserve flags, Benqi comptroller, Spark vat.live)
  ├─ Utilization monitoring (>90% → no new deposits)
  ├─ TVL minimum ($100K for Aave/Benqi)
  ├─ TVL cap enforcement (15% of pool, auto-withdraw if exceeded)
  └─ Circuit breaker (3 RPC failures → exclude, resets on success)

Layer 4: Infrastructure Security
  ├─ Session key encryption: AES-256-GCM with KMS envelope encryption
  ├─ Encryption key: AWS KMS or Supabase Vault — never in environment variables
  ├─ Key rotation: aligned with 7-day session key expiry
  ├─ Supabase RLS: users can only read their own accounts/allocations
  ├─ Session keys: USING (false) policy — frontend cannot read them ever
  ├─ Audit log: every session key operation logged to session_key_audit
  └─ Fallback bundler: Pimlico primary, Alchemy AA API as fallback

Layer 5: Platform Caps (Guarded Beta)
  ├─ $50,000 total platform deposit cap
  ├─ Cap increase schedule: $50K → $500K (after 30 days + audit) → $5M (after security review)
  └─ Each increase updates SnowMindRegistry on-chain (transparent, verifiable)

Layer 6: User Always Has the Exit
  ├─ Owner EOA has full control of smart account
  ├─ Can withdraw directly via Snowtrace (no UI needed)
  ├─ Can revoke session key at any time from frontend
  └─ Emergency withdrawal: one-click in UI, bypasses all time gates
```

### Critical Security Rule: userEOA Source

When building the session key call policy for USDC.transfer to userEOA:

```typescript
// WRONG — reads from DB, spoofable by DB compromise
const userEOA = await supabase.from('accounts').select('owner_eoa').eq('id', userId)

// CORRECT — reads from chain, immutable
const userEOA = await kernelAccount.getOwner()  // on-chain record
```

If an attacker compromises Supabase and changes the stored EOA address, a DB-read approach would mint a session key allowing transfers to the attacker's wallet. The on-chain read is immune to this.

---

## Database Schema

```sql
-- Core account registry
CREATE TABLE accounts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_eoa           text NOT NULL UNIQUE,       -- user's MetaMask/Privy wallet
    smart_account       text NOT NULL UNIQUE,       -- ZeroDev Kernel v3.1 address
    is_active           boolean DEFAULT false,
    fee_exempt          boolean DEFAULT false,       -- true = beta user, no agent fee
    session_key_expires_at timestamptz,
    created_at          timestamptz DEFAULT now()
);

-- Encrypted session keys (never readable by frontend)
CREATE TABLE session_keys (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id),
    encrypted_blob      text NOT NULL,              -- AES-256-GCM via KMS
    iv                  text NOT NULL,
    created_at          timestamptz DEFAULT now(),
    expires_at          timestamptz NOT NULL
);

-- Current USDC positions per protocol
CREATE TABLE allocations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id),
    protocol            text NOT NULL,              -- 'aave', 'benqi', 'spark'
    usdc_amount         numeric(30, 6) NOT NULL,
    updated_at          timestamptz DEFAULT now(),
    UNIQUE(account_id, protocol)
);

-- Rebalance history (every decision, including skips)
CREATE TABLE rebalance_logs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id),
    status              text NOT NULL,              -- 'executed', 'skipped', 'failed'
    skip_reason         text,
    from_protocol       text,
    to_protocol         text,
    amount_moved        numeric(30, 6),
    tx_hash             text,
    apy_improvement     numeric(10, 6),
    created_at          timestamptz DEFAULT now()
);

-- Raw APY snapshots (TWAP source, persisted — not in-memory)
CREATE TABLE rate_snapshots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol            text NOT NULL,
    apy_raw             numeric(10, 6) NOT NULL,
    apy_effective       numeric(10, 6),             -- spark: gross × 0.90 - psm_fee
    spark_tin           numeric(30, 0),             -- tin value at time of snapshot
    captured_at         timestamptz DEFAULT now()
);

-- Daily averages for 7-day stability and exploit detection
CREATE TABLE daily_apy_snapshots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol            text NOT NULL,
    avg_apy             numeric(10, 6) NOT NULL,
    min_apy             numeric(10, 6),
    max_apy             numeric(10, 6),
    snapshot_date       date NOT NULL,
    UNIQUE(protocol, snapshot_date)
);

-- Fee accounting (high-water mark model)
CREATE TABLE account_yield_tracking (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id) UNIQUE,
    cumulative_deposited  numeric(30, 6) DEFAULT 0,  -- total USDC deposited
    cumulative_net_withdrawn numeric(30, 6) DEFAULT 0, -- total USDC withdrawn net of fees
    -- net_principal = cumulative_deposited - cumulative_net_withdrawn
    updated_at          timestamptz DEFAULT now()
);

-- Protocol health and circuit breaker state
CREATE TABLE protocol_health (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol            text NOT NULL UNIQUE,
    consecutive_failures integer DEFAULT 0,
    last_failure_at     timestamptz,
    status              text DEFAULT 'healthy',     -- 'healthy', 'degraded', 'excluded'
    updated_at          timestamptz DEFAULT now()
);

-- Scheduler distributed lock (prevents parallel duplicate runs)
CREATE TABLE scheduler_locks (
    id                  text PRIMARY KEY DEFAULT 'global_lock',
    locked_at           timestamptz NOT NULL,
    expires_at          timestamptz NOT NULL
);

-- Audit trail for every session key operation
CREATE TABLE session_key_audit (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id),
    action              text NOT NULL,              -- 'created', 'used', 'revoked', 'expired'
    details             jsonb,
    created_at          timestamptz DEFAULT now()
);

-- User allocation preferences
CREATE TABLE user_preferences (
    account_id          uuid REFERENCES accounts(id),
    protocol            text NOT NULL,              -- 'aave', 'benqi', 'spark'
    enabled             boolean DEFAULT true,
    max_pct             numeric(5, 4),              -- 0.5000 = 50% cap
    updated_at          timestamptz DEFAULT now(),
    PRIMARY KEY (account_id, protocol)
);

-- RLS policies
ALTER TABLE session_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No frontend access to session keys"
    ON session_keys FOR ALL USING (false);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own account only"
    ON accounts FOR SELECT USING (owner_eoa = current_setting('request.jwt.claims')::json->>'wallet');

ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own allocations only"
    ON allocations FOR SELECT USING (
        account_id IN (SELECT id FROM accounts WHERE owner_eoa = current_setting('request.jwt.claims')::json->>'wallet')
    );
```

---

## Mainnet Contract Addresses

| Contract | Address | Purpose |
|---|---|---|
| Native USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Circle-issued USDC on Avalanche |
| Aave V3 Pool | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | Primary lending pool |
| Benqi qiUSDCn | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` | Compound-style lending |
| Spark spUSDC | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` | Fixed-rate savings vault |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ERC-4337 standard entry point |
| SnowMindRegistry | *(deploy with Foundry)* | On-chain account registry + audit logs |
| Treasury | *(Gnosis Safe multisig)* | Agent fee collection |

---

## SnowMindRegistry.sol (Production-Ready)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SnowMindRegistry
 * @notice On-chain registry for SnowMind smart accounts.
 *         Tracks active accounts and logs rebalance events for transparency.
 *         Two-step ownership transfer prevents accidental bricking.
 * @dev Owner should be transferred to Gnosis Safe after deployment.
 */
contract SnowMindRegistry {

    address public owner;
    address public pendingOwner;
    uint256 public activeAccountCount;

    struct AccountInfo {
        bool isRegistered;
        uint256 registeredAt;
    }

    mapping(address => AccountInfo) public accounts;
    address[] public registeredAccounts; // append-only historical list

    event AccountRegistered(address indexed account, uint256 timestamp);
    event AccountDeregistered(address indexed account, uint256 timestamp);
    event RebalanceLogged(
        address indexed smartAccount,
        address indexed fromProtocol,
        address indexed toProtocol,
        uint256 amount,
        uint256 timestamp
    );
    event OwnershipTransferProposed(address indexed currentOwner, address indexed proposedOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function register(address account) external onlyOwner {
        require(account != address(0), "Zero address");
        require(!accounts[account].isRegistered, "Already registered");
        accounts[account] = AccountInfo({ isRegistered: true, registeredAt: block.timestamp });
        registeredAccounts.push(account);
        activeAccountCount++;
        emit AccountRegistered(account, block.timestamp);
    }

    function deregister(address account) external onlyOwner {
        require(accounts[account].isRegistered, "Not registered");
        accounts[account].isRegistered = false;
        activeAccountCount--;
        emit AccountDeregistered(account, block.timestamp);
    }

    /**
     * @param smartAccount The user's Kernel smart account. Must be registered.
     * @param fromProtocol Protocol funds are leaving.
     * @param toProtocol Protocol funds are entering.
     * @param amount USDC amount (6 decimals).
     */
    function logRebalance(
        address smartAccount,
        address fromProtocol,
        address toProtocol,
        uint256 amount
    ) external onlyOwner {
        require(accounts[smartAccount].isRegistered, "Account not registered");
        require(fromProtocol != address(0), "Invalid fromProtocol");
        require(toProtocol != address(0), "Invalid toProtocol");
        require(fromProtocol != toProtocol, "Same protocol");
        require(amount > 0, "Zero amount");
        emit RebalanceLogged(smartAccount, fromProtocol, toProtocol, amount, block.timestamp);
    }

    function isRegistered(address account) external view returns (bool) {
        return accounts[account].isRegistered;
    }

    /// @notice Live count of currently active accounts (deregistered = excluded)
    function getActiveCount() external view returns (uint256) {
        return activeAccountCount;
    }

    /// @notice Total accounts ever registered including deregistered
    function getHistoricalCount() external view returns (uint256) {
        return registeredAccounts.length;
    }

    /// @notice Step 1: propose ownership transfer. Does not take effect immediately.
    function proposeOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        require(newOwner != owner, "Already owner");
        pendingOwner = newOwner;
        emit OwnershipTransferProposed(owner, newOwner);
    }

    /// @notice Step 2: new owner accepts. Only callable by pendingOwner.
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    function cancelOwnershipProposal() external onlyOwner {
        pendingOwner = address(0);
    }
}
```

---

## Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 15, React, TypeScript | Hosted on Vercel |
| Auth | Privy | Social login + wallet connection |
| Smart Accounts | ZeroDev SDK, Kernel v3.1 | ERC-4337 with session keys |
| Bundler (primary) | Pimlico | UserOp packaging + submission |
| Bundler (fallback) | Alchemy AA API | Activated on Pimlico failure |
| Paymaster | ZeroDev | Gas sponsorship — zero gas for users |
| Backend | FastAPI, Python 3.12 | Scheduler, optimizer, API |
| Execution Service | Node.js sidecar | UserOp signing + submission |
| Database | Supabase (PostgreSQL) | With RLS, never stores keys in plaintext |
| Encryption KMS | AWS KMS or Supabase Vault | Envelope encryption for session keys |
| Blockchain | Avalanche C-Chain (43114) | Where the money lives |
| RPC (primary) | Infura Avalanche | With exponential backoff |
| RPC (fallback) | Alchemy Avalanche | Auto-failover on primary failure |
| RPC (emergency) | Public Avalanche RPC | Last resort |
| Smart Contracts | Foundry | Deploy + verify |
| Monitoring | Sentry (errors) + Telegram (alerts) | Scheduler health, paymaster balance |
| On-chain monitoring | Tenderly Sentinels | Large USDC movements from managed accounts |
| Treasury | Gnosis Safe multisig | Agent fee collection |

---

## Infrastructure Notes

### Railway Reliability
Railway had a documented platform-wide deployment outage in November 2025. To protect users:
- Backend health endpoint monitored by external uptime service (UptimeRobot or Better Uptime)
- If backend down > 35 minutes, scheduler lock expires and alerts fire
- Emergency withdrawal path: if backend is unreachable, the frontend provides a "manual exit" helper that generates the raw UserOp calldata for the user's EOA to submit directly via Snowtrace

### Paymaster Balance
ZeroDev paymaster must be funded. If it runs empty, all UserOperations fail silently (AA31/AA32 error).
- Alert at < 10 AVAX remaining
- Auto-replenishment script from treasury wallet
- Fallback: if paymaster depleted, surface a UI prompt explaining the user must pay gas temporarily

### Session Key Rotation
- TTL: 7 days
- Auto-renewal: when a session key has < 48 hours remaining, prompt renewal on next frontend visit
- Backend guard: refuse to execute rebalances on keys expiring < 24 hours. Require renewal first.

---

## Competitive Positioning

| Feature | Giza | ZyFai | SnowMind |
|---|---|---|---|
| Chain | Base/Mode + expanding | ZKSync + expanding | Avalanche (native depth) |
| Protocols | Multi-protocol | Multi-protocol | Aave, Benqi, Spark |
| Allocation strategy | Autonomous agent (ARMA model) | ML-driven strategy tiers | Pure APY ranking + safety gates |
| User customization | None | Strategy tier selection | Per-protocol caps, protocol toggle, risk presets |
| Token / incentives | $GIZA token, Swarms | rZFI yield campaign (28-42% APY) | Beta fee-free, points TBD |
| Fee model | Management fee | Performance fee | Agent fee (10% of profit) |
| Custodial? | Non-custodial | Non-custodial | Non-custodial |

**SnowMind's differentiation:** Automated yield optimization with your risk rules, not ours. No other yield agent lets users set per-protocol allocation limits enforced by on-chain call policies. The customizability is not just a UI feature — it's cryptographically enforced.

---

## Key Decisions and Their Reasoning

| Decision | Reasoning |
|---|---|
| No Euler V2 | Unknown vault curator, $489K TVL, Re7 Labs collapse precedent on Avalanche |
| No base layer | Pure APY ranking is neutral and correct. Spark absorbs overflow naturally. |
| No 30% move cap | If pre-checks pass, they pass for full amount. Truncating is incoherent. |
| No TVL cap for Spark | Fixed rate doesn't compress. Cap would only hurt yield. |
| 0.1% beat margin | Low enough to capture real improvements. Low Avalanche gas makes it viable. |
| Proportional fee at every withdrawal | Prevents the partial-withdrawal fee-drain exploit. |
| userEOA from on-chain | DB-stored EOA is spoofable by DB compromise. On-chain is immutable. |
| TWAP persisted to DB | In-memory TWAP is wiped on Railway restart, defeating its purpose. |
| DefiLlama as soft signal | Hard-halt on an external HTTP API is fragile. On-chain is authoritative. |
| 7-day session key TTL | Reduces breach window vs 30-day. Auto-renewal makes UX impact minimal. |
| Two-step ownership on registry | One typo in transferOwnership with instant effect = permanent bricking. |
