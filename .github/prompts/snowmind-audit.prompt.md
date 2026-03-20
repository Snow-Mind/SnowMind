# SnowMind — Full Codebase Audit & Production Readiness Verification
# Paste this into Copilot Agent mode or Antigravity as a workflow
# Run AFTER all 5 phases are complete

<role>
You are a senior security engineer and DeFi protocol auditor performing a
production readiness review of SnowMind — a non-custodial autonomous yield
optimization agent managing real user USDC on Avalanche C-Chain mainnet.

This is not a code style review. This is a pre-launch audit. Users will deposit
real money. Every finding must be treated with that weight.
</role>

<audit_scope>
Audit every file in the following directories completely:
- contracts/src/
- contracts/test/
- apps/backend/
- apps/execution/
- apps/web/

Do not skip any file. Do not assume a file is correct because it was
recently generated. Read each file's actual content before evaluating it.
</audit_scope>

<task>
Perform a complete end-to-end production readiness audit across 8 dimensions
defined below. For each dimension, read the relevant files, then produce a
structured report with:

  STATUS: PASS | FAIL | WARNING
  FINDINGS: numbered list of specific issues with file name and line reference
  FIXES: exact code changes required for every FAIL and WARNING

After all 8 dimensions are reported, produce a LAUNCH DECISION:
  READY / NOT READY — with a numbered list of blockers if NOT READY.

Then fix every FAIL automatically. Do not ask for permission to fix FAILs.
For WARNINGs, list them and ask before fixing.
</task>

<dimension_1_title>Security: Session Key and Encryption</dimension_1_title>
<dimension_1>
Check every file that touches session keys. Verify:

1. userEOA source in call policy
   PASS: kernelAccount.getOwner() — reads from on-chain smart account owner
   FAIL: any read from Supabase accounts table, database, or env variable
   File to check: apps/execution/src/execute.ts and apps/web/lib/zerodev.ts

2. AES-256-GCM encryption key source
   PASS: AWS KMS client.decrypt() — key material never in memory at rest
   FAIL: key stored in env variable, hardcoded, or derived locally
   FAIL: boto3 kms_client missing or mocked
   File to check: apps/backend/app/services/execution/session_key.py

3. Session key never logged
   PASS: no logging statement that could print the decrypted session key blob
   FAIL: any logger.info/debug/print that includes the session key plaintext
   Files to check: all files in apps/backend/app/services/execution/

4. Supabase RLS policies
   PASS: session_keys table has USING (false) policy blocking frontend reads
   PASS: accounts table restricts reads to own row by wallet address
   FAIL: any policy missing, permissive, or using service role in frontend
   File to check: any migration files, supabase/migrations/, or schema setup

5. Session key TTL
   PASS: expires_at set to now() + 7 days at creation
   FAIL: 30 days, no expiry, or configurable without a maximum cap

6. Session key renewal guard
   PASS: backend refuses rebalance execution if key expires in < 24 hours
   FAIL: no expiry check before decryption and use
</dimension_1>

<dimension_2_title>Security: Smart Contract</dimension_2_title>
<dimension_2>
Read contracts/src/SnowMindRegistry.sol completely. Verify:

1. logRebalance takes smartAccount as explicit parameter
   PASS: function signature is logRebalance(address smartAccount, address from, address to, uint256 amount)
   FAIL: uses msg.sender as the smartAccount — this logs the owner address, not the user's account

2. Two-step ownership transfer
   PASS: proposeOwnership() + acceptOwnership() pattern exists
   FAIL: single transferOwnership() that takes effect immediately

3. activeAccountCount tracks live registrations
   PASS: incremented in register(), decremented in deregister()
   FAIL: uses registeredAccounts.length for live count (includes deregistered)

4. logRebalance validates registration
   PASS: require(accounts[smartAccount].isRegistered)
   FAIL: no check — allows logging for unregistered accounts

5. Zero-address guards
   PASS: register() has require(account != address(0))
   FAIL: missing zero-address check on register

6. Foundry tests exist and cover
   PASS: test file exists at contracts/test/SnowMindRegistry.t.sol
   Verify tests cover: register, deregister, logRebalance, ownership transfer,
   unauthorized access, zero address, same-protocol revert, zero-amount revert
   FAIL: test file missing or < 8 test functions
</dimension_2>

<dimension_3_title>Financial Correctness: Fee Calculation</dimension_3_title>
<dimension_3>
Read apps/backend/app/services/fee_calculator.py completely. Verify:

1. No floating point in fee math
   PASS: all calculations use Python Decimal, not float
   FAIL: any float(), division producing float, or arithmetic on raw integers
         without Decimal wrapping

