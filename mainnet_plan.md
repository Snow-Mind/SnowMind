SnowMind Mainnet Launch Plan — Beta v1
Context
SnowMind is currently running on Avalanche Fuji testnet with mock contracts simulating yield. To launch a real product that takes real deposits and earns real yield (like Giza on Base and ZyFAI on Sonic), we need to transition every layer — contracts, backend, frontend, security, infrastructure — from testnet mocks to mainnet production. This plan covers everything needed to go from IS_TESTNET=true to a working mainnet beta accepting real USDC deposits.

Reference products:

Giza ($23M TVL, 3,700 users) — UI/UX model. Individual smart accounts, 10% performance fee, AI-driven allocation across Aave/Morpho/Compound on Base.
ZyFAI ($7.5M TVL, 12,966 wallets) — Technology model. Rule-based agents, self-custodial smart wallets, ERC-7579/Rhinestone, Sherlock-audited.
Current state: Waterfall allocator implemented, per-day gas gate active, 10% profit fee calculator built, all on Fuji testnet with mock contracts.

Phase 1: Protocol Verification & Contract Addresses
Mainnet Protocols for Beta Launch
Protocol	Status	Mainnet Address	Interface	Role
Aave V3	LIVE	Pool: 0x794a61358D6845594F94dc1DB02A252b5b4814aD	supply()/withdraw()	Base layer (yield floor)
Benqi	LIVE	qiUSDCn: 0xB715808a78F6041E46d61Cb123C9B4A27056AE9C	mint()/redeem()	Active candidate
Spark	UNCONFIRMED	Announced Avalanche expansion but address not verified	deposit()/redeem()	Add post-launch when verified
Euler V2	DROPPED	Deprecated vault, no healthy USDC vault confirmed	—	Mark "coming soon" in UI
Key decisions:

Aave V3 is the base layer (replaces Spark in the waterfall allocator) — battle-tested, lowest risk score (2.0)
Euler V2 dropped for beta launch — mark as "coming soon" in frontend
Spark deferred — add when mainnet address is confirmed
Beta launches with Aave V3 + Benqi (2 protocols, both confirmed live)
USDC Decision
Use Native USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E

Circle-issued directly on Avalanche (no bridge risk)
Used by Aave V3 and Benqi (qiUSDCn)
Industry migration trend away from USDC.e
Action Items
Verify Spark Avalanche vault address → Deferred — Spark not confirmed, Aave V3 is base layer
Verify Euler V2 active vault → Dropped — mark "coming soon" in frontend
Update waterfall allocator — change spark_protocol_id default to aave_v3 as the base layer
Update ACTIVE_PROTOCOLS — remove euler_v2 from active list, set isComingSoon: true
Files to modify
apps/backend/app/core/config.py — all 6 contract addresses + chain ID + RPC URL
apps/web/lib/constants.ts — all CONTRACTS, EXPLORER, PIMLICO, CHAIN
apps/backend/.env.example — update defaults
contracts/foundry.toml — already has mainnet RPC, just needs verification
Phase 2: Chain Migration (Fuji → Mainnet)
2A. Backend changes
apps/backend/app/core/config.py:

AVALANCHE_RPC_URL = "https://api.avax.network/ext/bc/C/rpc"
AVALANCHE_CHAIN_ID = 43114
IS_TESTNET = False
USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
BENQI_POOL = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
EULER_VAULT = "<mainnet address or empty>"
SPARK_VAULT = "<mainnet address or empty>"
REGISTRY_CONTRACT_ADDRESS = "<redeploy on mainnet>"
TREASURY_ADDRESS = "<SnowMind multisig>"
All of these should come from environment variables — the defaults in config.py remain Fuji for dev, production Railway env vars override to mainnet.

2B. Frontend changes (7 files)
Every avalancheFuji import → avalanche:

