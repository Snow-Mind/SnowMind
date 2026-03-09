# SnowMind — Deployment Guide

Production deployment for the SnowMind AI yield optimizer.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@9 --activate` |
| Python | 3.12+ | [python.org](https://python.org) |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Railway CLI | latest | `npm install -g @railway/cli` |
| Vercel CLI | latest | `npm install -g vercel` |

---

## 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Under **Settings → API**, copy:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_SERVICE_KEY` (service_role key — never expose publicly)
3. Run the SQL schema from `apps/backend/supabase_schema.sql` in the **SQL Editor**. This creates:
   - `accounts` — smart account registry (including `risk_tolerance` column)
   - `allocations` — per-protocol USDC allocations
   - `rebalance_logs` — rebalance event history
   - `rate_snapshots` — TWAP rate data from on-chain reads
   - `session_keys` — encrypted session key storage
   - `session_key_audit` — audit trail for session key operations
   - `scheduler_locks` — cron scheduler deduplication locks
   - `protocol_health` — circuit-breaker protocol health state
4. Enable **Row Level Security** on all tables (the schema does this automatically).

---

## 2. Railway (Backend)

### First-time setup

```bash
cd apps/backend
railway login
railway init          # Link to your Railway project
railway link          # Select the snowmind-backend service
```

### Environment variables

Set these in **Railway → Service → Variables**:

| Variable | Description | Fuji Default |
|----------|-------------|------|
| `SUPABASE_URL` | Supabase project URL | *(from Supabase dashboard)* |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (never expose publicly) | *(from Supabase dashboard)* |
| `PIMLICO_API_KEY` | Pimlico bundler API key | *(from pimlico.io)* |
| `ZERODEV_PROJECT_ID` | ZeroDev project ID | *(from dashboard.zerodev.app)* |
| `AVALANCHE_RPC_URL` | Avalanche C-Chain RPC | `https://api.avax-test.network/ext/bc/C/rpc` |
| `AVALANCHE_CHAIN_ID` | Chain ID | `43113` |
| `REGISTRY_CONTRACT_ADDRESS` | SnowMindRegistry | `0xf842428ad92689741cafb0029f4d76361b2d02d4` |
| `AAVE_V3_POOL` | Aave V3 Pool on Fuji | `0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29` |
| `BENQI_POOL` | MockBenqiPool on Fuji | `0x6ac240d13b85a698ee407617e51f9baab9e395a9` |
| `EULER_VAULT` | MockEulerVault on Fuji | `0x372193056e6c57040548ce833ee406509a457632` |
| `USDC_ADDRESS` | Test USDC on Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| `ENTRYPOINT_V07` | ERC-4337 EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| `SESSION_KEY_ENCRYPTION_KEY` | 32-byte AES-256 hex key (generate: `openssl rand -hex 32`) | *(generate fresh)* |
| `JWT_SECRET` | Random 256-bit secret (generate: `openssl rand -hex 32`) | *(generate fresh)* |
| `BACKEND_API_KEY` | Shared secret for frontend→backend auth (fallback) | *(generate fresh)* |
| `PRIVY_APP_ID` | Privy app ID (same as frontend `NEXT_PUBLIC_PRIVY_APP_ID`) | *(from privy.io dashboard)* |
| `PRIVY_APP_SECRET` | Privy app secret for server-side API calls | *(from privy.io dashboard)* |
| `DEPLOYER_PRIVATE_KEY` | Testnet deployer PK (only for MockBenqi accrual) | *(optional)* |
| `IS_TESTNET` | `true` for Fuji, `false` for mainnet | `true` |
| `DEBUG` | `false` in production | `false` |
| `ALLOWED_ORIGINS` | JSON array of frontend URLs | `["http://www.snowmind.xyz"]` |
| `REBALANCE_CHECK_INTERVAL` | Seconds between optimizer runs | `1800` |
| `MAX_PROTOCOL_ALLOCATION` | Max % per protocol | `0.60` |
| `MIN_REBALANCE_THRESHOLD` | Min delta to trigger rebalance | `0.05` |
| `MIN_BALANCE_USD` | Min account balance to optimize | `5000.0` |

### Manual deploy

```bash
cd apps/backend
railway up --detach
```

### Health check

```
GET https://<railway-domain>/api/v1/health
→ { "status": "healthy", "chain_id": 43113, "testnet": true }
```

---

## 3. Vercel (Frontend)

### First-time setup

```bash
cd apps/web
vercel login
vercel link           # Link to your Vercel project
```

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Scope | Fuji Value |
|----------|-------|------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | All | *(from privy.io dashboard)* |
| `NEXT_PUBLIC_ZERODEV_PROJECT_ID` | All | *(from dashboard.zerodev.app)* |
| `NEXT_PUBLIC_AVALANCHE_RPC_URL` | All | `https://api.avax-test.network/ext/bc/C/rpc` |
| `NEXT_PUBLIC_BACKEND_URL` | Production | `https://snowmindweb-production.up.railway.app` |
| `NEXT_PUBLIC_CHAIN_ID` | All | `43113` |
| `NEXT_PUBLIC_BACKEND_API_KEY` | All | *(same as `BACKEND_API_KEY` in Railway)* |
| `NEXT_PUBLIC_PIMLICO_API_KEY` | All | *(from pimlico.io)* |
| `NEXT_PUBLIC_SUPABASE_URL` | All | *(Supabase project URL)* |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | *(Supabase anon key — NOT service key)* |
| `NEXT_PUBLIC_REGISTRY_ADDRESS` | All | `0xf842428ad92689741cafb0029f4d76361b2d02d4` |
| `NEXT_PUBLIC_BENQI_POOL_ADDRESS` | All | `0x6ac240d13b85a698ee407617e51f9baab9e395a9` |
| `NEXT_PUBLIC_EULER_VAULT_ADDRESS` | All | `0x372193056e6c57040548ce833ee406509a457632` |

