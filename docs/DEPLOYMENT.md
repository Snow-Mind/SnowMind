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
3. Run the SQL migrations in **SQL Editor** to create tables:
   - `accounts`, `allocations`, `rebalance_logs`, `protocol_configs`
4. Enable **Row Level Security** on all tables.

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

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `PIMLICO_API_KEY` | Pimlico bundler API key |
| `ZERODEV_PROJECT_ID` | ZeroDev project ID |
| `AVALANCHE_RPC_URL` | Avalanche RPC endpoint |
| `SESSION_KEY_ENCRYPTION_KEY` | 32-byte AES key, hex-encoded |
| `JWT_SECRET` | Random 256-bit secret for JWT signing |
| `BACKEND_API_KEY` | Shared secret for frontend→backend auth |
| `IS_TESTNET` | `true` for Fuji, `false` for mainnet |
| `DEBUG` | `false` in production |
| `ALLOWED_ORIGINS` | JSON array: `["https://snowmind.vercel.app","https://snowmind.app"]` |

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

| Variable | Scope | Value |
|----------|-------|-------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | All | Your Privy app ID |
| `NEXT_PUBLIC_ZERODEV_PROJECT_ID` | All | ZeroDev project ID |
| `NEXT_PUBLIC_AVALANCHE_RPC_URL` | All | Avalanche RPC URL |
| `NEXT_PUBLIC_BACKEND_URL` | Production | `https://<railway-domain>` |
| `NEXT_PUBLIC_CHAIN_ID` | All | `43113` (Fuji) or `43114` (mainnet) |

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
1. **test-backend**: Runs `pytest` with 70% coverage gate
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