File	Lines	Change
apps/web/lib/constants.ts	1, 3, 4, 15, 43-46, 50-51	Chain, ID, RPC, explorer, Pimlico URLs
apps/web/lib/zerodev.ts	32, 35	Chain import and constant
apps/web/app/(app)/onboarding/page.tsx	27, 204, 268, 276-277, 287, 303	Chain refs + hex chain ID 0xA869 → 0xA86A
apps/web/components/dashboard/DepositPanel.tsx	15, 54, 89, 97-98, 108, 131	Chain + network name text
apps/web/components/dashboard/EmergencyPanel.tsx	17, 66	Chain import
apps/web/app/(app)/layout.tsx	39, 347, 369, 379, 493, 526, 726	Multiple client instances
Approach: Make ALL of these env-driven via constants.ts. Import the chain dynamically:

import { avalanche, avalancheFuji } from 'viem/chains'
export const CHAIN = process.env.NEXT_PUBLIC_CHAIN_ID === '43114' ? avalanche : avalancheFuji
Then every other file imports CHAIN from constants — one place to change.

2C. Contract addresses — env-driven
Make constants.ts CONTRACTS read from env vars (most already do for some, extend to all):

AAVE_POOL: process.env.NEXT_PUBLIC_AAVE_POOL ?? '<fuji-default>'
BENQI_POOL: process.env.NEXT_PUBLIC_BENQI_POOL ?? '<fuji-default>'
USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS ?? '<fuji-default>'
2D. Remove testnet-only code
Delete apps/web/components/wallet/FujiTestFaucet.tsx and all imports
Remove CONTRACTS.AAVE_FAUCET from constants.ts (line 26)
Guard Benqi accrueInterest scheduler job already behind IS_TESTNET — no change needed
Phase 3: Deploy SnowMindRegistry on Mainnet
The SnowMindRegistry.sol is a simple on-chain logging contract. It must be redeployed on mainnet.

Steps
Update contracts/script/Deploy.s.sol line 13: change USDC address to 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
Deploy via Foundry: forge script script/Deploy.s.sol --rpc-url avalanche --broadcast --verify
Note the new Registry address → set in env vars
Security for Registry
Set the owner to a Gnosis Safe multisig (2/3 minimum)
Not to a single deployer EOA
Phase 4: Protocol Adapter Validation
4A. Aave V3 adapter (apps/backend/app/services/protocols/aave.py)
ABI is standard Aave V3 Pool interface → compatible with mainnet
Test against mainnet fork: read getReserveData() for native USDC
Verify aToken address resolution works with native USDC
No code changes needed beyond the address swap
4B. Benqi adapter (apps/backend/app/services/protocols/benqi.py)
Currently targets MockBenqiPool, but the mock was built to match real Benqi's interface
Real Benqi qiUSDCn uses supplyRatePerTimestamp() (not supplyRatePerBlock()) — verify the adapter uses the correct function
Test mint(), redeem(), exchangeRateCurrent(), balanceOf() against real qiUSDCn
Verify usdc_to_qi_tokens() conversion works with real exchange rate
4C. Spark adapter (apps/backend/app/services/protocols/spark.py)
Uses ERC-4626 interface (deposit/redeem/convertToShares/convertToAssets)
If Spark is confirmed on mainnet → just address swap
If Spark is NOT on mainnet → modify waterfall allocator to use a different base layer (could be Benqi as the conservative option)
4D. Euler V2 adapter (apps/backend/app/services/protocols/euler_v2.py)
If no active healthy USDC vault on Avalanche → set is_available=False, mark as "coming soon" in frontend
If confirmed → verify the vault is not deprecated and has meaningful TVL
4E. Fork testing
For each protocol:

# Fork mainnet and run adapter calls against real contracts
forge test --fork-url https://api.avax.network/ext/bc/C/rpc
Also write Python integration tests that call get_rate() and get_user_balance() against a forked mainnet.

Phase 5: Security Hardening (Enterprise-Grade)
5A. Session key parameters
Current (UNSAFE for mainnet):

onboarding/page.tsx line 382: durationDays: 36500 (100 years)
Change to:

durationDays: 30 (30-day session keys, renewable)
maxAmountUSDC: 10_000 ($10K per operation — keep or adjust per user tier)
maxOpsPerDay: 20 (keep)
Add a session key renewal prompt in the dashboard when key is expiring within 7 days.

