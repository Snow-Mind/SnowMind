---
description: Phase 1-2: Foundation + Protocol Adapters
---

<task>
Build the complete SnowMind application for mainnet beta launch on Avalanche C-Chain.
This is a non-custodial autonomous yield optimization agent that automatically
allocates user USDC across Aave V3, Benqi, and Spark to maximize yield while
respecting per-user risk preferences and hard safety constraints.
Build every file listed in the <file_structure> section below with complete,
production-ready, mainnet-ready code. Do not skip any file. Do not use placeholder
comments like "// implement this." Every function must be fully implemented.
</task>
<architecture_context>
Read this carefully — it is the single source of truth for all decisions.
CHAIN: Avalanche C-Chain, chainId 43114
PROTOCOLS:

Aave V3 Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD

APY source: getReserveData(USDC).currentLiquidityRate (RAY = 1e27 → annualize)
Health: is_active, is_frozen, is_paused flags from reserve config bitmap
Utilization: 1 - (usdc.balanceOf(aToken) / aToken.totalSupply())
Full health checks: velocity, exploit detection, sanity bound, 7-day stability


Benqi qiUSDCn: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C

APY source: supplyRatePerTimestamp() → annualized
Balance reads: ALWAYS use exchangeRateStored() (not exchangeRateCurrent())
Withdrawals: redeem by shares (not by amount) for exactness
Health: comptroller.mintGuardianPaused() and redeemGuardianPaused()
Utilization: totalBorrows / (getCash + totalBorrows - totalReserves)
Full health checks: same as Aave


Spark spUSDC: 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d

APY source: convertToAssets(1e6) delta vs 24h-ago snapshot × 365
Effective APY: gross_apy × 0.90 (only 90% deployed per Spark V2 architecture)
PSM fee: read psmWrapper.tin() — if tin > 0: deduct annualized fee from effective APY
if tin == type(uint256).max: deposits disabled, exclude from allocation
Emergency: vat.live() must == 1 (MakerDAO global settlement check)
NO utilization check, NO velocity check, NO sanity bound, NO 7-day stability check
NO TVL cap — fixed governance rate does not compress under deposit pressure



USDC (native Circle): 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E (6 decimals)
EntryPoint v0.7: 0x0000000071727De22E5E9d8BAf0edAc6f37da032
ALLOCATION ALGORITHM:

Filter protocols passing all health checks
Sort by effective TWAP APY (highest first)
For each in order:

Aave/Benqi: allocate min(remaining, 0.15 × protocol_tvl, user_max_cap)
Spark: allocate min(remaining, user_max_cap) — no system TVL cap


If remaining > 0 after all protocols: hold idle, alert ops

BEAT MARGIN: 0.1% (0.001) — skip rebalance if improvement is below this
NO MOVE CAP: Full rebalance when checks pass. The old 30% cap is removed.
SESSION KEY PERMISSIONS (on-chain Kernel call policy):

aavePool.supply(), aavePool.withdraw() on 0x794a61...
qiUSDCn.mint(), qiUSDCn.redeem() on 0xB71580...
spUSDC.deposit(), spUSDC.redeem() on 0x28B3a8...
USDC.approve() on the three protocol contracts only
USDC.transfer() to SNOWMIND_TREASURY (amount-capped)
USDC.transfer() to userEOA — CRITICAL: read from kernelAccount.getOwner() on-chain, NEVER from Supabase
Expiry: 7 days
Rate limit: 20 ops/day
Gas cap: 0.5 AVAX

AGENT FEE:

Name: "agent fee" (never "performance fee")
Rate: 10% of profit
Timing: Proportional on EVERY withdrawal (partial or full)
Formula:
proportion = withdraw_amount / current_balance
accrued_profit = max(0, current_balance - net_principal)
attributable_profit = accrued_profit * proportion
agent_fee = attributable_profit * 0.10
user_receives = withdraw_amount - agent_fee
net_principal -= (withdraw_amount - agent_fee)
Fee-exempt: if accounts.fee_exempt = true, agent_fee = 0 (for beta users)
Final transfer: always sweep balanceOf after fee transfer (Call 5 = type(uint256).max)

USER PREFERENCES (≥$10K deposits):

