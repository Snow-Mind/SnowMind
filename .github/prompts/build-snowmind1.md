---
description: Phase 3-4: Optimizer Engine + API + Execution Service
---

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

<examples>
<example id="aave-apy-conversion">
# CORRECT: RAY (1e27) to APY conversion for Aave V3
from decimal import Decimal
RAY = Decimal("1e27")
SECONDS_PER_YEAR = Decimal("31536000")
def ray_to_apy(current_liquidity_rate: int) -> Decimal:
"""Convert Aave V3 currentLiquidityRate (RAY) to annual percentage."""
deposit_apr = Decimal(current_liquidity_rate) / RAY
# Aave uses per-second compounding
apy = (1 + deposit_apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1
return apy
</example>
<example id="benqi-utilization">
# CORRECT: Benqi utilization with STORED rate (not current)
async def get_benqi_state(w3, qi_usdc_contract):
    cash = await qi_usdc_contract.functions.getCash().call()
    total_borrows = await qi_usdc_contract.functions.totalBorrows().call()
    total_reserves = await qi_usdc_contract.functions.totalReserves().call()
    exchange_rate = await qi_usdc_contract.functions.exchangeRateStored().call()  # NOT Current
total_supply_underlying = cash + total_borrows - total_reserves
utilization = Decimal(total_borrows) / Decimal(total_supply_underlying) if total_supply_underlying > 0 else Decimal("0")
return {"utilization": utilization, "cash": cash, "exchange_rate": exchange_rate}
</example>
<example id="spark-effective-apy">
# CORRECT: Spark effective APY calculation
async def get_spark_effective_apy(
    vault_contract,
    psm_wrapper_contract,
    yesterday_snapshot: Decimal,  # convertToAssets value from 24h ago
    expected_hold_days: int = 30
) -> tuple[Decimal, str]:
    """Returns (effective_apy, status)."""
    # Read deposit fee
    tin = await psm_wrapper_contract.functions.tin().call()
    MAX_UINT256 = 2**256 - 1
if tin == MAX_UINT256:
    return Decimal("0"), "DEPOSITS_DISABLED"

# Read current share value
today_value = Decimal(await vault_contract.functions.convertToAssets(1_000_000).call())
# 1 USDC (6 decimals) worth of shares → current USDC value

# Derive daily rate from 24h delta
daily_rate = (today_value - yesterday_snapshot) / yesterday_snapshot
gross_apy = daily_rate * 365

# Apply 90% deployment ratio (Spark V2: 10% held as instant redemption buffer)
deployed_apy = gross_apy * Decimal("0.90")

# Annualize the one-time PSM entry fee over expected hold period
fee_rate = Decimal(tin) / Decimal("1e18")
annualized_psm_cost = fee_rate * (Decimal("365") / Decimal(expected_hold_days))

effective_apy = deployed_apy - annualized_psm_cost
return effective_apy, "HEALTHY"
</example>
<example id="proportional-fee">
# CORRECT: Proportional agent fee calculation
from decimal import Decimal
def calculate_agent_fee(
withdraw_amount: Decimal,
current_balance: Decimal,
net_principal: Decimal,
fee_exempt: bool,
fee_rate: Decimal = Decimal("0.10")
) -> tuple[Decimal, Decimal]:
"""
Returns (agent_fee, user_receives).
Never charges fee on a loss. Never charges fee on fee-exempt accounts.
"""
if fee_exempt or current_balance == 0:
return Decimal("0"), withdraw_amount
proportion = withdraw_amount / current_balance
accrued_profit = max(Decimal("0"), current_balance - net_principal)
attributable_profit = accrued_profit * proportion
agent_fee = (attributable_profit * fee_rate).quantize(Decimal("0.000001"))
user_receives = withdraw_amount - agent_fee

return agent_fee, user_receives
</example>
<example id="session-key-policy">
// CORRECT: Session key call policy in ZeroDev (TypeScript)
// userEOA MUST come from on-chain, never from database
import { toKernelPermissionAccount } from "@zerodev/permissions";
import { toCallPolicy } from "@zerodev/permissions/policies";
async function buildSessionKeyPolicy(
kernelAccount: KernelSmartAccountClient,
treasuryAddress: Address
) {
// CRITICAL: Read from chain, not from database
const userEOA = await kernelAccount.getOwner(); // on-chain, immutable
const callPolicy = toCallPolicy({
permissions: [
// Aave V3
{ target: AAVE_POOL, abi: aavePoolAbi, functionName: "supply" },
{ target: AAVE_POOL, abi: aavePoolAbi, functionName: "withdraw" },
// Benqi
{ target: BENQI_QIUSDC, abi: benqiAbi, functionName: "mint" },
{ target: BENQI_QIUSDC, abi: benqiAbi, functionName: "redeem" },
// Spark
{ target: SPARK_SPUSDC, abi: erc4626Abi, functionName: "deposit" },
{ target: SPARK_SPUSDC, abi: erc4626Abi, functionName: "redeem" },
// USDC approvals (protocol contracts only)
{ target: USDC, abi: erc20Abi, functionName: "approve",
args: [{ condition: "oneOf", value: [AAVE_POOL, BENQI_QIUSDC, SPARK_SPUSDC] }] },
// USDC transfer to treasury (capped)
{ target: USDC, abi: erc20Abi, functionName: "transfer",
args: [
{ condition: "equal", value: treasuryAddress },
{ condition: "lessThanOrEqual", value: parseUnits("10000", 6) } // $10K cap
]
},
// USDC transfer to userEOA (full withdrawal)
{ target: USDC, abi: erc20Abi, functionName: "transfer",
args: [{ condition: "equal", value: userEOA }]  // on-chain owner
},
]
});
return callPolicy;
}
</example>
<example id="withdrawal-userop">
// CORRECT: Withdrawal UserOperation construction
// Call 5 sweeps remaining balance — never hardcoded amount
async function buildWithdrawalUserOp(
  smartAccount: Address,
  userEOA: Address,
  treasuryAddress: Address,
  agentFeeAmount: bigint,  // in USDC 6-decimal units
  positions: { aave: bigint; benqi: bigint; spark: bigint }
) {
  const calls = [];
if (positions.aave > 0n) {
calls.push({ to: AAVE_POOL, data: encodeFunctionData({
abi: aavePoolAbi, functionName: "withdraw",
args: [USDC, MaxUint256, smartAccount]  // MAX = withdraw all
})});
}
if (positions.benqi > 0n) {
calls.push({ to: BENQI_QIUSDC, data: encodeFunctionData({
abi: benqiAbi, functionName: "redeem",
args: [positions.benqi]  // redeem by shares, not by amount
})});
}
if (positions.spark > 0n) {
calls.push({ to: SPARK_SPUSDC, data: encodeFunctionData({
abi: erc4626Abi, functionName: "redeem",
args: [positions.spark, smartAccount, smartAccount]
})});
}
// Agent fee transfer (omit entirely if fee_exempt)
if (agentFeeAmount > 0n) {
calls.push({ to: USDC, data: encodeFunctionData({
abi: erc20Abi, functionName: "transfer",
args: [treasuryAddress, agentFeeAmount]
})});
}
// Sweep everything remaining to user — MaxUint256 means "all of it"
calls.push({ to: USDC, data: encodeFunctionData({
abi: erc20Abi, functionName: "transfer",
args: [userEOA, MaxUint256]  // NEVER hardcode the user amount
})});
return calls;  // sent as one batched UserOperation
}
</example>
</examples>
<build_order>
Build in this exact order to ensure dependencies are available when needed:
PHASE 1 — FOUNDATION (build first, everything depends on these)

contracts/src/SnowMindRegistry.sol
contracts/test/SnowMindRegistry.t.sol
contracts/script/DeployMainnet.s.sol
apps/backend/app/core/config.py
apps/backend/app/core/database.py
apps/backend/app/core/rpc.py

PHASE 2 — PROTOCOL ADAPTERS
7. apps/backend/app/services/protocols/base.py
8. apps/backend/app/services/protocols/aave.py
9. apps/backend/app/services/protocols/benqi.py
10. apps/backend/app/services/protocols/spark.py
PHASE 3 — OPTIMIZATION ENGINE
11. apps/backend/app/services/optimizer/rate_fetcher.py
12. apps/backend/app/services/optimizer/health_checker.py
13. apps/backend/app/services/optimizer/allocator.py
14. apps/backend/app/services/fee_calculator.py
15. apps/backend/app/services/execution/session_key.py
16. apps/backend/app/services/execution/userop_builder.py
17. apps/backend/app/services/optimizer/rebalancer.py  (depends on all above)
18. apps/backend/app/services/scheduler.py
PHASE 4 — API AND EXECUTION SERVICE
19. apps/backend/app/api/routes/accounts.py
20. apps/backend/app/api/routes/rebalance.py
21. apps/backend/app/api/routes/withdrawal.py
22. apps/backend/app/main.py
23. apps/execution/src/types.ts
24. apps/execution/src/bundler.ts
25. apps/execution/src/execute.ts
26. apps/execution/src/index.ts
PHASE 5 — FRONTEND
27. apps/web/lib/constants.ts
28. apps/web/lib/zerodev.ts
29. apps/web/lib/privy.ts
30. apps/web/lib/api.ts
31. apps/web/components/ProtocolCard.tsx
32. apps/web/components/AllocationSliders.tsx
33. apps/web/components/YieldProjection.tsx
34. apps/web/components/EmergencyWithdraw.tsx
35. apps/web/app/(app)/onboarding/page.tsx
36. apps/web/app/(app)/dashboard/page.tsx
37. apps/web/app/(app)/withdraw/page.tsx
38. apps/web/app/layout.tsx
39. apps/web/app/page.tsx
</build_order>
<quality_checklist>


Phase 1 and 2 files are already in the workspace. Build Phase 3 and Phase 4 now. Do not rewrite existing files unless fixing a dependency error.