2. Proportional fee on every withdrawal
   PASS: formula is:
     proportion = withdraw_amount / current_balance
     accrued_profit = max(0, current_balance - net_principal)
     attributable_profit = accrued_profit * proportion
     agent_fee = attributable_profit * Decimal("0.10")
     user_receives = withdraw_amount - agent_fee
   FAIL: fee only calculated at full withdrawal / account deactivation
   FAIL: simple profit = current - deposited without proportional attribution

3. Loss protection
   PASS: max(Decimal("0"), ...) wrapping on accrued_profit
   FAIL: fee can be non-zero when current_balance < net_principal

4. Fee-exempt accounts
   PASS: if account.fee_exempt is True: agent_fee = Decimal("0")
   FAIL: fee_exempt flag not read or not applied before calculation

5. net_principal update after withdrawal
   PASS: net_principal -= (withdraw_amount - agent_fee) after every withdrawal
   FAIL: only cumulative_deposited tracked, no net reduction after partial exits

6. Terminology in code
   PASS: variable names and comments use "agent_fee" consistently
   FAIL: any use of "performance_fee", "perf_fee", or "performance fee" in strings,
         comments, variable names, or API responses
</dimension_3>

<dimension_4_title>Financial Correctness: Withdrawal UserOp</dimension_4_title>
<dimension_4>
Read apps/execution/src/execute.ts and apps/backend/app/services/execution/userop_builder.py. Verify:

1. Final user transfer uses sweep (MaxUint256), not hardcoded amount
   PASS: last USDC.transfer call uses type(uint256).max or MaxUint256
   FAIL: hardcoded amount calculated from balance read before execution
   Reason: interest accrues between read and execution — hardcoded amount
   leaves residual USDC stranded in smart account forever

2. Correct call order in withdrawal UserOp
   PASS order: withdraw_from_protocols → fee_transfer → user_sweep
   FAIL: user transfer before fee transfer (fee may fail if insufficient balance)
   FAIL: deposit operations mixed with withdrawal operations in same UserOp

3. Benqi redeems by shares, not by amount
   PASS: qiUSDCn.redeem(qiTokenBalance) — redeems share count
   FAIL: qiUSDCn.redeemUnderlying(usdcAmount) — amount-based, imprecise

4. Aave withdrawal uses MAX
   PASS: aavePool.withdraw(USDC, type(uint256).max, smartAccount)
   FAIL: hardcoded USDC amount — misses accrued interest

5. Atomic batch — all calls in ONE UserOperation
   PASS: all redemptions and transfers in single sendUserOperation call
   FAIL: multiple separate UserOperations for a single withdrawal flow

6. Fee transfer omitted for fee-exempt accounts
   PASS: fee_transfer call not included in UserOp when fee_exempt = true
   FAIL: zero-amount fee transfer included (wastes gas, may revert)
</dimension_4>

<dimension_5_title>Protocol Adapter Correctness</dimension_5_title>
<dimension_5>
Read apps/backend/app/services/protocols/aave.py, benqi.py, and spark.py. Verify:

AAVE:
1. APY conversion uses RAY (1e27) not WAD (1e18)
   PASS: RAY = Decimal("1e27"), rate / RAY before annualizing
   FAIL: divides by 1e18 — produces APY 1 billion times too high

2. Utilization reads available cash from aToken contract
   PASS: usdc.balanceOf(aToken_address) for cash
   FAIL: reads from pool contract directly or uses wrong denominator

3. Reserve pause flags read from configuration bitmap
   PASS: checks is_active, is_frozen, is_paused from getReserveData()
   FAIL: no admin pause detection — misses governance emergency pauses

BENQI:
4. Balance reads use exchangeRateStored(), not exchangeRateCurrent()
   PASS: exchangeRateStored() in all balance calculation paths
   FAIL: exchangeRateCurrent() used anywhere in read paths
   Reason: exchangeRateCurrent() is state-modifying — calling it via eth_call
   works but produces different results than at execution time

5. Comptroller pause flags checked
   PASS: mintGuardianPaused() AND redeemGuardianPaused() both checked
   FAIL: either flag missing
   Critical: redeemGuardianPaused = true means funds are locked

6. Utilization formula is correct for Compound V2
   PASS: totalBorrows / (getCash + totalBorrows - totalReserves)
   FAIL: simpler formula missing the totalReserves deduction

SPARK:
7. APY derived from on-chain convertToAssets delta, not external feed
   PASS: (today_value - yesterday_snapshot) / yesterday_snapshot * 365
   FAIL: reads from pot.dsr() cross-chain or hardcodes a rate

8. 0.90 deployment ratio applied
   PASS: gross_apy * Decimal("0.90")
   FAIL: uses raw gross APY — overstates Spark's competitiveness by ~10%

