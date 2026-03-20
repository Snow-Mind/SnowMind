<context>
SnowMind is a live mainnet application on Avalanche C-Chain. The backend is
FastAPI (Python 3.12) on Railway. The execution service is Node.js/TypeScript
on Railway (currently DOWN with 502). The frontend is Next.js 15 on Vercel.

KNOWN ISSUES FOUND IN LIVE AUDIT (fix these first):
1. Execution service returns 502 — it is completely down. No rebalances execute.
2. Frontend landing page says "Benqi, Aave V3, and Euler V2" as primary protocols.
   Architecture has Spark as primary and Euler as opt-in. Landing page is wrong.
3. FastAPI /docs and /openapi.json may be publicly accessible — must be disabled in production.
4. No /api/v1/optimizer/simulate or dry_run endpoint exists for testing without real funds.

Current protocol list (from architecture):
  Default-enabled: Aave V3, Benqi, Spark
  Opt-in only: Euler V2 (9Summits vault), Silo (savUSD, sUSDp)
</context>

<task>
Perform a full hardening pass across the entire codebase.
Work through all 10 sections below in order.
For each section: read the relevant files, identify every issue, fix it,
then move to the next section. Do not skip sections.

Before writing any code, output a numbered plan of every file you will touch.
Wait for my approval before executing. Then execute completely.
</task>

<section_1>
TITLE: Fix the execution service 502 immediately

The execution service at apps/execution/ is returning 502. This is P0 —
no user can rebalance or withdraw while this is down.

Steps:
1. Read apps/execution/src/index.ts — check the port binding, health route,
   and startup sequence
2. Read apps/execution/package.json — check start script and dependencies
3. Check for missing environment variables that would cause a startup crash:
   ZERODEV_PROJECT_ID, PIMLICO_API_KEY, ALCHEMY_API_KEY, EXECUTION_SERVICE_PORT
4. Add a /health endpoint that returns { status: "ok", version: "1.0.0", timestamp: ISO }
5. Add startup validation: on launch, check all required env vars are present.
   If any are missing, log exactly which ones and exit with code 1 (not a silent hang)
6. Add process-level error handlers:
     process.on('uncaughtException', (err) => { logger.error('Uncaught:', err); process.exit(1); })
     process.on('unhandledRejection', (reason) => { logger.error('Unhandled:', reason); process.exit(1); })
7. Add a Railway healthcheck to railway.toml:
     [deploy]
     healthcheckPath = "/health"
     healthcheckTimeout = 30
     restartPolicyType = "ON_FAILURE"
     restartPolicyMaxRetries = 3
</section_1>

<section_2>
TITLE: Disable FastAPI auto-docs in production + API security hardening

FastAPI auto-generates /docs and /openapi.json. These expose your entire
API surface, request shapes, and response schemas to anyone on the internet.
An attacker uses this to enumerate every endpoint and craft targeted attacks.

Steps:
1. In apps/backend/app/main.py, conditionally disable docs:
     app = FastAPI(
         docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
         redoc_url="/redoc" if settings.ENVIRONMENT == "development" else None,
         openapi_url="/openapi.json" if settings.ENVIRONMENT == "development" else None,
     )

