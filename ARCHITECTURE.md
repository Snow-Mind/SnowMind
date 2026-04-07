# SnowMind — Final Architecture
> Production mainnet reference. Written for founders, engineers, and auditors.
> Last updated: 21 March 2026

---

## What Is SnowMind?

SnowMind is an **autonomous yield optimization agent** for USDC on Avalanche C-Chain. You deposit USDC, grant the agent limited on-chain permissions, and it automatically moves your money between DeFi lending protocols to earn the best available yield — while you retain full ownership and can exit at any time.

Think of it as a yield routing layer with your risk rules, not ours. Every user — regardless of deposit size — selects which markets to allow and chooses a diversification preference (Max Yield, Balanced, or Diversified). The agent respects these preferences every cycle.

**Key facts:**
- Chain: Avalanche C-Chain (mainnet, chain ID 43114)
- Supported protocols: Aave V3, Benqi, Spark, Euler V2 (9Summits), Silo (savUSD/USDC, sUSDp/USDC, V3 Gami USDC), Folks Finance xChain
- Default onboarding selection: Aave V3, Benqi, Spark, Euler V2, Silo savUSD/USDC, Silo sUSDp/USDC (Silo V3 Gami and Folks are optional)
- Asset: Native USDC only (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- Non-custodial: User's EOA owns the smart account. SnowMind has scoped permissions only.
- Agent fee: 10% of profit, charged proportionally on every withdrawal
- Beta users: Agent fee waived (flag set per account in database)
- Rebalance frequency: Configurable (default 30 minutes in production), subject to all pre-checks

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
│  Onboarding: Account → Strategy → Deposit    │
│  → Activate (same flow for all deposit sizes)│
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
│  rate_snapshots  │  │  → send to ZeroDev      │
│  daily_apy_snaps │  │  (gas-sponsored)        │
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
                       │    ├► Spark spUSDC    │
                       │    ├► Euler V2 Vault  │
                       │    ├► Silo Vaults     │
                       │    └► Folks xChain    │
                       │                        │
                       │  SnowMindRegistry      │
                       │  EntryPoint v0.7       │
                       └────────────────────────┘

Euler and Silo vaults are fully supported: active in the optimizer and default-enabled in the onboarding UI.
```

---

## The Protocols

### Aave V3 — Primary Lending Protocol
- **Contract**: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`
- **Type**: Lending pool with floating utilization-based APY
- **Interface**: `supply(asset, amount, onBehalfOf, referralCode)` / `withdraw(asset, amount, to)`
- **APY Source**: `getReserveData(USDC).currentLiquidityRate` → RAY (1e27) → annualized
- **TVL Cap**: 7.5% of total USDC supplied (prevents market impact)
- **Risk Score**: Dynamic /9 model — static subtotal 4/5 (Oracle 2, Collateral 1, Architecture 1) plus daily Liquidity/Yield add-on (/4)
- **Health checks**: Reserve flags (is_active, is_frozen, is_paused), utilization rate, exploit detection

### Benqi — Avalanche-Native Lending
- **Contract**: `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` (qiUSDCn)
- **Type**: Compound V2 fork with floating utilization-based APY
- **Interface**: `mint(amount)` / `redeem(qiTokenAmount)`
- **APY Source**: `supplyRatePerTimestamp()` → annualized (use `exchangeRateStored()` for balance, NOT `exchangeRateCurrent()`)
- **TVL Cap**: 7.5% of total USDC supplied
- **Risk Score**: Dynamic /9 model — static subtotal 5/5 (Oracle 2, Collateral 2, Architecture 1) plus daily Liquidity/Yield add-on (/4)
- **Health checks**: Comptroller pause flags (mintGuardianPaused, redeemGuardianPaused), utilization, exploit detection

### Spark — Fixed-Rate Savings Vault
- **Contract**: `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` (spUSDC)
- **PSM3 Contract**: `0x7566debc906C17338524a414343FA61bca26a843` (Avalanche PSM3)
- **Type**: ERC-4626 vault. USDC earns MakerDAO DSR. Rate is governance-set.
- **Interface**: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **APY Source**: `convertToAssets(1e6)` delta vs 24h-ago snapshot × 365 (measured on Avalanche side)
- **Effective APY**: `gross_apy × 0.90` — only 90% of deposit is deployed for yield (10% instant-redemption buffer per Spark V2). There is NO PSM deposit fee on Avalanche (PSM3 has no `tin()`).
- **TVL Cap**: NONE — fixed rate does not compress under deposit pressure
- **Risk Score**: Dynamic /9 model — static subtotal 4/5 (Oracle 2, Collateral 2, Architecture 0) plus daily Liquidity/Yield add-on (/4)
- **Health checks**: Two on-chain checks only:
  1. `spUSDC.totalAssets() == 0` → EMERGENCY status, vault is empty/broken
  2. `PSM3.totalAssets() < $1,000` → DEPOSITS_DISABLED, PSM liquidity too low
  - NO utilization, NO TVL minimum, NO sanity bound, NO velocity check, NO APY stability check.
  - Conservative fallbacks: if vault unreadable → DEGRADED + block deposits; if PSM3 unreadable → block deposits

**Avalanche PSM3 architecture (CRITICAL — differs from Ethereum):**
Spark on Avalanche uses PSM3 (`0x7566debc906C17338524a414343FA61bca26a843`), NOT Ethereum's `DssLitePsm`/`UsdsPsmWrapper`. Key differences:
- **No `tin()` method** — PSM3 has zero deposit fee on Avalanche. No fee deduction from effective APY.
- **No MakerDAO `vat` on Avalanche** — `vat.live()` does not exist. Cannot check global settlement.
- **Deposit safety**: `PSM3.totalAssets()` < minimum ($1,000) → deposits disabled.
- **Emergency exit**: `spUSDC.totalAssets() == 0` → vault is empty/broken → emergency exit.
- **Liquidity check**: `spUSDC.maxWithdraw(probe)` used to check if redemptions are possible.

**Why Spark is different:** All other checks (utilization, rate volatility, velocity spikes, TVL depth) exist to detect borrow-side demand anomalies on lending protocols. Spark has no borrow side on Avalanche. Its rate is a governance parameter. Running lending-protocol checks on Spark produces meaningless output. The only real risks for Spark on Avalanche are vault emptiness and PSM3 liquidity pool health.

### Euler V2 (9Summits) — Curated ERC-4626 Vault
- **Contract**: `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e`
- **Type**: ERC-4626 vault curated by 9Summits on Euler V2 infrastructure
- **Interface**: `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **APY Source**: `convertToAssets(1e6)` delta vs 24h-ago snapshot × 365
- **TVL Cap**: NONE — ERC-4626 vault, same as Spark
- **Risk Score**: Dynamic /9 model — static subtotal 2/5 (Oracle 1, Collateral 1, Architecture 0) plus daily Liquidity/Yield add-on (/4)
- **Health checks**: ERC-4626 vault health, circuit breaker. Exempt from lending-specific checks (utilization, velocity, exploit detection) since it is a curated vault, not a lending pool.

### Silo — Isolated Lending Markets (Opt-In)
- **Contracts**: savUSD/USDC `0x33fAdB3dB0A1687Cdd4a55AB0afa94c8102856A1` (market 142), sUSDp/USDC `0xcd0d510eec4792a944E8dbe5da54DDD6777f02Ca` (market 162)
- **Type**: Isolated lending markets — each market has its own risk parameters
- **Interface**: ERC-4626 compatible `deposit(assets, receiver)` / `redeem(shares, receiver, owner)`
- **Risk Score**: Dynamic /9 model — static subtotal savUSD 4/5, sUSDp 3/5, plus daily Liquidity/Yield add-on (/4)
- **Status**: Fully active in optimizer; opt-in only (user must explicitly enable in onboarding UI)

---

## Allocation Algorithm

### The Core Logic (No Base Layer)

There is no default "base layer." Every protocol competes on effective APY. The algorithm is:

```
1. Rank all healthy protocols by effective TWAP APY (highest first)
   Use spark_effective_apy = spark_gross_apy × 0.90 for Spark (no PSM fee on Avalanche)
   Use twap_apy directly for Aave, Benqi, Euler, and Silo

2. For each protocol in ranked order:
   a. If protocol is Spark:
      max_allowed = remaining_funds  (no TVL cap — PSM3 fixed-rate, doesn't compress)
   b. All other protocols (Aave, Benqi, Euler, Silo):
      max_allowed = min(remaining_funds, 0.15 × protocol_tvl)
   c. Allocate min(remaining_funds, max_allowed)
   d. Subtract allocated amount from remaining_funds
   e. Stop when remaining_funds == 0

3. If remaining_funds > 0 after all protocols:
   → Hold as idle USDC in smart account
   → Alert ops team: "TVL overflow"
   → This means SnowMind's own TVL cap needs tightening
```

### Why This Works

Spark almost always ranks lower and absorbs overflow — giving it the same practical effect as the old "base layer" design, but without the artificial bias. ERC-4626 vaults (Euler, Silo) still respect the 7.5% TVL cap since their liquidity can be limited. The algorithm is neutral and APY-driven.

### User Market Selection & Diversification Preferences

Every user selects which markets (protocols) the agent is allowed to use and chooses a diversification strategy during onboarding. This is the same flow for all deposit sizes — there is no $10K threshold.

**Available Markets:**
| Market | Default Enabled | Static Subtotal (/5) | Runtime Total |
|---|---|---|---|
| Aave V3 | Yes | 4 | Dynamic /9 (adds daily Liquidity + Yield) |
| Benqi | Yes | 5 | Dynamic /9 (adds daily Liquidity + Yield) |
| Spark | Yes | 4 | Dynamic /9 (adds daily Liquidity + Yield) |
| Euler V2 (9Summits) | Yes | 2 | Dynamic /9 (adds daily Liquidity + Yield) |
| Silo savUSD/USDC | Yes | 4 | Dynamic /9 (adds daily Liquidity + Yield) |
| Silo sUSDp/USDC | Yes | 3 | Dynamic /9 (adds daily Liquidity + Yield) |
| Silo V3 Gami USDC | No (Opt-In) | 0 | Dynamic /9 (adds daily Liquidity + Yield) |
| Folks Finance xChain | No (Opt-In) | 4 | Dynamic /9 (adds daily Liquidity + Yield) |

**Diversification Preferences:**
| Preference | Behavior |
|---|---|
| Max Yield | 100% in the single best protocol. Maximum return, no splitting. |
| Balanced (default) | Split across up to 2 protocols, max 60% each. Good default. |
| Diversified | Spread across up to 4 protocols, max 40% each. Maximum safety. |

**Onboarding UX Flow (same for all deposit sizes):**
1. Account → Smart account created
2. Strategy → Select markets to allow + diversification preference
3. Deposit → Enter USDC amount (min $100)
4. Activate → Review & launch (deposit + deploy + session key + registration)

The in-page Market Assistant provides contextual suggestions based on the chosen diversification preference and enabled markets, with protocol-specific risk notes (e.g., Euler volatility warning).

**Post-deposit preference changes:**
- Disabling a protocol with funds in it: flag `FORCED_REBALANCE`
- Changing diversification preference: takes effect on next cycle

> **Note:** Per-protocol allocation cap sliders (risk presets: Conservative, Balanced, Aggressive, Custom) are designed but not yet implemented in the frontend. The current onboarding only captures market selection and diversification preference. Cap enforcement will be added in a future release.

---

## Complete Pre-Rebalance Flow (19 Steps)

Every step runs in order. A SKIP at any step means this account is not rebalanced this cycle. A FORCED_REBALANCE or EMERGENCY_EXIT flag bypasses steps 3, 16, and 18.

```
SCHEDULER FIRES (configurable interval, default 30 min in production)

1. ACQUIRE DISTRIBUTED LOCK
   SELECT scheduler_lock FOR UPDATE SKIP LOCKED
   If lock held: EXIT (prevent parallel duplicate runs)
   Write: { locked_at: now(), expires_at: now() + 35min }

2. LOAD ACTIVE ACCOUNTS
   WHERE is_active = true
   (Session keys are infinite — no expiry filter needed)

   ═══ PER-ACCOUNT LOOP ═══════════════════════════════════════

3. TIME GATE
   If last_rebalance < 6h ago: SKIP
   Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

4. READ ON-CHAIN BALANCES [parallel RPC]
   aave_bal   = aavePool.getUserAccountData(smartAccount) → USDC supplied
   benqi_bal  = qiUSDCn.balanceOfUnderlying(smartAccount) → uses exchangeRateStored()
   spark_bal  = spUSDC.convertToAssets(spUSDC.balanceOf(smartAccount))
   euler_bal  = eulerVault.convertToAssets(eulerVault.balanceOf(smartAccount))
   silo_savusd_bal = siloSavUSD.convertToAssets(siloSavUSD.balanceOf(smartAccount))
   silo_susdp_bal  = siloSUSDp.convertToAssets(siloSUSDp.balanceOf(smartAccount))
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
   Check 1: vault_total = spUSDC.totalAssets()
     If vault_total == 0: EMERGENCY → move ALL spark funds immediately
     If vault unreadable: DEGRADED → block new deposits (conservative)
   Check 2: psm3_total = PSM3.totalAssets()
     If psm3_total < $1,000: DEPOSITS_DISABLED → exclude from new deposits
     If PSM3 unreadable: block new deposits (conservative)
   NOTE: No tin(), no vat.live() — these do not exist on Avalanche PSM3

7b. PROTOCOL HEALTH CHECKS — EULER V2 [parallel with above]
    ERC-4626 vault health check: totalAssets() > 0, convertToAssets() valid
    Circuit breaker check (consecutive RPC failures)
    Exempt from lending-specific checks (utilization, velocity, exploit detection)

7c. CURRENT-PROTOCOL HEALTH ENFORCEMENT (SECURITY-CRITICAL)
    For EACH protocol where the user currently holds funds:
      If that protocol failed ANY health check (is_deposit_safe=false or is_healthy=false):
        → Log "FORCED EXIT" with position amount and failure reasons
        → Set global_flag = FORCED_REBALANCE (or EMERGENCY_EXIT)
        → The allocator will exclude the unhealthy protocol from the new allocation
        → Funds will be moved to the best HEALTHY alternative regardless of APY delta
    If the protocol we're in still passes health checks:
        → Proceed with normal APY-driven rebalance logic
    
    This ensures we never passively sit in a protocol that has become unsafe.
    Health checks don't just gate new deposits — they force exits from existing positions.

8. FETCH APYs [only for non-excluded protocols, parallel]
   aave_apy   = currentLiquidityRate → RAY to APY conversion
   benqi_apy  = supplyRatePerTimestamp() → annualized
   euler_apy  = convertToAssets delta vs 24h snapshot × 365
   spark_gross = (today_convertToAssets - yesterday_snapshot) / yesterday × 365
   spark_effective = spark_gross × 0.90  (no PSM fee on Avalanche)

9. TWAP CALCULATION
   Load last 3 rate snapshots from rate_snapshots table (persisted, not in-memory)
   If < 3 snapshots exist for this account: SKIP (cold start guard)
   twap_apy[protocol] = average(last_3_snapshots)
   Write current rates to rate_snapshots NOW (before any decision)

10. VELOCITY CHECK [all non-Spark protocols]
    delta = |current_apy - snapshot_30min_ago| / snapshot_30min_ago
    If delta > 25%: exclude protocol this cycle, increment circuit_breaker_counter
    Spark is exempt: governance rate changes are expected step changes

11. LIQUIDITY STRESS DETECTION [all non-Spark protocols]
        Read current utilization from protocol health checks
        If utilization > 0.90:
            → Exclude from new deposits
            → If existing position > 0: FORCED_REBALANCE (bypass beat-margin/time-cooldown gates)
        Spark exempt: fixed-rate savings flow and different liquidity mechanics

12. SANITY BOUND [all non-Spark protocols]
    If twap_apy > 25%: exclude (unrealistic, possible oracle attack)
    Spark exempt: governed rate will never approach 25%

13. CIRCUIT BREAKER [all supported protocols]
    If consecutive_rpc_failures >= 3: exclude
    Resets on first successful execution involving this protocol

14. APY STABILITY CHECK — 7-DAY [Aave and Benqi only — NOT Spark]
    Load 7 daily snapshots from daily_apy_snapshots
    relative_swing = (max_7d - min_7d) / avg_7d
    If relative_swing > 0.50 (50%): exclude from new deposits this cycle
    (Does NOT force-exit existing positions by itself)
    Spark exempt: step changes from governance are expected and meaningful

15. TVL CAP AUTO-WITHDRAW CHECK [all non-Spark protocols]
    available_liquidity = protocol_tvl × (1 - utilization)
    current_share = current_position / available_liquidity
    If current_share > 0.075:
      → Set max_new_allocation = 0
      → Flag FORCED_REBALANCE to reduce to exactly 7.5% cap

16. BEAT MARGIN CHECK
    new_weighted_apy = Σ(new_alloc[p] / total_bal × twap_apy[p]) for each protocol
    current_weighted_apy = Σ(current_alloc[p] / total_bal × twap_apy[p])
    If new_weighted_apy - current_weighted_apy < 0.0001 (0.01%): SKIP
    Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

17. DELTA CHECK
    total_movement = Σ|new_alloc[p] - current_alloc[p]| / 2
    If total_movement < $1: SKIP (already optimal, nothing to do)

18. PROFITABILITY GATE
    gas_cost = $0.008 (one Avalanche UserOp, all moves batched)
    total_cost = gas_cost  (no PSM fee on Avalanche)
    daily_gain = (new_weighted_apy - current_weighted_apy) × total_bal / 365
    If daily_gain < total_cost: SKIP
    Exception: FORCED_REBALANCE and EMERGENCY_EXIT bypass this

19. EXECUTE
    Build UserOperation:
      Withdrawal order: lowest-APY current position first
      Deposit order: highest-APY target first
      All calls batched in one atomic UserOperation
    Send to Execution Service → ZeroDev RPC (gas-sponsored via paymaster)
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

### Step 3: Choose Strategy
User selects which markets (protocols) the optimizer is allowed to use by toggling each one on/off. Default onboarding selection includes Aave V3, Benqi, Spark, Euler V2 (9Summits), Silo savUSD/USDC, and Silo sUSDp/USDC, with Silo V3 Gami and Folks available as optional markets.

User also picks a diversification preference:
- **Max Yield**: 100% in the single best protocol
- **Balanced** (default): Split across up to 2 protocols, max 60% each
- **Diversified**: Spread across up to 4 protocols, max 40% each

An in-page Market Assistant provides contextual guidance (e.g., "Recommended: keep 2–3 markets active to reduce single-market risk").

### Step 4: Deposit USDC
User enters the USDC amount (minimum $100). The UI shows:
- Current wallet balance
- Best available APY from selected markets
- Projected yearly earnings

### Step 5: Review & Activate
User reviews summary (deposit amount, APY, markets count, estimated earnings) and confirms.

The activation is an atomic multi-step process:
1. Transfer USDC from EOA → smart account
2. Deploy smart account on-chain + approve USDC for all protocol contracts
3. Initial deployment to highest-APY candidate from selected protocols
4. Grant scoped session key
5. Register with backend optimizer

All steps show real-time progress with a Giza-style phase indicator.

### Step 4: Grant Session Key
User signs a session key during the activation step. This is a limited-permission key the agent uses to rebalance without asking the user every time.

**Session key CAN do:**
- `aavePool.supply()` and `aavePool.withdraw()` (Aave V3)
- `qiUSDCn.mint()` and `qiUSDCn.redeem()` (Benqi)
- `spUSDC.deposit()` and `spUSDC.redeem()` (Spark)
- `eulerVault.deposit()` and `eulerVault.redeem()` (Euler V2 / 9Summits)
- `siloVault.deposit()` and `siloVault.redeem()` (Silo savUSD/USDC + sUSDp/USDC + V3 Gami USDC)
- `folksSpokeCommon.createAccount()` / `folksSpokeCommon.withdraw()` and `folksSpokeUSDC.createLoanAndDeposit()` / `folksSpokeUSDC.deposit()` (Folks Finance xChain)
- `USDC.approve()` on all protocol contracts
- `USDC.transfer()` to SNOWMIND_TREASURY (agent fee, amount-capped)
- `USDC.transfer()` to user's EOA (withdrawal — read from on-chain owner, NEVER from DB)

**Session key CANNOT do:**
- Transfer USDC to any other address
- Call any function not listed above
- Operate on any contract or function not listed above

All restrictions are enforced on-chain by Kernel v3.1 call policy. A stolen session key can only do what the policy allows.

Session key storage: serialized → AES-256-GCM encrypted → stored in Supabase. The encryption key lives in KMS (AWS KMS or Supabase Vault with envelope encryption). Never in Railway environment variables.

### Step 6: Agent Monitors and Rebalances (Every 30 Minutes)
The 19-step pre-rebalance flow runs for each active account. If all checks pass, the agent executes the rebalance using the session key. Users pay zero gas — ZeroDev paymaster sponsors it.

### Step 7: Withdrawals

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
Call 4: eulerVault.redeem(full_share_balance, smartAccount, smartAccount)
Call 5: siloSavUSD.redeem(full_share_balance, smartAccount, smartAccount)
Call 6: siloSUSDp.redeem(full_share_balance, smartAccount, smartAccount)
Call 7: USDC.transfer(TREASURY, agent_fee_amount)  ← fixed amount
Call 8: USDC.transfer(userEOA, type(uint256).max)   ← sweep everything remaining
```

Call 8 uses MAX sweep — not a hardcoded amount — to avoid rounding residuals from interest accrued between balance-read and execution.

**Fee-exempt accounts:** If `accounts.fee_exempt = true`, Call 7 is omitted. The UserOperation has only calls to withdraw + sweep. This is set by SnowMind admin in the database for beta users.

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
    ├─ Whitelisted contracts only (Aave V3, Benqi, Spark, Euler V2, Silo savUSD, Silo sUSDp, Silo V3 Gami, Folks spoke contracts, USDC)
  ├─ USDC.transfer only to TREASURY and userEOA (two destinations, both verified)
  ├─ userEOA address read from on-chain owner record — NEVER from Supabase
  ├─ Amount cap on treasury transfer
  ├─ No expiry (infinite lifetime — revoked on full withdrawal or user request)
  └─ 0.5 AVAX total gas cap

Layer 2: Rate Validation (Backend)
  ├─ TWAP smoothing (3-snapshot average, persisted to DB — not in-memory)
  ├─ Velocity check (>25% rate jump → exclude)
  ├─ Exploit detection (APY spike + utilization spike → emergency exit)
  ├─ Sanity bound (>25% APY → exclude)
  └─ 7-day APY stability (>50% relative swing → skip)

Layer 3: Protocol Safety (Backend)
  ├─ Admin pause flag detection (Aave reserve flags, Benqi comptroller, Spark vault/PSM3 health, Euler vault health)
  ├─ Utilization monitoring (>90% → no new deposits)
  ├─ TVL minimum ($100K for Aave/Benqi)
  ├─ TVL cap enforcement (7.5% of pool, auto-withdraw if exceeded)
  ├─ Circuit breaker (3 RPC failures → exclude, resets on success)
  └─ Current-protocol health enforcement: if the protocol you're IN fails any check,
     force-exit to best healthy alternative regardless of APY delta

Layer 4: Operational Monitoring
  ├─ Paymaster balance monitoring (alert at < 10 AVAX remaining)
  ├─ Scheduler health watchdog (detects missed cycles, fires alerts)
  ├─ Telegram bot alerts for critical events
  └─ Sentry error tracking for all backend exceptions

Layer 5: Infrastructure Security
  ├─ Session key encryption: AES-256-GCM with KMS envelope encryption
  ├─ Encryption key: AWS KMS or Supabase Vault — never in environment variables
  ├─ Key rotation: on user re-grant or full withdrawal (session keys are infinite)
  ├─ Re-grant guard: rejects new key if existing key has >24h remaining (force bypass available)
  ├─ Supabase RLS: users can only read their own accounts/allocations
  ├─ Session keys: USING (false) policy — frontend cannot read them ever
  ├─ Audit log: every session key operation logged to session_key_audit
  └─ Bundler: ZeroDev with gas sponsorship via ZeroDev Paymaster

Layer 6: Platform Caps (Guarded Beta)
  ├─ $50,000 total platform deposit cap
  ├─ Cap increase schedule: $50K → $500K (after 30 days + audit) → $5M (after security review)
  └─ Each increase updates SnowMindRegistry on-chain (transparent, verifiable)

Layer 7: User Always Has the Exit
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
    expires_at          timestamptz NOT NULL         -- Far-future date (2100-01-01) for infinite keys
);

-- Current USDC positions per protocol
CREATE TABLE allocations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid REFERENCES accounts(id),
    protocol            text NOT NULL,              -- 'aave', 'benqi', 'spark', 'euler_v2', 'silo_*', 'silo_gami_usdc', 'folks'
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
    apy_effective       numeric(10, 6),             -- spark: gross × 0.90
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
    protocol            text NOT NULL,              -- 'aave', 'benqi', 'spark', 'euler_v2', 'silo_*', 'silo_gami_usdc', 'folks'
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
| Spark PSM3 | `0x7566debc906C17338524a414343FA61bca26a843` | PSM3 liquidity pool (Avalanche) |
| Euler V2 / 9Summits | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` | Curated ERC-4626 vault |
| Silo savUSD/USDC | `0x33fAdB3dB0A1687Cdd4a55AB0afa94c8102856A1` | Isolated lending market |
| Silo sUSDp/USDC | `0xcd0d510eec4792a944E8dbe5da54DDD6777f02Ca` | Isolated lending market |
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
| Bundler | ZeroDev | UserOp packaging + submission + gas sponsorship |
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
| Monitoring | Sentry (errors) + Telegram (alerts) | Scheduler health, paymaster balance, forced exits |
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

### Session Key Lifetime
- TTL: Infinite (no on-chain expiry)
- Revocation: On full withdrawal (automatic) or user-initiated from dashboard
- Re-grant: User can re-grant session key from dashboard at any time (replaces previous key)
- Backend guard: session key is encrypted (AES-256-GCM) and stored in Supabase. Decrypted only at execution time.

---

## Competitive Positioning

| Feature | Giza | ZyFai | SnowMind |
|---|---|---|---|
| Chain | Base/Mode + expanding | ZKSync + expanding | Avalanche (native depth) |
| Protocols | Multi-protocol | Multi-protocol | Aave V3, Benqi, Spark, Euler V2, Silo (savUSD, sUSDp, V3 Gami), Folks Finance xChain |
| Allocation strategy | Autonomous agent (ARMA model) | ML-driven strategy tiers | Pure APY ranking + safety gates |
| User customization | None | Strategy tier selection | Market selection, diversification pref, protocol toggle |
| Token / incentives | $GIZA token, Swarms | rZFI yield campaign (28-42% APY) | Beta fee-free, points TBD |
| Fee model | Management fee | Performance fee | Agent fee (10% of profit) |
| Custodial? | Non-custodial | Non-custodial | Non-custodial |

**SnowMind's differentiation:** Automated yield optimization with your risk rules, not ours. Every user selects allowed markets and diversification preference — enforced by on-chain call policies. Euler V2, Silo V3 Gami, and Folks can be run as opt-in markets for users who want expanded opportunity/risk profiles. The agent supports 8 protocols across lending pools (Aave, Benqi, Folks), fixed-rate savings/vault flows (Spark), curated vaults (Euler/9Summits, Silo V3 Gami), and isolated markets (Silo savUSD and Silo sUSDp).

---

## Key Decisions and Their Reasoning

| Decision | Reasoning |
|---|---|
| Euler V2 opt-in only | Fresh V2 deployment, lower TVL, 9Summits-curated — higher risk. User must explicitly enable. |
| Silo opt-in only | Growing protocol, isolated markets. Lower TVL than established protocols. |
| No base layer | Pure APY ranking is neutral and correct. Spark absorbs overflow naturally. |
| No 30% move cap | If pre-checks pass, they pass for full amount. Truncating is incoherent. |
| No TVL cap for Spark only | PSM3 fixed-rate doesn't compress under deposits. Euler/Silo have the standard 7.5% TVL cap like Aave/Benqi. |
| 0.1% beat margin | Low enough to capture real improvements. Low Avalanche gas makes it viable. |
| Proportional fee at every withdrawal | Prevents the partial-withdrawal fee-drain exploit. |
| userEOA from on-chain | DB-stored EOA is spoofable by DB compromise. On-chain is immutable. |
| TWAP persisted to DB | In-memory TWAP is wiped on Railway restart, defeating its purpose. |
| DefiLlama as soft signal | Hard-halt on an external HTTP API is fragile. On-chain is authoritative. |
| 7-day session key TTL | Reduces breach window vs 30-day. Auto-renewal makes UX impact minimal. |
| Two-step ownership on registry | One typo in transferOwnership with instant effect = permanent bricking. |
| Spark PSM3 not DssLitePsm | Avalanche uses PSM3 architecture. No tin(), no vat.live(). Health checks adapted accordingly. |
| No $10K onboarding threshold | All users get the same Strategy step. Allocation cap sliders planned for future release. |
| Same flow for all deposit sizes | Simpler UX, same optimization. A $1K and $10K deposit use the same market selection + diversification. |