9. PSM tin value read and handled
   PASS: reads psmWrapper.tin() and handles three states:
         tin == 0: no fee
         tin > 0: annualize and deduct from effective APY
         tin == MAX_UINT256: DEPOSITS_DISABLED, exclude from allocation
   FAIL: tin not read, or only zero case handled

10. Spark has NO utilization check, NO velocity check, NO sanity bound
    PASS: these checks are explicitly skipped for Spark
    FAIL: Spark put through the same health check pipeline as Aave/Benqi
    Reason: Spark has no borrow side on Avalanche — these checks produce
    meaningless output and may incorrectly exclude Spark

11. vat.live() emergency check exists
    PASS: vat.live() == 1 verified before allocating to Spark
    FAIL: MakerDAO global settlement not detected
</dimension_5>

<dimension_6_title>Rebalancer Pipeline: All 19 Steps</dimension_6_title>
<dimension_6>
Read apps/backend/app/services/optimizer/rebalancer.py completely.
Verify all 19 pre-rebalance steps are implemented IN ORDER:

Step 1:  Distributed lock — SELECT FOR UPDATE SKIP LOCKED on scheduler_locks
Step 2:  Active accounts filter — is_active=true AND session_key_expires > now()+24h
Step 3:  Time gate — last_rebalance < 6h → SKIP (bypassed by FORCED/EMERGENCY flags)
Step 4:  On-chain balances — parallel reads; total < $10 → SKIP
Step 5:  Aave health check — reserve flags + utilization
Step 6:  Benqi health check — comptroller flags + utilization
Step 7:  Spark health check — tin + vat.live
Step 8:  APY fetch — parallel, only non-excluded protocols
Step 9:  TWAP — loads from DB (not memory); cold-start guard if < 3 snapshots
Step 10: Velocity check — Aave/Benqi only, >25% → exclude
Step 11: Exploit detection — Aave/Benqi only, apy>2x AND util>90% → EMERGENCY_EXIT
Step 12: Sanity bound — Aave/Benqi only, >25% APY → exclude
Step 13: Circuit breaker — all protocols, consecutive_failures >= 3 → exclude
Step 14: 7-day stability — Aave/Benqi only, relative_swing > 50% → skip deposits
Step 15: TVL cap check — Aave/Benqi only, share > 15% → FORCED_REBALANCE
Step 16: Beat margin — new_weighted_apy - current < 0.1% → SKIP
Step 17: Delta check — total_movement < $1 → SKIP
Step 18: Profitability gate — daily_gain < gas_cost + psm_fee → SKIP
Step 19: Execute — build UserOp, Pimlico → Alchemy fallback, update DB

FAIL if any step is missing, out of order, or its bypass conditions are wrong.
FAIL if FORCED_REBALANCE and EMERGENCY_EXIT do not correctly bypass steps 3, 16, 17, 18.

Also verify allocation algorithm:
- Protocols sorted by effective TWAP APY descending
- Aave/Benqi: min(remaining, 0.15 × protocol_tvl, user_max_cap)
- Spark: min(remaining, user_max_cap) — NO system TVL cap
- Idle USDC held and ops alerted if remaining > 0 after all protocols
</dimension_6>

<dimension_7_title>Infrastructure and Reliability</dimension_7_title>
<dimension_7>
Read apps/backend/app/core/rpc.py, apps/execution/src/bundler.ts,
and any monitoring/alerting configuration. Verify:

1. Three-tier RPC with fallback
   PASS: Primary (Infura) → Fallback (Alchemy) → Emergency (public RPC)
         with exponential backoff and automatic provider rotation on failure
   FAIL: single RPC endpoint with no fallback

2. Bundler redundancy
   PASS: Pimlico primary → Alchemy AA API fallback on timeout or rejection
   FAIL: single bundler, no fallback path

3. TWAP state is persisted, not in-memory
   PASS: rate_snapshots written to Supabase on every scheduler cycle
         on startup, loads last 3 snapshots from DB before accepting rebalances
   FAIL: in-memory ring buffer, dict, or list — wiped on Railway restart

4. DefiLlama is soft signal only
   PASS: DefiLlama timeout/error → log warning, continue rebalancing
   FAIL: rebalancing blocked or halted when DefiLlama is unreachable

5. Paymaster balance monitoring
   PASS: paymaster balance checked before scheduler run
         alert sent (Telegram or Sentry) if < 10 AVAX
   FAIL: no paymaster monitoring — silent failure mode

6. Scheduler health monitoring
   PASS: external alert if no scheduler run in > 35 minutes
   FAIL: no watchdog — scheduler can silently stop

