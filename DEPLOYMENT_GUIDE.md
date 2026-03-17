# SnowMind Mainnet Deployment Guide

> Complete guide to deploying SnowMind beta on Avalanche C-Chain mainnet.
> Last updated: March 2026

---

## Table of Contents

1. [How SnowMind Works (Plain English)](#1-how-snowmind-works-plain-english)
2. [Architecture Overview](#2-architecture-overview)
3. [Mainnet Contract Addresses](#3-mainnet-contract-addresses)
4. [Environment Variables](#4-environment-variables)
5. [Supabase Migrations](#5-supabase-migrations)
6. [Deployment Steps](#6-deployment-steps)
7. [Manual Steps (Require External Access)](#7-manual-steps-require-external-access)
8. [Fork Testing](#8-fork-testing)
9. [Verification Checklist](#9-verification-checklist)

---

## 1. How SnowMind Works (Plain English)

SnowMind is a **yield optimizer** for USDC on Avalanche. Users deposit USDC, and an AI-driven agent automatically moves their funds between DeFi lending protocols (Aave V3 and Benqi) to earn the highest safe yield.

### The Flow

1. **User connects wallet** → Privy handles authentication (social login or wallet).
2. **Smart account is created** → ZeroDev deploys an ERC-4337 smart account for the user on Avalanche. The user's EOA (MetaMask/embedded wallet) is the owner.
3. **User deposits USDC** → Transfers native USDC into their smart account and approves a **session key** (valid 30 days) that allows SnowMind's backend to move funds between whitelisted protocols on their behalf.
4. **The Waterfall Allocator runs every 30 minutes** → It checks current APYs, picks the best protocol, and decides if a rebalance is worth the gas cost.
5. **If a rebalance is needed** → The backend calls the Node.js execution service, which uses the session key to submit a UserOperation (ERC-4337) via Pimlico's bundler. Funds move from one protocol to another in a single transaction.
6. **User withdraws anytime** → Emergency withdrawal pulls all funds back to the smart account. A 10% fee is charged only on profits (yield earned), not on principal.

### The Waterfall Allocator

Instead of a complex mathematical optimizer, SnowMind uses a simple **waterfall** strategy:

- **Aave V3 is the "base layer"** — the safe default where funds park.
- **Benqi is the "candidate"** — it gets funds only if its APY beats Aave V3 by at least 50 basis points (0.5%).
- If Benqi's rate is only slightly higher, funds stay in Aave V3 (not worth the gas to move).
- TVL caps prevent putting more than 15% of any protocol's total liquidity, and exposure caps limit 40% of a user's deposit in any single protocol.

**Example:**
- Aave V3 APY: 3.0%, Benqi APY: 4.2% → Benqi beats Aave by 1.2% > 0.5% margin → Funds go to Benqi.
- Aave V3 APY: 3.0%, Benqi APY: 3.3% → Benqi beats Aave by 0.3% < 0.5% margin → Funds stay in Aave V3.

### Safety Features

- **Rate validation**: Cross-checks on-chain rates against DefiLlama. If they diverge by >2%, the circuit breaker halts that protocol.
- **TWAP smoothing**: Uses 15-minute time-weighted average prices, not instantaneous rates (prevents manipulation).
- **30-day APY averaging**: Rebalance decisions use 30-day moving averages when available.
- **Max move cap**: No single rebalance can move more than 30% of total funds.
- **Minimum interval**: At least 6 hours between rebalances.
- **Gas gate**: Rebalance only happens if the expected yield improvement exceeds gas cost.
- **Platform deposit cap**: $50K total across all users during guarded beta launch.
- **Session key expiry**: 30-day session keys (renewable), not permanent access.

### Fee Model

- **No deposit fee** — users deposit and withdraw freely.
- **10% performance fee on profits only** — if you deposit $10,000 and withdraw $10,500, the fee is 10% of $500 = $50. You receive $10,450. The fee is transferred atomically to the SnowMind treasury (Gnosis Safe) in the same transaction as the withdrawal.
- **No fee if no profit** — if you withdraw at a loss (unlikely with stablecoin lending), there's zero fee.
- **Fee formula**: `fee = (current_balance - total_deposited) * 0.10` — simple and transparent.
- **On-chain enforced**: Session key has a scoped `USDC.transfer()` permission that can ONLY send to the treasury address. Even a stolen session key cannot send funds anywhere else.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js)                  │
│  Vercel · app.snowmind.xyz                              │
│                                                         │
│  Privy Auth → ZeroDev Smart Account → Deposit USDC      │
│  Dashboard: allocations, yield, rebalance history        │
│  Emergency Panel: one-click withdraw-all                 │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTPS (Privy JWT)
                  ▼
┌─────────────────────────────────────────────────────────┐
│                     BACKEND (FastAPI)                   │
│  Railway · api.snowmind.xyz                             │
│                                                         │
│  /api/v1/optimizer/run     → Waterfall allocator        │
│  /api/v1/rebalance/{addr}/ → Trigger, status, history   │
│  /api/v1/rebalance/platform/capacity → Deposit cap      │
│  /api/v1/accounts/         → Register, status            │
│                                                         │
│  Scheduler: check_and_rebalance every 30 min            │
│  Rate Fetcher → Aave V3 + Benqi on-chain rates          │
│  Rate Validator → TWAP + DefiLlama cross-check          │
│  Fee Calculator → 10% profit fee on withdrawal          │
└────────┬──────────────────────┬─────────────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌─────────────────────────────────┐
│   Supabase DB   │   │   Execution Service (Node.js)   │
│                 │   │   localhost:3001 (Railway)       │
│  accounts       │   │                                 │
│  session_keys   │   │   ZeroDev SDK → Pimlico bundler │
│  allocations    │   │   → Avalanche C-Chain            │
│  rebalance_logs │   │   UserOps (ERC-4337)            │
│  rate_snapshots │   │                                 │
│  daily_apy_*    │   └────────────┬────────────────────┘
│  account_yield* │                │
│  protocol_health│                ▼
└─────────────────┘   ┌─────────────────────────────────┐
                      │      Avalanche C-Chain           │
                      │                                  │
                      │  Aave V3 Pool (supply/withdraw)  │
                      │  Benqi qiUSDCn (mint/redeem)     │
                      │  Native USDC (ERC-20)            │
                      │  SnowMindRegistry (logging)      │
                      │  EntryPoint v0.7 (ERC-4337)      │
                      └──────────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | Next.js 14, Viem, Privy | User interface, wallet connection, deposit/withdraw |
| Backend | FastAPI (Python) | Rate fetching, waterfall allocation, rebalance orchestration |
| Execution Service | Node.js, ZeroDev SDK | Signs and submits UserOperations to Pimlico bundler |
| Database | Supabase (PostgreSQL) | Accounts, allocations, logs, rate history |
| Bundler | Pimlico | Bundles ERC-4337 UserOps and submits to Avalanche |
| Smart Accounts | ZeroDev (Kernel v3) | ERC-4337 smart accounts with session key support |
| Auth | Privy | Social login + embedded wallets |

---

## 3. Mainnet Contract Addresses

These are **hardcoded defaults** in the codebase. Override via environment variables for different networks.

| Contract | Address | Network |
|----------|---------|---------|
| **Native USDC** | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Avalanche C-Chain |
| **Aave V3 Pool** | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | Avalanche C-Chain |
| **Benqi qiUSDCn** | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` | Avalanche C-Chain |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Avalanche C-Chain |
| **SnowMindRegistry** | *Deploy with Foundry (see below)* | Avalanche C-Chain |
| **Euler V2 Vault** | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` | Avalanche C-Chain |
| **Spark spUSDC** | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` | Avalanche C-Chain |

### Explorer

- Mainnet: `https://snowtrace.io`
- Testnet: `https://testnet.snowtrace.io`

---

## 4. Environment Variables

### 4A. Backend (Railway)

Set these in your Railway project's environment variables:

```bash
# ── App ──────────────────────────────────────────────────────
APP_NAME=SnowMind API
API_V1_PREFIX=/api/v1
DEBUG=false
IS_TESTNET=false

# ── CORS ─────────────────────────────────────────────────────
ALLOWED_ORIGINS=["https://www.snowmind.xyz","https://app.snowmind.xyz"]

# ── Supabase (PRODUCTION project — not testnet!) ─────────────
SUPABASE_URL=https://YOUR_PROD_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your_production_service_role_key...

# ── Blockchain (Avalanche Mainnet) ───────────────────────────
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
AVALANCHE_CHAIN_ID=43114
PIMLICO_API_KEY=your_pimlico_api_key
ZERODEV_PROJECT_ID=your_zerodev_project_id

# ── Contract Addresses (Avalanche Mainnet) ───────────────────
REGISTRY_CONTRACT_ADDRESS=0x_YOUR_DEPLOYED_REGISTRY_ADDRESS
AAVE_V3_POOL=0x794a61358D6845594F94dc1DB02A252b5b4814aD
BENQI_POOL=0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
EULER_VAULT=0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
SPARK_VAULT=0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
USDC_ADDRESS=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032

# ── Security ─────────────────────────────────────────────────
# Generate: python -c "import os; print(os.urandom(32).hex())"
SESSION_KEY_ENCRYPTION_KEY=your_32_byte_hex_key
JWT_SECRET=your_jwt_secret
JWT_ALGORITHM=HS256
BACKEND_API_KEY=your_api_key_for_frontend

# ── Auth (Privy) ─────────────────────────────────────────────
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# ── Execution Service ────────────────────────────────────────
EXECUTION_SERVICE_URL=http://localhost:3001
INTERNAL_SERVICE_KEY=your_shared_secret_between_backend_and_executor

# ── Optimizer Tuning ─────────────────────────────────────────
REBALANCE_CHECK_INTERVAL=1800
MAX_PROTOCOL_ALLOCATION=0.60
MIN_REBALANCE_THRESHOLD=0.05
MIN_BALANCE_USD=5000.0
MAX_APY_SANITY_BOUND=0.25
TWAP_WINDOW_MINUTES=15
MIN_REBALANCE_INTERVAL_HOURS=6

# ── Waterfall Allocator ─────────────────────────────────────
TVL_CAP_PCT=0.15
MAX_SINGLE_EXPOSURE_PCT=0.40
BASE_BEAT_MARGIN=0.005
GAS_COST_ESTIMATE_USD=0.008
BASE_LAYER_PROTOCOL_ID=spark
MIN_PROTOCOL_TVL_USD=100000.0

# ── Guarded Launch ───────────────────────────────────────────
MAX_TOTAL_PLATFORM_DEPOSIT_USD=50000.0

# ── Fees ─────────────────────────────────────────────────────
PROFIT_FEE_PCT=0.10
TREASURY_ADDRESS=0x_YOUR_GNOSIS_SAFE_MULTISIG_ADDRESS

# ── Oracle Cross-Validation ──────────────────────────────────
DEFILLAMA_BASE_URL=https://yields.llama.fi
RATE_DIVERGENCE_THRESHOLD=0.02

# ── Deployer (leave empty on mainnet — testnet-only) ─────────
DEPLOYER_PRIVATE_KEY=
```

### 4B. Frontend (Vercel)

Set these in Vercel project settings → Environment Variables:

```bash
# ── Auth (Privy) ─────────────────────────────────────────────
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# ── Smart Accounts (ZeroDev) ─────────────────────────────────
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your_zerodev_project_id
NEXT_PUBLIC_BUNDLER_URL=https://rpc.zerodev.app/api/v2/bundler/YOUR_PROJECT_ID
NEXT_PUBLIC_PAYMASTER_URL=https://rpc.zerodev.app/api/v2/paymaster/YOUR_PROJECT_ID

# ── Blockchain (Avalanche Mainnet) ───────────────────────────
NEXT_PUBLIC_AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_CHAIN_ID=43114

# ── Backend API ──────────────────────────────────────────────
NEXT_PUBLIC_BACKEND_URL=https://api.snowmind.xyz
NEXT_PUBLIC_API_KEY=your_api_key_matching_backend

# ── Contract Addresses (Avalanche Mainnet) ───────────────────
NEXT_PUBLIC_USDC_ADDRESS=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
NEXT_PUBLIC_REGISTRY_ADDRESS=0x_YOUR_DEPLOYED_REGISTRY_ADDRESS
NEXT_PUBLIC_AAVE_POOL_ADDRESS=0x794a61358D6845594F94dc1DB02A252b5b4814aD
NEXT_PUBLIC_BENQI_POOL_ADDRESS=0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
NEXT_PUBLIC_EULER_VAULT_ADDRESS=0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
NEXT_PUBLIC_SPARK_VAULT_ADDRESS=0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
NEXT_PUBLIC_TREASURY_ADDRESS=0x_YOUR_GNOSIS_SAFE_MULTISIG_ADDRESS
```

**Important**: `NEXT_PUBLIC_CHAIN_ID=43114` is the master switch. When set to `43114`, the entire frontend uses Avalanche mainnet (chain, explorer, Pimlico URLs, etc.). Set it to `43113` to switch back to Fuji testnet.

### 4C. Execution Service (runs alongside backend on Railway)

```bash
PIMLICO_API_KEY=your_pimlico_api_key
ZERODEV_PROJECT_ID=your_zerodev_project_id
AVALANCHE_CHAIN_ID=43114
INTERNAL_SERVICE_KEY=your_shared_secret_matching_backend
```

---

## 5. Supabase Migrations

Create a **fresh Supabase project** for production. Do NOT reuse the testnet project (it has test data).

Run these 5 migrations **in order** in the Supabase SQL Editor (Dashboard → SQL Editor → New query):

### Migration 1: Initial Schema

```sql
-- 001_initial_schema.sql
-- Core tables: accounts, session_keys, allocations, rebalance_logs, rate_snapshots,
-- scheduler_locks, protocol_health, session_key_audit + RLS policies + indexes.

CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address         TEXT NOT NULL UNIQUE,
  owner_address   TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  risk_tolerance  TEXT DEFAULT 'moderate',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID REFERENCES accounts(id) ON DELETE CASCADE,
  serialized_permission TEXT NOT NULL,
  session_key_address   TEXT,
  key_address           TEXT NOT NULL,
  expires_at            TIMESTAMPTZ NOT NULL,
  is_active             BOOLEAN DEFAULT true,
  allowed_protocols     TEXT[] NOT NULL,
  max_amount_per_tx     TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID REFERENCES accounts(id) ON DELETE CASCADE,
  protocol_id       TEXT NOT NULL,
  amount_usdc       DECIMAL(20, 6) NOT NULL,
  allocation_pct    DECIMAL(5, 4) NOT NULL,
  apy_at_allocation DECIMAL(8, 6),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rebalance_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID REFERENCES accounts(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,
  skip_reason           TEXT,
  proposed_allocations  JSONB,
  executed_allocations  JSONB,
  apr_improvement       DECIMAL(8, 6),
  gas_cost_usd          DECIMAL(10, 6),
  tx_hash               TEXT,
  error_message         TEXT,
  correlation_id        TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id      TEXT NOT NULL,
  apy              DECIMAL(8, 6) NOT NULL,
  tvl_usd          DECIMAL(20, 2),
  utilization_rate DECIMAL(5, 4),
  source           TEXT NOT NULL,
  snapshot_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  key        TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS protocol_health (
  protocol_id       TEXT PRIMARY KEY,
  consecutive_fails INT DEFAULT 0,
  last_fail_at      TIMESTAMPTZ,
  is_excluded       BOOLEAN DEFAULT false,
  excluded_reason   TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

INSERT INTO protocol_health (protocol_id) VALUES ('aave_v3'), ('benqi'), ('euler_v2')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS session_key_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,
  key_address    TEXT,
  ip_address     TEXT,
  detail         JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_address);
CREATE INDEX IF NOT EXISTS idx_accounts_address ON accounts(address);
CREATE INDEX IF NOT EXISTS idx_allocations_account ON allocations(account_id);
CREATE INDEX IF NOT EXISTS idx_rebalance_logs_account_time ON rebalance_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_snapshots_protocol_time ON rate_snapshots(protocol_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_keys_account_active ON session_keys(account_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_session_key_audit_account_time ON session_key_audit(account_id, created_at DESC);

-- Row-Level Security
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebalance_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_key_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_account_read" ON accounts FOR SELECT
  USING (owner_address = lower(current_setting('app.user_address', true)));
CREATE POLICY "service_account_write" ON accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "service_account_update" ON accounts FOR UPDATE USING (true);

CREATE POLICY "own_allocations_read" ON allocations FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE owner_address = lower(current_setting('app.user_address', true))));

CREATE POLICY "own_logs_read" ON rebalance_logs FOR SELECT
  USING (account_id IN (SELECT id FROM accounts WHERE owner_address = lower(current_setting('app.user_address', true))));

CREATE POLICY "public_rates_read" ON rate_snapshots FOR SELECT USING (true);

CREATE POLICY "deny_public_session_keys" ON session_keys FOR SELECT USING (false);

-- Migration helpers
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_keys' AND column_name = 'encrypted_key') THEN
    ALTER TABLE session_keys RENAME COLUMN encrypted_key TO serialized_permission;
  END IF;
END $$;

ALTER TABLE session_keys ADD COLUMN IF NOT EXISTS session_key_address TEXT;
ALTER TABLE rebalance_logs ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- Maintenance
CREATE OR REPLACE FUNCTION cleanup_old_rates() RETURNS void AS $$
  DELETE FROM rate_snapshots WHERE snapshot_at < NOW() - INTERVAL '7 days';
$$ LANGUAGE sql;
```

### Migration 2: Diversification Preference

```sql
-- 002_add_diversification_preference.sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS diversification_preference TEXT DEFAULT 'balanced';
ALTER TABLE accounts DROP COLUMN IF EXISTS risk_tolerance;
```

### Migration 3: Spark Protocol

```sql
-- 003_add_spark_protocol.sql
INSERT INTO protocol_health (protocol_id) VALUES ('spark') ON CONFLICT DO NOTHING;
```

### Migration 4: Daily APY Snapshots

```sql
-- 004_daily_apy_snapshots.sql
CREATE TABLE IF NOT EXISTS daily_apy_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    protocol_id TEXT NOT NULL,
    date DATE NOT NULL,
    apy NUMERIC NOT NULL,
    tvl_usd NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(protocol_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_apy_protocol_date
    ON daily_apy_snapshots (protocol_id, date DESC);
```

### Migration 5: Yield Tracking (Fee System)

```sql
-- 005_account_yield_tracking.sql
CREATE TABLE IF NOT EXISTS account_yield_tracking (
    account_id UUID PRIMARY KEY REFERENCES accounts(id),
    total_deposited_usdc NUMERIC NOT NULL DEFAULT 0,
    total_withdrawn_usdc NUMERIC NOT NULL DEFAULT 0,
    total_fees_collected_usdc NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. Deployment Steps

### Step 1: Deploy SnowMindRegistry Contract

The Registry is a simple on-chain logging contract. It records rebalance events.

```bash
cd contracts

# Install Foundry dependencies (if not already done)
forge install

# Set your deployer private key (EOA with some AVAX for gas)
export DEPLOYER_PRIVATE_KEY=0x_your_private_key_with_avax

# Deploy to Avalanche mainnet
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url https://api.avax.network/ext/bc/C/rpc \
  --broadcast \
  --verify

# The script will print the deployed Registry address.
# Copy it → set as REGISTRY_CONTRACT_ADDRESS in env vars.
```

**Gas cost**: ~0.01-0.05 AVAX (~$0.30-1.50 depending on gas prices).

**After deployment**: Transfer ownership of the Registry to your Gnosis Safe multisig (see Step 2).

### Step 2: Create Gnosis Safe Multisig

1. Go to [https://safe.global/](https://safe.global/)
2. Connect your wallet → Select **Avalanche** network
3. Create a new Safe with **2/3 signers** minimum (you + trusted co-founders or advisors)
4. Note the Safe address → set as `TREASURY_ADDRESS` in backend env vars
5. Transfer Registry ownership to the Safe address

### Step 3: Create Production Supabase Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Create a **new project** (do NOT reuse testnet project)
3. Copy the **Project URL** → `SUPABASE_URL`
4. Copy the **Service Role Key** (Settings → API → service_role) → `SUPABASE_SERVICE_KEY`
5. Open the **SQL Editor** and run all 5 migrations from Section 5 above, **in order**

### Step 4: Configure Pimlico for Mainnet

1. Go to [https://dashboard.pimlico.io/](https://dashboard.pimlico.io/)
2. Ensure your API key supports **Avalanche** (chain ID 43114), not just Avalanche Fuji
3. If you have a Fuji-only key, create a new one or upgrade the existing key
4. The backend automatically constructs the Pimlico URL:
   - Mainnet: `https://api.pimlico.io/v2/avalanche/rpc?apikey=YOUR_KEY`
   - Testnet: `https://api.pimlico.io/v2/avalanche-fuji/rpc?apikey=YOUR_KEY`

### Step 5: Configure ZeroDev for Mainnet

1. Go to [https://dashboard.zerodev.app/](https://dashboard.zerodev.app/)
2. Create a new project or update your existing one to support **Avalanche mainnet** (chain ID 43114)
3. Copy the Project ID → `ZERODEV_PROJECT_ID` (both backend and frontend)
4. Get your bundler and paymaster URLs:
   - `NEXT_PUBLIC_BUNDLER_URL=https://rpc.zerodev.app/api/v2/bundler/YOUR_PROJECT_ID`
   - `NEXT_PUBLIC_PAYMASTER_URL=https://rpc.zerodev.app/api/v2/paymaster/YOUR_PROJECT_ID`
5. Ensure your paymaster policy covers mainnet operations (gas sponsorship)

### Step 6: Deploy Backend to Railway

1. Push the `dev` branch to GitHub
2. In Railway, create a **new environment** called "production" (or update the existing one)
3. Set all environment variables from Section 4A
4. Ensure the backend and execution service are both running
5. Set a custom domain: `api.snowmind.xyz`

### Step 7: Deploy Frontend to Vercel

1. In Vercel, go to your project settings
2. Set all environment variables from Section 4B
3. Set the production branch to `dev` (or merge `dev` → `main` first)
4. Set custom domain: `app.snowmind.xyz` or `www.snowmind.xyz`
5. Deploy

### Step 8: Verify End-to-End

Run through the full flow with a small amount ($10-50 of real USDC):

1. Visit the frontend → connect wallet → create smart account
2. Deposit a small amount of USDC
3. Approve session key (30-day duration)
4. Wait for scheduler to run (or trigger manual rebalance via API)
5. Check dashboard — allocations should appear
6. Try emergency withdrawal — verify fee breakdown is shown
7. Check Snowtrace for transaction hashes

---

## 7. Manual Steps (Require External Access)

These cannot be done by code — you need to use external dashboards:

### 7A. Get AVAX for Gas

You need a small amount of AVAX in your deployer EOA to deploy the Registry contract.

- Buy AVAX on an exchange (Coinbase, Binance, etc.)
- Send ~0.1 AVAX to your deployer address
- Or use a bridge if you have ETH: [https://core.app/bridge/](https://core.app/bridge/)

### 7B. Privy Configuration

1. Go to [https://dashboard.privy.io/](https://dashboard.privy.io/)
2. Ensure your app is configured for production (not development mode)
3. Add your production domain (`www.snowmind.xyz`) to the allowed origins
4. Copy the App ID and App Secret

### 7C. RPC Provider (Optional but Recommended)

The public RPC (`https://api.avax.network/ext/bc/C/rpc`) works but may rate-limit under load. For production reliability:

1. Sign up at [Infura](https://infura.io), [Alchemy](https://alchemy.com), or [QuickNode](https://quicknode.com)
2. Create an Avalanche C-Chain endpoint
3. Set `AVALANCHE_RPC_URL` and `NEXT_PUBLIC_AVALANCHE_RPC_URL` to your dedicated endpoint

### 7D. Monitoring (Recommended)

- **Sentry**: Add error tracking for both backend (Python) and frontend (Next.js)
- **Discord/Telegram Webhook**: Set up alerts for rebalance failures, circuit breaker triggers, and rate anomalies

---

## 8. Fork Testing

Run these tests to verify protocol adapters work against real mainnet contracts. No gas or private key needed — they only make read-only RPC calls.

```bash
cd apps/backend

# Install test dependencies
pip install pytest pytest-asyncio

# Run fork tests against mainnet
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc \
  pytest tests/fork/test_mainnet_adapters.py -v -s
```

### What the fork tests verify:

1. **Aave V3**: `getReserveData()` returns a valid APY (0-25%) and TVL > $1M for USDC
2. **Benqi**: `supplyRatePerTimestamp()` returns a valid APY and `exchangeRateCurrent()` > 0
3. **Cross-protocol**: Both adapters return rates simultaneously via `RateFetcher`
4. **Waterfall allocator**: Produces valid allocations using real mainnet APY data

### Expected output:

```
  Aave V3 USDC APY: 2.8431%
  Aave V3 USDC TVL: $142,567,890

  Benqi USDC APY: 3.2104%
  Benqi USDC TVL: $45,123,456

  Waterfall result (status=optimal):
    benqi: $5,000.00
  Expected APY: 3.2104%
```

---

## 9. Verification Checklist

Before going live, verify each item:

### Infrastructure
- [ ] Fresh Supabase production project created (no testnet data)
- [ ] All 5 migrations run successfully in order
- [ ] Railway backend deployed with all env vars set
- [ ] Vercel frontend deployed with all env vars set
- [ ] Execution service running alongside backend
- [ ] Custom domains configured (api.snowmind.xyz, app.snowmind.xyz)

### Blockchain
- [ ] SnowMindRegistry deployed on Avalanche mainnet
- [ ] Registry address set in env vars (both backend and frontend)
- [ ] Gnosis Safe multisig created → set as TREASURY_ADDRESS
- [ ] Registry ownership transferred to multisig
- [ ] Pimlico API key works on Avalanche mainnet (not just Fuji)
- [ ] ZeroDev project configured for Avalanche mainnet

### Protocol Adapters
- [ ] Fork tests pass (`pytest tests/fork/test_mainnet_adapters.py`)
- [ ] Aave V3 adapter returns valid APY from mainnet
- [ ] Benqi adapter returns valid APY from mainnet
- [ ] Rate validator cross-checks pass against DefiLlama

### Security
- [ ] Session keys use 30-day duration (not 100 years)
- [ ] Platform deposit cap enforced ($50K)
- [ ] IS_TESTNET=false in production env
- [ ] DEPLOYER_PRIVATE_KEY is empty in production
- [ ] All secrets are unique between environments
- [ ] CORS only allows production domains

### End-to-End Flow
- [ ] Smart account deploys successfully on mainnet
- [ ] USDC deposit + approve works
- [ ] Session key creation works (30-day expiry)
- [ ] Scheduler runs and produces rebalance decisions
- [ ] Rebalance execution submits UserOp on mainnet
- [ ] Explorer links point to snowtrace.io (not testnet)
- [ ] Emergency withdrawal works with fee breakdown
- [ ] Platform capacity endpoint returns correct numbers

### Unit Tests
- [ ] All existing unit tests pass (`pytest tests/unit/ -v`)
- [ ] Waterfall allocator tests pass with spark as base layer

---

## Quick Reference: What Changed from Testnet

| Aspect | Testnet (Before) | Mainnet (Now) |
|--------|------------------|---------------|
| Chain ID | 43113 (Fuji) | 43114 (Mainnet) |
| RPC | api.avax-test.network | api.avax.network |
| USDC | Testnet USDC (faucet) | Native USDC (real money) |
| Aave Pool | Fuji mock | `0x794a...814aD` (real) |
| Benqi Pool | Mock contract | `0xB715...AE9C` (real) |
| Explorer | testnet.snowtrace.io | snowtrace.io |
| Session key | 100 years (dev) | 30 days (production) |
| Pimlico URL | avalanche-fuji | avalanche |
| Active protocols | aave_v3, benqi, euler_v2, spark | aave_v3, benqi, euler_v2, spark |
| Deposit cap | None | $50,000 total (guarded beta) |
| Fee | None active | 10% on profits at withdrawal |
| Faucet | FujiTestFaucet component | Deleted |
| Base layer | spark | spark |
| Optimizer | MILP (PuLP) | Waterfall allocator |