Per-protocol max_pct cap (0.0–1.0)
Per-protocol enabled toggle
Risk presets: Conservative (70/20/∞), Balanced (50/40/∞), Aggressive (40/40/∞)
</architecture_context>

<pre_rebalance_flow>
These 19 steps run for every account on every 30-minute scheduler cycle.
Implement them in EXACTLY this order. A SKIP at any step means no rebalance for this account this cycle.
FORCED_REBALANCE and EMERGENCY_EXIT flags bypass steps 3, 16, 17, 18.

ACQUIRE DISTRIBUTED LOCK (SELECT FOR UPDATE SKIP LOCKED on scheduler_locks)
LOAD ACTIVE ACCOUNTS (is_active=true AND session_key_expires_at > now() + 24h)
TIME GATE (last_rebalance < 6h ago → SKIP)
READ ON-CHAIN BALANCES (parallel: aave, benqi, spark; if total < $10 → SKIP)
AAVE HEALTH CHECK (reserve flags, utilization > 90% → HIGH_UTILIZATION)
BENQI HEALTH CHECK (comptroller pause flags, utilization > 90% → HIGH_UTILIZATION)
SPARK HEALTH CHECK (tin == max → DEPOSITS_DISABLED; vat.live != 1 → EMERGENCY_EXIT)
FETCH APYs (parallel, only non-excluded protocols; compute spark_effective_apy)
TWAP (load 3 DB snapshots; if < 3 exist → SKIP; write current snapshot to DB)
VELOCITY CHECK (Aave/Benqi only: >25% change vs 30min ago → exclude, increment CB)
EXPLOIT DETECTION (Aave/Benqi only: apy > 2× yesterday AND utilization > 90% → EMERGENCY_EXIT)
SANITY BOUND (Aave/Benqi only: twap_apy > 25% → exclude)
CIRCUIT BREAKER (all protocols: consecutive_failures >= 3 → exclude)
7-DAY STABILITY (Aave/Benqi only: relative_swing > 50% → exclude from new deposits)
TVL CAP AUTO-WITHDRAW (Aave/Benqi only: current_share > 15% → FORCED_REBALANCE)
BEAT MARGIN (new_weighted_apy - current_weighted_apy < 0.1% → SKIP)
DELTA CHECK (total_movement < $1 → SKIP)
PROFITABILITY GATE (daily_gain < gas_cost + psm_fee → SKIP)
EXECUTE (build UserOp, send to Pimlico → fallback Alchemy, update DB)
</pre_rebalance_flow>

<security_requirements>
These are non-negotiable. Flag any trade-off that touches these.

SESSION KEY ENCRYPTION KEY: Must use AWS KMS or Supabase Vault envelope encryption.
NEVER store the master key in Railway environment variables. The encrypted blob
and its IV go in Supabase. The KMS key ID goes in env. The actual key never leaves KMS.
USER EOA IN CALL POLICY: Must be read from kernelAccount.getOwner() — the on-chain
immutable record. Never read from the Supabase accounts table.
Reason: DB compromise → attacker changes stored EOA → session key minted with attacker's
address → funds drained. On-chain owner cannot be spoofed.
TWAP STATE: Must be persisted to the rate_snapshots Supabase table on every cycle.
NEVER use an in-memory ring buffer. Reason: Railway restarts wipe in-memory state.
First rebalance after a restart would use a single-point rate read — the exact attack
vector TWAP exists to prevent. On startup, load last 3 snapshots from DB.
Add cold-start guard: if < 3 snapshots exist, skip rebalancing.
WITHDRAWAL FINAL TRANSFER: Must use type(uint256).max (sweep all remaining) for the
user's USDC transfer. Never use a hardcoded amount calculated before execution.
Reason: interest accrues between balance-read and on-chain execution, leaving residuals.
ATOMIC WITHDRAWAL: All redemptions + fee transfer + user transfer must be in ONE
UserOperation. If any call fails, the entire UserOperation reverts. No partial state.
DEFILLAMA: Use as soft advisory signal ONLY. Never block rebalancing on DefiLlama
being unreachable. Log a warning. Continue. On-chain data is authoritative.
RPC REDUNDANCY: Three-tier RPC setup.
Primary: Infura Avalanche.
Fallback: Alchemy Avalanche (auto-switch on 3 consecutive failures).
Emergency: Public Avalanche RPC.
Implement with exponential backoff and provider rotation.
BUNDLER REDUNDANCY: Pimlico primary, Alchemy AA API fallback.
On Pimlico failure (timeout or rejection), retry once with Alchemy.
Alert ops if both fail.
PAYMASTER MONITORING: Check ZeroDev paymaster balance before every scheduler run.
Alert ops via Telegram if < 10 AVAX remaining. Do not block rebalancing on this check.
SUPABASE RLS:

session_keys: USING (false) — frontend CANNOT read session keys under any circumstance
accounts: users read only their own row
allocations: users read only their own rows
All writes: service role only (backend), never from frontend
</security_requirements>



<file_structure>
Build every file below. Group them by directory.
SMART CONTRACTS (Foundry project):
contracts/
├── src/
│   └── SnowMindRegistry.sol          # Production registry with two-step ownership
├── test/
│   └── SnowMindRegistry.t.sol        # Comprehensive Foundry tests
├── script/
│   └── DeployMainnet.s.sol           # Deployment script with verification
└── foundry.toml                      # Foundry config for Avalanche
BACKEND (Python FastAPI):
apps/backend/
├── app/
│   ├── main.py                       # FastAPI app init, lifespan, routers
│   ├── core/
│   │   ├── config.py                 # All addresses, thresholds, env vars
│   │   ├── database.py               # Supabase client setup
│   │   └── rpc.py                    # Multi-provider RPC with fallback
│   ├── services/
│   │   ├── scheduler.py              # 30-min scheduler with distributed lock
│   │   ├── protocols/
│   │   │   ├── base.py               # Abstract protocol interface
│   │   │   ├── aave.py               # Aave V3 adapter (APY, balance, health)
│   │   │   ├── benqi.py              # Benqi adapter (APY, balance, health)
│   │   │   └── spark.py              # Spark adapter (effective APY, health, tin)
│   │   ├── optimizer/
│   │   │   ├── rate_fetcher.py       # Parallel APY reads + TWAP from DB
│   │   │   ├── health_checker.py     # All 9 health checks per protocol
│   │   │   ├── allocator.py          # APY-ranked allocation with user prefs
│   │   │   └── rebalancer.py         # Full 19-step pipeline
│   │   ├── execution/
│   │   │   ├── session_key.py        # KMS encrypt/decrypt + Supabase storage
│   │   │   └── userop_builder.py     # Withdrawal UserOp construction
│   │   └── fee_calculator.py         # Proportional agent fee + fee-exempt logic
│   └── api/
│       └── routes/
│           ├── accounts.py           # Account registration, preferences
│           ├── rebalance.py          # Manual trigger, status, logs
│           └── withdrawal.py         # Build withdrawal UserOp for frontend
├── requirements.txt
└── Dockerfile
EXECUTION SERVICE (Node.js):
apps/execution/
├── src/
│   ├── index.ts                      # Express server
│   ├── execute.ts                    # Deserialize session key → build → sign → submit
│   ├── bundler.ts                    # Pimlico + Alchemy fallback
│   └── types.ts                      # Shared TypeScript types
├── package.json
└── tsconfig.json
FRONTEND (Next.js 15):
apps/web/
├── lib/
│   ├── constants.ts                  # All contract addresses, chain config
│   ├── zerodev.ts                    # Smart account creation + session key granting
│   ├── privy.ts                      # Privy client config
│   └── api.ts                        # Backend API client with JWT auth
├── app/
│   ├── layout.tsx                    # Root layout with providers
│   ├── page.tsx                      # Landing page
│   └── (app)/
│       ├── onboarding/
│       │   └── page.tsx              # Deposit flow + allocation preferences
│       ├── dashboard/
│       │   └── page.tsx              # Yield display, allocations, rebalance history
│       └── withdraw/
│           └── page.tsx              # Withdrawal flow (partial + full)
├── components/
│   ├── AllocationSliders.tsx         # Per-protocol cap sliders + presets
│   ├── YieldProjection.tsx           # Live APY projection while adjusting sliders
│   ├── ProtocolCard.tsx              # Individual protocol health + allocation display
│   └── EmergencyWithdraw.tsx         # One-click emergency exit
└── package.json
</file_structure>

Build Phase 1 and Phase 2 now. Output every file completely. Do not truncate.