5B. Multisig treasury
Deploy a Gnosis Safe (2/3 signers minimum) on Avalanche mainnet
Set as TREASURY_ADDRESS for fee collection
Set as owner of SnowMindRegistry contract
All infrastructure signing (deploys, admin ops) through the multisig
5C. Guarded launch (deposit caps)
Add a MAX_TOTAL_DEPOSIT_USD config to limit total deposits during beta:

Launch: $50K total cap across all users (~10-20 users at $2.5-5K each)
Week 3-4: raise to $200K after confirming everything works
Month 2+: $1M cap
Scale up as confidence grows
Implementation:

Backend: check total allocations before accepting deposit
Frontend: show remaining capacity on deposit modal
5D. Rate limiting & DDoS
Already have rate limiting via limiter.py. For mainnet:

API rate limits: 60 req/min on /rates, 10 req/min on /optimizer/run
Ensure Privy auth is enforced on ALL write endpoints
Add IP-based rate limiting on the execution service
5E. Monitoring & alerting
Add:

Sentry for error tracking (backend + frontend)
Webhook alerts to Discord/Telegram for: rebalance executed, rebalance failed, rate anomaly, circuit breaker triggered
Health check endpoint that verifies: Supabase connection, RPC node reachable, protocol adapters responding
Log all rebalance decisions with full reasoning to rebalance_logs (already done)
5F. Incident response
Create a runbook:

Detect: monitoring alert fires
Verify: check rebalance_logs, protocol_health table
Pause: set IS_ACTIVE=False on affected accounts or kill scheduler
Communicate: notify affected users via dashboard banner
Remediate: fix issue, test, redeploy
Post-mortem: document and improve
Phase 6: Infrastructure Setup
6A. Separate environments
Environment	Backend	Frontend	DB	Purpose
Development	localhost:8000	localhost:3000	Supabase dev project	Local dev
Staging	Railway (staging)	Vercel preview	Supabase staging	Pre-production on Fuji
Production	Railway (prod)	Vercel prod	New Supabase prod project	Mainnet beta
Fresh Supabase project for production — no testnet data contamination
Run all 5 migrations against the new prod database
Separate env vars per environment on Railway and Vercel
6B. RPC provider
Primary: Avalanche public RPC https://api.avax.network/ext/bc/C/rpc
Recommended upgrade: Use a dedicated provider (Infura, Alchemy, QuickNode) for production reliability
Add fallback RPC URL in config for resilience
6C. Pimlico & ZeroDev
Ensure Pimlico API key supports avalanche (mainnet), not just avalanche-fuji
Verify ZeroDev project is configured for Avalanche mainnet (chain ID 43114)
Test smart account deployment on mainnet (costs real AVAX for gas)
Confirm paymaster policy covers mainnet operations
6D. Domain & SSL
app.snowmind.xyz for the production frontend (Vercel)
api.snowmind.xyz for the production backend (Railway custom domain)
HTTPS enforced everywhere (already standard on Vercel/Railway)
Phase 7: UI/UX Improvements (Giza-inspired)
7A. Deposit flow (modeled after Giza)
Current flow: Onboarding page → deposit + approve + session key in one flow. This is good.

Improvements:

Show estimated APY before deposit: "Your $5,000 would earn ~$200/yr at current rates"
Show fee disclosure upfront: "10% performance fee on profits only. No deposit fee."
Show which protocols the waterfall will allocate to with percentages
Add minimum deposit display: $10 minimum (match Giza's low barrier)
7B. Dashboard improvements
Current dashboard shows allocation chart, yield metrics, rebalance history. Good foundation.

Add (Giza-inspired):

Real-time P&L: Show profit/loss since deposit, daily/weekly/monthly yield
Fee transparency: Show accumulated fees, net earnings after fees
Protocol breakdown: Show each protocol's contribution to yield
"Agent status" indicator: "Active — last check 12 min ago" (shows the optimizer is alive)
Withdrawal preview: Before withdrawing, show fee breakdown: "Your profit: $X, Fee (10%): $Y, You receive: $Z"
7C. Activity page
Already exists at apps/web/app/(marketing)/activity/page.tsx. Ensure it shows:

Every rebalance with: timestamp, from/to protocol, amount, reason, tx hash
Gas cost per rebalance
APY improvement achieved
7D. Settings page
Already updated with waterfall descriptions. For mainnet add:

Session key renewal button (with days remaining shown)
"Pause agent" toggle (stops auto-rebalancing but keeps funds earning in current protocol)
Fee history / tax report export
Phase 8: Waterfall Allocator Mainnet Adjustments
8A. Aave V3 as base layer (replaces Spark)
Modify waterfall_allocator.py and config.py:

Change SPARK_PROTOCOL_ID = "spark" → BASE_LAYER_PROTOCOL_ID = "aave_v3"
Rename spark_beat_margin → base_beat_margin in waterfall_allocate() for clarity
Waterfall logic becomes: "Is Benqi's APY at least 50bps above Aave V3? If yes, allocate to Benqi. Otherwise, park in Aave V3."
For 2-protocol launch (Aave + Benqi), the waterfall simply picks whichever is higher by at least 50bps, defaulting to Aave V3
Example scenarios with 2 protocols:

Aave 3.0%, Benqi 4.0% → Benqi beats Aave by 1.0% > 0.5% margin → 100% Benqi (for small deposits)
Aave 3.0%, Benqi 3.2% → Benqi beats Aave by 0.2% < 0.5% margin → 100% Aave (not worth moving)
Aave 3.5%, Benqi 3.0% → Benqi doesn't beat Aave → 100% Aave
8B. Update ACTIVE_ADAPTERS for beta launch
In apps/backend/app/services/protocols/__init__.py:

Remove euler_v2 from ACTIVE_ADAPTERS (keep the adapter code for future use)
Remove spark from ACTIVE_ADAPTERS (keep the adapter code for future use)
Active list: ["aave_v3", "benqi"]
In apps/web/lib/constants.ts:

Set euler_v2.isActive: false, isComingSoon: true
Set spark.isActive: false, isComingSoon: true
ACTIVE_PROTOCOLS: ['aave_v3', 'benqi']
8C. Update ProtocolId
In apps/backend/app/models/allocation.py:

Keep all 4 in the Literal type (for DB backward compat)
Active allocation only happens for aave_v3 and benqi
8D. TVL-based caps with real data
On mainnet, real on-chain TVL will be available:

Aave: ~$100M USDC supplied → 15% cap = $15M (plenty of room for beta)
Benqi: varies → 15% cap still appropriate
Only matters if a single user deposits >$100K (unlikely during $50K total cap beta)
8E. Platform deposit cap ($50K beta)
Add MAX_TOTAL_PLATFORM_DEPOSIT_USD: float = 50000.0 to config.py.

Enforce in the deposit/onboarding flow:

# In accounts.py or rebalancer initial deployment check
total_platform = sum(row["amount_usdc"] for row in db.table("allocations").select("amount_usdc").execute().data)
if total_platform + new_deposit > settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD:
    raise HTTPException(429, "Beta deposit cap reached. Join waitlist.")
Frontend: show remaining capacity on deposit modal.

Phase 9: Fee Collection Implementation
The fee_calculator.py and account_yield_tracking table exist. For mainnet:

9A. Record deposits on initial deployment
In rebalancer.py — when idle_usdc > 0 and account has no existing positions (initial deployment detected), call record_deposit(db, account_id, idle_usdc).

9B. Fee collection on withdrawal
Current: execute_emergency_withdrawal() withdraws everything to the smart account. The fee is calculated but the actual USDC split (user vs treasury) requires the execution service to send two transfers:

(total - fee) USDC → user's EOA
fee USDC → treasury multisig
The Node.js execution service needs a "split withdrawal" feature. Alternatively, the fee can be collected as a separate follow-up transaction.

9C. Frontend fee display
Modify EmergencyPanel.tsx to show fee breakdown before user confirms withdrawal:

Portfolio value: $10,500
Profit earned: $500
Fee (10%): $50
You receive: $10,450
Phase 10: Dev Branch & Git Strategy
Branch structure
main          ← current state (testnet + waterfall changes)
  └── dev     ← all mainnet work happens here
       ├── Phase 2: chain-migration  (Fuji → mainnet addresses)
       ├── Phase 3: registry-deploy
       ├── Phase 4: adapter-validation
       ├── Phase 5: security-hardening
       └── ... merge to main when beta-ready
Steps
Create dev branch from current main
Push current uncommitted work to main first
All mainnet changes go into dev with feature PRs
Merge dev → main when ready for production deploy
Implementation Order (Priority Sequence)
Order	Phase	Description	Effort
1	Phase 10	Create dev branch, push current work to main	10 min
2	Phase 1	Verify Spark/Euler on mainnet (web research + on-chain check)	1 hour
3	Phase 2	Chain migration — all address/chain swaps, env-driven config	2-3 hours
4	Phase 3	Deploy SnowMindRegistry on mainnet	30 min
5	Phase 4	Fork-test all protocol adapters against real mainnet contracts	2-3 hours
6	Phase 5	Security hardening (session keys, multisig, deposit caps, monitoring)	3-4 hours
7	Phase 6	Infrastructure (prod Supabase, Railway prod, Vercel prod)	1-2 hours
8	Phase 8	Waterfall allocator mainnet adjustments (if Spark unavailable)	1 hour
9	Phase 9	Fee collection implementation (deposit tracking, split withdrawal)	2 hours
10	Phase 7	UI/UX improvements (Giza-inspired dashboard, deposit flow)	3-4 hours
Critical Files Summary
Must modify for mainnet (backend):
apps/backend/app/core/config.py — chain ID, RPC, all contract addresses, IS_TESTNET
apps/backend/app/services/protocols/benqi.py — verify against real qiUSDCn
apps/backend/app/services/protocols/spark.py — verify or drop
apps/backend/app/services/protocols/euler_v2.py — verify or drop
apps/backend/app/services/protocols/__init__.py — update ACTIVE_ADAPTERS if protocols dropped
apps/backend/app/services/optimizer/rebalancer.py — deposit tracking for fees
apps/backend/app/workers/scheduler.py — monitoring alerts
Must modify for mainnet (frontend):
apps/web/lib/constants.ts — chain, addresses, explorer, Pimlico
apps/web/lib/zerodev.ts — chain
apps/web/app/(app)/onboarding/page.tsx — chain + session key duration (36500 → 30 days)
apps/web/app/(app)/layout.tsx — chain references (6 locations)
apps/web/components/dashboard/DepositPanel.tsx — chain + text
apps/web/components/dashboard/EmergencyPanel.tsx — chain + fee display
apps/web/components/wallet/FujiTestFaucet.tsx — DELETE
Must modify for mainnet (contracts):
contracts/script/Deploy.s.sol — mainnet USDC address
Must create new:
Gnosis Safe multisig on Avalanche mainnet (for treasury + registry ownership)
Production Supabase project (fresh, no testnet data)
Production Railway environment with mainnet env vars
Production Vercel deployment with mainnet env vars
Verification Checklist (Pre-Launch)
 All protocol adapters return valid rates from mainnet contracts
 Waterfall allocator produces correct allocations with real APY data
 Rebalance gate correctly evaluates per-day gas threshold with real gas costs
 Session keys deploy with 30-day duration on mainnet
 Smart account deploys successfully on Avalanche mainnet
 Deposit → approve → supply flow works with real USDC
 Withdrawal flow works and fee is correctly calculated
 Registry contract deployed and logs rebalances on mainnet
 Treasury address receives fees
 Explorer links point to snowtrace.io (not testnet)
 Pimlico bundler submits UserOps on mainnet
 Rate validation cross-checks with DefiLlama against real Avalanche pool IDs
 Circuit breaker correctly excludes failing adapters
 Deposit cap enforced during guarded launch
 All existing unit tests pass (27/27)
 Fork tests pass against mainnet contracts
 Monitoring alerts fire on test events
 Emergency withdrawal tested end-to-end