2. Add rate limiting to every API endpoint using slowapi or fastapi-limiter:
   - /api/v1/accounts/* → 10 requests/minute per IP
   - /api/v1/rebalance/* → 5 requests/minute per authenticated user
   - /api/v1/withdrawal/* → 5 requests/minute per authenticated user
   - Public endpoints → 30 requests/minute per IP

3. Add request size limits — prevent oversized payload attacks:
     from fastapi import Request
     @app.middleware("http")
     async def limit_request_size(request: Request, call_next):
         if request.headers.get("content-length"):
             if int(request.headers["content-length"]) > 1_048_576:  # 1MB
                 return JSONResponse(status_code=413, content={"error": "Request too large"})
         return await call_next(request)

4. Add security headers middleware:
     X-Content-Type-Options: nosniff
     X-Frame-Options: DENY
     X-XSS-Protection: 1; mode=block
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     Content-Security-Policy: default-src 'none'

5. Verify CORS is restrictive — only allow snowmind.xyz and localhost in dev:
     origins = ["https://www.snowmind.xyz", "https://snowmind.xyz"]
     if settings.ENVIRONMENT == "development":
         origins.append("http://localhost:3000")

6. Add JWT validation middleware — every authenticated endpoint must verify
   the token is signed, not expired, and the wallet address matches the account
   being accessed. Return 401 with no detail on failure (do not leak why).
</section_2>

<section_3>
TITLE: Add dry-run / simulation endpoint for zero-cost testing

Without a dry-run endpoint, the only way to test the optimizer is to deposit
real USDC. This blocks testing, debugging, and investor demos.

Add to apps/backend/app/api/routes/rebalance.py:

POST /api/v1/optimizer/simulate
Request body:
  {
    "amount_usdc": 10000.00,
    "current_allocations": { "aave": 0, "benqi": 0, "spark": 10000 },
    "user_preferences": {
      "aave": { "enabled": true, "max_pct": 0.5 },
      "benqi": { "enabled": true, "max_pct": 0.4 },
      "spark": { "enabled": true, "max_pct": 1.0 }
    }
  }
Response:
  {
    "timestamp": "2026-03-20T10:00:00Z",
    "protocol_apys": {
      "aave": { "twap_apy": 0.042, "effective_apy": 0.042, "status": "healthy" },
      "benqi": { "twap_apy": 0.038, "effective_apy": 0.038, "status": "healthy" },
      "spark": { "twap_apy": 0.031, "effective_apy": 0.027, "status": "healthy" }
    },
    "recommended_allocation": { "aave": 5000, "benqi": 4000, "spark": 1000 },
    "current_weighted_apy": 0.031,
    "new_weighted_apy": 0.040,
    "improvement": 0.009,
    "beat_margin_met": true,
    "gate_results": {
      "time_gate": "pass",
      "beat_margin": "pass",
      "profitability": "pass",
      "aave_health": "pass",
      "benqi_health": "pass",
      "spark_health": "pass"
    },
    "would_rebalance": true,
    "estimated_gas_usd": 0.008,
    "dry_run": true
  }

This endpoint:
- Runs the full 19-step pre-check pipeline with dry_run=True
- Does NOT decrypt any session key
- Does NOT build or submit any UserOperation
- Does NOT write to database
- Does NOT require authentication (so anyone can test the optimizer logic)
- Returns EXACTLY what the live rebalancer would decide and why
- Reads LIVE on-chain APYs from the actual protocols

Also add:
GET /api/v1/protocols/rates
Response: current APYs and health status for all protocols, no auth required.
This lets users and integrators see live rates without depositing.
</section_3>

<section_4>
TITLE: Input validation and edge case hardening

Every API endpoint that accepts user input is an attack surface.
The worst user will try: negative amounts, zero amounts, amounts larger than
their balance, invalid wallet addresses, SQL injection in string fields,
amounts with more than 6 decimal places (USDC precision), and concurrent
requests that create race conditions.

For every API endpoint in apps/backend/app/api/routes/:

1. Add Pydantic validators with explicit bounds:

   from pydantic import BaseModel, field_validator, model_validator
   from decimal import Decimal

   class DepositRequest(BaseModel):
       amount_usdc: Decimal
       wallet_address: str

       @field_validator("amount_usdc")
       def validate_amount(cls, v):
           if v <= 0:
               raise ValueError("Amount must be positive")
           if v > Decimal("1000000"):  # $1M hard cap per deposit
               raise ValueError("Amount exceeds maximum deposit")
           if v.as_tuple().exponent < -6:
               raise ValueError("Amount has more than 6 decimal places")
           return v

       @field_validator("wallet_address")
       def validate_address(cls, v):
           if not v.startswith("0x") or len(v) != 42:
               raise ValueError("Invalid Ethereum address format")
           # additional checksum validation
           from eth_utils import is_checksum_address, to_checksum_address
           return to_checksum_address(v)

   class WithdrawalRequest(BaseModel):
       amount_usdc: Decimal
       account_id: str  # uuid

       @field_validator("amount_usdc")
       def validate_amount(cls, v):
           if v <= Decimal("0"):
               raise ValueError("Amount must be positive")
           return v

       @model_validator(mode="after")
       def amount_within_balance(self):
           # This check happens in the route handler against live balance
           # Pydantic validates type/format, route validates business logic
           return self

2. Fee calculation edge cases — add tests and guards for:
   a. Zero profit: current_balance == net_principal → fee = 0, no division by zero
   b. Dust amounts: withdrawal_amount < 0.000001 USDC → reject (below USDC dust threshold)
   c. Withdrawal > balance: withdrawal_amount > current_balance → reject with clear error
   d. Fee-exempt account: agent_fee must be exactly Decimal("0"), not a very small number
   e. Loss scenario: current_balance < net_principal → profit = 0, fee = 0 (no negative fee)

3. Concurrent withdrawal protection:
   Before building the withdrawal UserOp, acquire a per-account lock in Supabase:
     INSERT INTO withdrawal_locks (account_id, locked_at, expires_at)
     VALUES ($1, now(), now() + interval '5 minutes')
     ON CONFLICT (account_id) DO NOTHING
     RETURNING id;
   If insert returns nothing, another withdrawal is in progress → return 409 Conflict.
   Release lock after UserOp result confirmed (success or failure).
   This prevents two simultaneous withdrawal requests both executing for the same account.

4. Rebalance concurrency: the scheduler already has a global distributed lock.
   Add per-account rebalance lock that prevents a manual rebalance trigger
   conflicting with the scheduler. Same pattern as withdrawal lock.
</section_4>

<section_5>
TITLE: Fee calculation correctness — full test suite

The fee model must be mathematically correct under all user behaviors.
Write a complete test file at apps/backend/tests/test_fee_calculator.py.

Test every scenario:

class TestAgentFee:

    def test_zero_profit_no_fee(self):
        # Deposited $10K, still $10K, no yield earned
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("10000"),
            current_balance=Decimal("10000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee == Decimal("0")
        assert receives == Decimal("10000")

    def test_loss_scenario_no_fee(self):
        # Deposited $10K, now worth $9K (protocol loss scenario)
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("9000"),
            current_balance=Decimal("9000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee == Decimal("0")
        assert receives == Decimal("9000")

    def test_fee_exempt_account_zero_fee(self):
        # Beta user — always zero fee regardless of profit
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("11000"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=True
        )
        assert fee == Decimal("0")
        assert receives == Decimal("11000")

    def test_proportional_partial_withdrawal(self):
        # Deposited $10K, now $11K, withdrawing $5500 (half)
        # Profit = $1000, half of that = $500, fee = $50
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("5500"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee == Decimal("50")
        assert receives == Decimal("5450")

    def test_full_withdrawal_with_profit(self):
        # Deposited $10K, now $10500, full withdrawal
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("10500"),
            current_balance=Decimal("10500"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee == Decimal("50")  # 500 profit × 10%
        assert receives == Decimal("10450")

    def test_partial_withdrawal_exploit_prevention(self):
        # User tries to extract all profit via partial withdrawal to avoid full-exit fee
        # Withdraws $10999.99 from $11000 balance (leaving $0.01)
        # Profit = $1000, proportion = 10999.99/11000 ≈ 0.9999
        # Attributable profit ≈ $999.99, fee ≈ $99.99
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("10999.99"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee > Decimal("90")  # fee must be charged, not zero
        assert receives < Decimal("10999.99")

    def test_net_principal_updates_correctly_after_partial(self):
        # After partial withdrawal, net_principal must decrease by net amount withdrawn
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("3000"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        # net_principal should decrease by (withdraw_amount - fee)
        expected_new_principal = Decimal("10000") - (Decimal("3000") - fee)
        # Verify this is what the caller should store
        assert expected_new_principal > Decimal("7000")  # still tracking original basis

    def test_no_float_in_calculation(self):
        # All intermediate values must be Decimal, not float
        # Pass large values that would lose precision as float
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("999999.999999"),
            current_balance=Decimal("1000000.000000"),
            net_principal=Decimal("900000.000000"),
            fee_exempt=False
        )
        assert isinstance(fee, Decimal)
        assert isinstance(receives, Decimal)
        # Verify no floating point artifacts
        assert fee + receives == Decimal("999999.999999")
</section_5>

<section_6>
TITLE: Execution service hardening — session key and UserOp security

Read apps/execution/src/execute.ts completely. Fix every issue:

1. userEOA MUST come from on-chain — verify and enforce:
   WRONG (spoofable):
     const userEOA = requestBody.userEOA;  // passed from backend DB
   CORRECT (immutable):
     const kernelAccount = await deserializePermissionAccount(rpcClient, entryPoint, serializedKey);
     const userEOA = await kernelAccount.getOwner();  // on-chain, cannot be spoofed

   If userEOA is currently passed in the request body, remove it.
   Read it from the on-chain owner record every single time.

2. Withdrawal UserOp final transfer must use MaxUint256:
   WRONG (leaves residuals from interest accrual between read and execution):
     { to: USDC, data: encodeFunctionData({ functionName: "transfer", args: [userEOA, hardcodedAmount] }) }
   CORRECT (sweeps everything remaining after fee):
     { to: USDC, data: encodeFunctionData({ functionName: "transfer", args: [userEOA, maxUint256] }) }

3. Pimlico → Alchemy fallback — verify it works:
   In apps/execution/src/bundler.ts:
   - Primary: Pimlico bundler endpoint
   - On timeout (> 15 seconds) OR on rejection (non-200, non-retry status):
       logger.warn("Pimlico failed, switching to Alchemy fallback");
       retry with Alchemy AA API endpoint
   - If BOTH fail: throw with structured error { code: "BUNDLER_UNAVAILABLE", message: "..." }
   - Caller (execute.ts) catches this and returns 503 to backend

4. Session key plaintext must NEVER be logged:
   Search execute.ts for any logger.info/debug/warn/error call.
   If any log includes the serialized session key or any fragment of it → remove it.
   Log only: { accountId, action: "rebalance_executed", txHash, timestamp }

5. Add request authentication to execution service:
   The execution service should NOT be a public HTTP endpoint.
   Add a shared secret header: X-Internal-Secret matching env var INTERNAL_SECRET
   Any request without this header → 401 immediately, no further processing.
   This prevents direct external calls to the execution service bypassing the backend.

6. Add per-request timeout: wrap every UserOp submission in a 30-second timeout.
   If Pimlico doesn't respond in 30 seconds, treat as failure and try fallback.
</section_6>

<section_7>
TITLE: Protocol adapter correctness — verify every calculation

Read apps/backend/app/services/protocols/aave.py, benqi.py, spark.py.
Fix every issue found:

AAVE CHECKS:
- APY conversion: must divide by RAY (1e27), not WAD (1e18)
  from decimal import Decimal
  RAY = Decimal("1e27")
  SECONDS_PER_YEAR = Decimal("31536000")
  deposit_apr = Decimal(current_liquidity_rate) / RAY
  apy = (1 + deposit_apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1
- Reserve pause flags: is_active, is_frozen, is_paused must all be checked
- Utilization: cash = usdc.balanceOf(aToken_address), NOT from pool contract

BENQI CHECKS:
- Balance reads: MUST use exchangeRateStored() everywhere — NOT exchangeRateCurrent()
  exchangeRateCurrent() accrues interest on-chain before returning — state-mutating.
  Using it in read paths produces inconsistent results vs execution time.
- Withdrawal: redeem by shares (qiToken balance), NOT redeemUnderlying(usdcAmount)
- Comptroller: check BOTH mintGuardianPaused AND redeemGuardianPaused
  redeemGuardianPaused = True means user funds may be LOCKED — alert ops immediately

SPARK CHECKS:
- APY source: (today_convertToAssets - yesterday_snapshot) / yesterday_snapshot * 365
  NOT pot.dsr() — pot is on Ethereum, you're on Avalanche
- Effective APY: gross_apy * Decimal("0.90") — only 90% of deposit earns yield
- PSM tin: psmWrapper.tin() — handle all three states:
    tin == 0: no fee
    tin > 0: effective_apy -= (Decimal(tin) / Decimal("1e18")) * (Decimal("365") / expected_hold_days)
    tin == 2**256 - 1: deposits DISABLED — exclude from allocation
- MakerDAO global settlement: vat.live() must == 1 before any Spark allocation
- SKIP all these checks for Spark (not applicable — no borrow side on Avalanche):
    utilization check, velocity check, sanity bound (>25% APY), 7-day stability
</section_7>

<section_8>
TITLE: Frontend fixes and UX hardening

Read all files in apps/web/. Fix every issue:

1. Landing page protocol mismatch — CRITICAL:
   Current text: "Benqi, Aave V3, and Euler V2"
   Correct text: "Aave V3, Benqi, and Spark"
   Also add brief description of Spark: "Fixed-rate MakerDAO-backed savings vault"
   Search all .tsx and .ts files for "Euler V2" — replace with correct protocol list
   where it describes default protocols. Euler and Silo appear in the app as opt-in only.

2. Error boundaries — every page needs one:
   Add <ErrorBoundary fallback={<EmergencyWithdrawFallback />}> around every
   page component. If JavaScript crashes, the user should always see:
     "Something went wrong. Your funds are safe. Use the emergency withdrawal button below."
   With a raw Snowtrace link to their smart account and instructions to withdraw directly.

3. Execution service down detection:
   Before showing the dashboard, ping the execution service health endpoint.
   If it returns non-200: show a banner:
     "⚠️ Rebalancing is temporarily paused. Your funds are safe and earning yield
      at their current allocation. We are working to restore service."
   Do NOT hide this from users. They deserve to know the agent isn't running.

4. Agent fee terminology — search entire apps/web/ for these strings and fix:
   "performance fee" → "agent fee"
   "Performance Fee" → "Agent Fee"
   "performanceFee" → "agentFee"
   "perf_fee" → "agent_fee"

5. Beta users see fee-free display:
   In withdrawal confirmation and dashboard:
   If account.fee_exempt == true:
     Show: "Agent Fee: Free (beta)" in green
     Show: $0.00 in the fee line item
   Not the default 10% display.

6. Session key expiry warning:
   If session_key_expires_at is within 48 hours:
     Show yellow banner: "Your agent authorization expires in X hours.
     Click here to renew it and keep your agent running."
   If expired: show red banner and block rebalance display until renewed.

7. Emergency withdrawal — always visible:
   The EmergencyWithdraw button must be accessible from EVERY page via the navbar.
   It should work even if the backend is completely unreachable by generating
   the withdrawal calldata client-side using the user's EOA directly.

8. Add loading states for every async operation:
   Deposit, withdraw, session key grant — all must show a progress indicator
   with the current step: "Approving USDC... Depositing... Granting session key..."
   Never show a spinning loader with no context. Users with real money are anxious.

9. Add transaction confirmation display:
   After every on-chain action, show:
     Transaction submitted: [txHash truncated]
     View on Snowtrace: [link]
     Status: Pending... → Confirmed ✓
   This is essential for trust. Users need to see their transaction is real.
</section_8>

<section_9>
TITLE: Monitoring, alerting, and observability

The execution service going down silently (current 502) is exactly the scenario
monitoring should catch before users notice. Add these immediately:

1. Sentry integration — both backend and execution service:
   Backend (Python):
     import sentry_sdk
     sentry_sdk.init(dsn=settings.SENTRY_DSN, environment=settings.ENVIRONMENT,
                     traces_sample_rate=0.1)
   Execution service (TypeScript):
     import * as Sentry from "@sentry/node";
     Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.ENVIRONMENT });

2. Telegram alert bot — for P0 events that need immediate attention:
   Add apps/backend/app/core/alerts.py:

   async def send_alert(level: str, message: str, details: dict = None):
       """Send Telegram alert for critical events."""
       if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
           logger.warning("Telegram alerts not configured")
           return
       text = f"[SnowMind {level.upper()}]\n{message}"
       if details:
           text += "\n" + json.dumps(details, indent=2)
       async with httpx.AsyncClient() as client:
           await client.post(
               f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
               json={"chat_id": settings.TELEGRAM_CHAT_ID, "text": text, "parse_mode": "Markdown"}
           )

   Trigger CRITICAL alerts for:
   - Execution service unreachable (check every scheduler cycle)
   - Paymaster balance < 10 AVAX
   - EXPLOIT_SUSPECTED on any protocol with user funds in it
   - Any user withdrawal fails after retry
   - Scheduler hasn't run in > 35 minutes (dead man's switch)
   - Any account with redeemGuardianPaused = True for Benqi

3. Scheduler dead man's switch:
   In scheduler.py, after each successful run write:
     await db.table("scheduler_health").upsert({"id": "global", "last_run": now()})
   Add a separate lightweight process (cron every 5 min) that checks:
     SELECT last_run FROM scheduler_health WHERE id = 'global'
   If last_run > 35 minutes ago: send CRITICAL Telegram alert + Sentry error

4. Paymaster balance check:
   Before each scheduler cycle:
     balance = await zerodev_client.getPaymasterBalance()
     if balance < parse_ether("10"):
         await send_alert("WARNING", f"Paymaster balance low: {balance} AVAX")
   This is async — never block the scheduler on this check.

5. Add /api/v1/health endpoint that returns actual system health:
   GET /api/v1/health (no auth required)
   {
     "backend": "ok",
     "database": "ok" | "degraded" | "down",
     "execution_service": "ok" | "down",
     "scheduler_last_run": "2026-03-20T10:00:00Z",
     "scheduler_healthy": true,
     "paymaster_avax": 45.2,
     "platform_tvl_usdc": 48250.00,
     "platform_cap_usdc": 50000.00,
     "protocols": {
       "aave": { "status": "healthy", "apy": 0.042 },
       "benqi": { "status": "healthy", "apy": 0.038 },
       "spark": { "status": "healthy", "apy": 0.027 }
     }
   }
</section_9>

<section_10>
TITLE: End-to-end testing without spending real money

Create apps/backend/tests/test_integration.py with a full test suite
that uses anvil (Foundry) to fork Avalanche mainnet locally.

The tests should cover every user action without any real transactions.

Setup (add to conftest.py):

import pytest
import subprocess
import time

@pytest.fixture(scope="session")
def anvil_fork():
    """Start a local Avalanche fork for testing."""
    proc = subprocess.Popen([
        "anvil",
        "--fork-url", "https://api.avax.network/ext/bc/C/rpc",
        "--chain-id", "43114",
        "--port", "8546",
        "--silent"
    ])
    time.sleep(3)  # wait for anvil to start
    yield "http://localhost:8546"
    proc.terminate()

Test cases to implement:

class TestOptimizer:

    async def test_fetch_live_rates_from_fork(self, anvil_fork):
        """Rate fetcher returns real APYs from the forked chain."""
        rates = await fetch_protocol_rates(rpc_url=anvil_fork)
        assert "aave" in rates
        assert "benqi" in rates
        assert "spark" in rates
        assert 0 < rates["aave"]["twap_apy"] < 0.30
        assert 0 < rates["benqi"]["twap_apy"] < 0.30

    async def test_simulate_endpoint_returns_allocation(self, client, anvil_fork):
        """Simulate endpoint returns a valid allocation without touching any funds."""
        response = client.post("/api/v1/optimizer/simulate", json={
            "amount_usdc": 10000,
            "current_allocations": {"aave": 0, "benqi": 0, "spark": 0},
        })
        assert response.status_code == 200
        data = response.json()
        assert data["dry_run"] == True
        total = sum(data["recommended_allocation"].values())
        assert abs(total - 10000) < 1  # rounding tolerance

    async def test_all_19_preflight_checks_execute(self, anvil_fork):
        """All 19 pre-rebalance steps run without error on a healthy fork."""
        result = await run_rebalance_pipeline(
            account_id="test-account",
            dry_run=True,
            rpc_url=anvil_fork
        )
        assert result["gate_results"]["time_gate"] in ["pass", "skip"]
        assert result["gate_results"]["aave_health"] in ["pass", "excluded"]
        assert result["gate_results"]["spark_health"] in ["pass", "excluded"]

    async def test_exploit_detection_triggers_emergency_exit(self, anvil_fork, monkeypatch):
        """When APY doubles AND utilization > 90%, emergency exit is flagged."""
        # Mock Benqi to return: apy = 2× yesterday AND utilization = 95%
        monkeypatch.setattr("benqi_adapter.get_utilization", lambda: Decimal("0.95"))
        monkeypatch.setattr("benqi_adapter.get_twap_apy", lambda: Decimal("0.08"))  # 2× normal
        monkeypatch.setattr("db.get_yesterday_apy", lambda p: Decimal("0.04"))
        result = await run_health_check("benqi")
        assert result["status"] == "EXPLOIT_SUSPECTED"
        assert result["action"] == "EMERGENCY_EXIT"

    async def test_spark_skips_utilization_check(self, anvil_fork):
        """Spark adapter never runs utilization or velocity checks."""
        health = await spark_adapter.check_health(rpc_url=anvil_fork)
        assert "utilization" not in health
        assert "velocity_check" not in health

    async def test_fee_not_charged_on_zero_profit(self):
        """Withdrawal with no yield earned → fee = 0."""
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("10000"),
            current_balance=Decimal("10000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee == Decimal("0")

    async def test_fee_exempt_beta_user(self):
        """Beta user with fee_exempt=True always gets fee=0."""
        fee, receives = calculate_agent_fee(
            withdraw_amount=Decimal("11000"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=True
        )
        assert fee == Decimal("0")
        assert receives == Decimal("11000")

    async def test_partial_withdrawal_exploit_blocked(self):
        """Large partial withdrawal correctly charges proportional fee."""
        fee, _ = calculate_agent_fee(
            withdraw_amount=Decimal("10999"),
            current_balance=Decimal("11000"),
            net_principal=Decimal("10000"),
            fee_exempt=False
        )
        assert fee > Decimal("90")  # must charge ~$99 fee on ~$999 profit

    async def test_concurrent_withdrawal_rejected(self, client, db):
        """Second simultaneous withdrawal request returns 409."""
        # Manually insert a withdrawal lock
        await db.table("withdrawal_locks").insert({
            "account_id": "test-account-uuid",
            "locked_at": "now()",
            "expires_at": "now() + interval '5 minutes'"
        })
        response = client.post("/api/v1/withdrawal/initiate", json={
            "account_id": "test-account-uuid",
            "amount_usdc": 5000
        })
        assert response.status_code == 409
        assert "in progress" in response.json()["error"].lower()
</section_10>

<final_checklist>
After all 10 sections are complete, run this verification:

GREP CHECKS (search entire codebase):
□ grep -r "performance fee" --include="*.ts" --include="*.tsx" --include="*.py" → must be 0 results
□ grep -r "performanceFee" --include="*.ts" --include="*.tsx" → must be 0 results
□ grep -r "exchangeRateCurrent" --include="*.py" → must be 0 results (only Stored allowed)
□ grep -r "type(uint256).max\|MaxUint256" apps/execution → must be present in withdrawal UserOp
□ grep -r "getOwner\|kernelAccount.owner" apps/execution → must be present (not passed from body)
□ grep -r "console.log" apps/execution/src → must be 0 (use structured logger)
□ grep -r "print(" apps/backend/app → must be 0 (use logger.*)
□ grep -r "Euler V2" apps/web/app/page.tsx → must be 0 (not in primary protocol description)

LIVE ENDPOINT CHECKS after deploy:
□ GET https://snowmindbackend-production-10ed.up.railway.app/docs → must return 404
□ GET https://snowmindbackend-production-10ed.up.railway.app/openapi.json → must return 404
□ GET https://execution-service-production-b1e9.up.railway.app/health → must return 200
□ GET https://snowmindbackend-production-10ed.up.railway.app/api/v1/health → must return 200
□ GET https://snowmindbackend-production-10ed.up.railway.app/api/v1/protocols/rates → must return APYs
□ POST /api/v1/optimizer/simulate with $10K → must return dry_run allocation

FINAL: Run the full test suite:
  cd apps/backend && pytest tests/ -v --tb=short
  All tests must pass before the application is considered hardened for mainnet.
</final_checklist>