### Manual deploy

```bash
cd apps/web
vercel --prod
```

### Deployment region

The `vercel.json` is configured for **Mumbai (bom1)** — closest to South Asian users. Adjust `regions` in `apps/web/vercel.json` if needed.

---

## 4. CI/CD (GitHub Actions)

Two workflows exist:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `.github/workflows/ci.yml` | Push & PR to `main` | Lint frontend, build frontend, test backend |
| `.github/workflows/deploy.yml` | Push to `main` only | Test + deploy both services |

### Required GitHub Secrets

Set in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `RAILWAY_TOKEN` | Railway deploy token (`railway tokens create`) |
| `VERCEL_TOKEN` | Vercel personal access token |

The deploy pipeline:
1. **test-backend**: Runs `pytest` with 15% coverage gate
2. **test-frontend**: Lints and builds the Next.js app
3. **deploy-backend**: `railway up` (runs after test-backend passes)
4. **deploy-frontend**: `vercel deploy --prod` (runs after test-frontend passes)

---

## 5. Fuji Testnet End-to-End Test

After deploying both services:

1. **Health check** — `GET <backend>/api/v1/health` returns 200
2. **Connect wallet** — Open frontend, connect via Privy
3. **Smart account** — Verify ZeroDev creates a Kernel v3.1 account
4. **Deposit** — Deposit test USDC on Fuji
5. **Dashboard** — Portfolio shows balance and allocations
6. **Optimizer** — Trigger optimizer and verify allocation math
7. **Rebalance** — Wait for scheduler cycle or trigger manually
8. **Snowtrace** — Confirm transactions appear on [testnet.snowtrace.io](https://testnet.snowtrace.io)

---

## 6. Adding a New Protocol

1. Create `apps/backend/app/services/protocols/<name>.py` implementing the `ProtocolAdapter` base class
2. Register it in the protocol registry
3. Add contract addresses to `config.py`
4. Add risk score to the risk scorer
5. Update `ALLOWED_CONTRACTS` in session key scoping
6. Run the MILP solver tests: `uv run pytest tests/unit/test_milp_solver.py -v`
7. Deploy backend

---

## 7. Emergency Procedures

### Pause auto-rebalancing

Set `REBALANCE_CHECK_INTERVAL=999999` in Railway env vars and redeploy. The scheduler will effectively stop.

### Rate anomaly

If a protocol returns APY > 25%, the system automatically halts rebalancing and logs a `RATE_ANOMALY_DETECTED` event. Check Railway logs:

```bash
railway logs --service snowmind-backend | grep RATE_ANOMALY
```

### Rollback

- **Backend**: Railway keeps previous deployments — rollback via the Railway dashboard
- **Frontend**: Vercel keeps all deployments — promote a previous deployment via `vercel rollback`

### Funds are always safe

If both services go down, user funds remain deposited in their current protocols (Benqi/Aave), continuing to earn yield. No action is needed — funds are in the user's own smart account.

---

## 8. Fuji Testnet Contract Addresses (Quick Reference)

| Contract | Address | Notes |
|----------|---------|-------|
| **SnowMindRegistry** | `0xf842428ad92689741cafb0029f4d76361b2d02d4` | Deployed by us |
| **MockBenqiPool** | `0x6ac240d13b85a698ee407617e51f9baab9e395a9` | Deployed by us |
| **MockEulerVault** | `0x372193056e6c57040548ce833ee406509a457632` | Deployed by us |
| **Aave V3 Pool** | `0x1775ECC8362dB6CaB0c7A9C0957cF656A5276c29` | Official Aave Fuji |
| **USDC (Fuji)** | `0x5425890298aed601595a70AB815c96711a31Bc65` | Official test USDC |
| **Aave Faucet** | `0xA70D8aD6d26931d0188c642A66de3B6202cDc5FA` | Mint test tokens |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ERC-4337 singleton |

All contracts are verified on [testnet.snowtrace.io](https://testnet.snowtrace.io).

---

## 9. Session Key Security (MVP)

SnowMind uses **Option 1: Encrypted in database** for MVP.

- Session keys are AES-256-GCM encrypted before storage in the `session_keys` table
- The encryption key comes from the `SESSION_KEY_ENCRYPTION_KEY` env var (32 bytes, hex-encoded)
- Keys are decrypted **only in-memory** when needed, never persisted in plaintext
- The `session_key_audit` table logs all key operations (creation, usage, revocation)
- RLS policy on `session_keys` denies all read access from the anon key — only the service role can read them

**Generate the encryption key:** `openssl rand -hex 32`

**Post-MVP roadmap:** Migrate to AWS KMS or Google Cloud KMS for hardware-backed key management.

---

## 10. Database Migrations

All SQL migrations live in `apps/backend/db/migrations/`. Files are numbered sequentially:

```
db/migrations/
├── 001_initial_schema.sql      # Full schema bootstrap
└── README.md                   # Migration instructions
```

To apply migrations:
1. Open the Supabase SQL Editor
2. Run each migration file in order
3. Verify tables exist: `SELECT tablename FROM pg_tables WHERE schemaname = 'public';`

The full schema is also available at `apps/backend/supabase_schema.sql` for reference.