7. Distributed lock prevents parallel runs
   PASS: SELECT FOR UPDATE SKIP LOCKED — not a simple INSERT check
   FAIL: TOCTOU-vulnerable check-then-insert pattern

8. Railway deployment config
   PASS: apps/backend and apps/execution have separate Dockerfile or
         railway.toml / railway.json configs defining their own build+start commands
   FAIL: single deployment config for both services

9. Environment variables documented
   PASS: .env.example file exists listing every required env var with description
         No actual secret values in any committed file
   FAIL: env vars undocumented, or real secrets in .env committed to repo
</dimension_7>

<dimension_8_title>Frontend Completeness and UX Correctness</dimension_8_title>
<dimension_8>
Read all files in apps/web/. Verify:

1. Deposit flow branches correctly on $10,000 threshold
   PASS: amount < 10000 → skip AllocationSliders, go directly to confirm
         amount >= 10000 → show AllocationSliders with preset selector
   FAIL: all users see allocation sliders, or no users do

2. AllocationSliders component
   PASS: three protocols (Aave, Benqi, Spark), per-protocol max_pct slider
         risk presets: Conservative (70/20/∞), Balanced (50/40/∞), Aggressive (40/40/∞)
         protocol enable/disable toggle per protocol
   FAIL: missing any protocol, missing presets, or missing toggle

3. YieldProjection shows opportunity cost
   PASS: "Your allocation: X.XX% APY — Optimal: Y.YY% APY — You're leaving $Z/yr on the table"
         updates live as sliders change
   FAIL: no projection, or projection does not show cost of constraint

4. Agent fee language
   PASS: "Agent fee" used consistently in all UI text, tooltips, confirmation screens
   FAIL: any instance of "performance fee", "Performance Fee", or "perf fee" in UI text

5. Beta users see fee-free messaging
   PASS: if account.fee_exempt → show "Fee: Free (beta)" in fee display
         agent_fee line shows $0.00 in withdrawal confirmation
   FAIL: beta users see the same 10% fee display as paying users

6. Emergency withdrawal accessible from every page
   PASS: EmergencyWithdraw component or button present in global layout or navbar
   FAIL: only accessible from the withdraw page

7. Session key renewal prompt
   PASS: when session_key_expires_at < now() + 48h, frontend shows renewal prompt
   FAIL: expiry not surfaced until session key is already expired

8. Manual exit fallback
   PASS: if backend is unreachable, UI surfaces a "manual withdrawal" path
         with instructions to use Snowtrace and the raw calldata
   FAIL: no fallback — users are stuck if backend is down

9. No "performance fee" anywhere in codebase
   Search ALL files (frontend, backend, contracts, docs) for the strings:
   "performance fee", "performance_fee", "perf_fee", "performanceFee"
   FAIL: any match found anywhere in the codebase
</dimension_8>

<final_checks>
After all 8 dimensions, perform these cross-cutting checks:

CONTRACT ADDRESSES — verify these exact values appear in constants.ts and config.py:
  USDC:         0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
  AAVE_POOL:    0x794a61358D6845594F94dc1DB02A252b5b4814aD
  BENQI_QIUSDC: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
  SPARK_SPUSDC: 0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
  ENTRY_POINT:  0x0000000071727De22E5E9d8BAf0edAc6f37da032
  CHAIN_ID:     43114
  FAIL: any address differs from above, or addresses hardcoded inline outside constants

DEAD CODE — search for and flag:
  - Any TODO, FIXME, HACK, or placeholder comment
  - Any "raise NotImplementedError" or "pass" in non-abstract classes
  - Any "mock", "stub", or "fake" outside test files
  - Any console.log() in production TypeScript code (use a logger)
  - Any print() for debugging in production Python code (use logger)

DEPENDENCY AUDIT:
  PASS: requirements.txt and package.json pin exact versions (no ^ or ~)
  FAIL: floating versions — unpinned dependencies are a supply chain risk

TEST COVERAGE:
  PASS: contracts/test/ has tests for every public function in SnowMindRegistry
  PASS: at least one test file exists for fee_calculator.py
  PASS: at least one test file exists for allocator.py
  FAIL: any of the above missing
</final_checks>

<output_format>
Structure your report exactly like this:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIMENSION 1: Security — Session Key and Encryption
STATUS: [PASS / FAIL / WARNING]
FINDINGS:
  1. [file:line] description
  2. [file:line] description
FIXES APPLIED: (list what you changed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[repeat for all 8 dimensions]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CROSS-CUTTING CHECKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAUNCH DECISION: READY / NOT READY
BLOCKERS (if NOT READY):
  1. [severity: CRITICAL/HIGH/MEDIUM] description
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
</output_format>