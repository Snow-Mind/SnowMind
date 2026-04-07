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

SnowMind is a **yield optimizer** for USDC on Avalanche. Users deposit USDC, and an AI-driven agent automatically moves their funds between DeFi protocols (Aave V3, Benqi, Spark, Euler (9Summits), Silo markets, and Folks Finance xChain) to earn the highest safe yield.

### The Flow

1. **User connects wallet** → Privy handles authentication (social login or wallet).
2. **Smart account is created** → ZeroDev deploys an ERC-4337 smart account for the user on Avalanche. The user's EOA (MetaMask/embedded wallet) is the owner.
3. **User deposits USDC** → Transfers native USDC into their smart account and approves a **session key** (infinite on-chain lifetime, revocable anytime) that allows SnowMind's backend to move funds between whitelisted protocols on their behalf.
4. **The Waterfall Allocator runs every 30 minutes** → It checks current APYs, picks the best protocol, and decides if a rebalance is worth the gas cost.
5. **If a rebalance is needed** → The backend calls the Node.js execution service, which uses the session key to submit a UserOperation (ERC-4337) via ZeroDev's bundler. Funds move from one protocol to another in a single transaction. ZeroDev's paymaster sponsors the gas cost (zero-cost for users).
6. **User withdraws anytime** → Emergency withdrawal pulls all funds back to the smart account. A 10% fee is charged only on profits (yield earned), not on principal.

### The Waterfall Allocator

Instead of a complex mathematical optimizer, SnowMind uses an **APY-ranked waterfall** strategy:

- All healthy protocols are ranked by effective TWAP APY each cycle.
- Aave V3, Benqi, Euler (9Summits), Silo markets, and Folks apply TVL caps (max 15% of protocol TVL).
- Spark (spUSDC) has no protocol-level TVL cap on Avalanche; liquidity safety is enforced via vault buffer + PSM3 checks.
- User exposure caps still limit concentration at the account level.

**Example:**
- Aave V3 APY: 3.0%, Benqi APY: 4.2% → Benqi beats Aave by 1.2% > 0.5% margin → Funds go to Benqi.
- Aave V3 APY: 3.0%, Benqi APY: 3.3% → Benqi beats Aave by 0.3% < 0.5% margin → Funds stay in Aave V3.

### Safety Features

- **Rate validation**: Cross-checks on-chain rates against DefiLlama as a soft signal. Divergence >2% is logged as a warning.
- **TWAP smoothing**: Uses 15-minute time-weighted average prices, not instantaneous rates (prevents manipulation).
- **30-day APY averaging**: Rebalance decisions use 30-day moving averages when available.
- **Minimum interval**: At least 6 hours between rebalances.
- **Gas gate**: Rebalance only happens if the expected yield improvement exceeds gas cost.
- **Platform deposit cap**: $50K total across all users during guarded beta launch.
- **Session key scope**: Session keys have infinite on-chain lifetime. Users can revoke at any time. Max 20 ops/day.

### Fee Model

- **No deposit fee** — users deposit and withdraw freely.
- **10% agent fee on profits only** — if you deposit $10,000 and withdraw $10,500, the fee is 10% of $500 = $50. You receive $10,450. The fee is transferred atomically to the SnowMind treasury (Gnosis Safe) in the same transaction as the withdrawal.
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
│  Rate Fetcher → Aave + Benqi + Spark + Euler + Silo + Folks rates │
│  Rate Validator → TWAP + DefiLlama cross-check          │
│  Fee Calculator → 10% profit fee on withdrawal          │
└────────┬──────────────────────┬─────────────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌─────────────────────────────────┐
│   Supabase DB   │   │   Execution Service (Node.js)   │
│                 │   │   localhost:3001 (Railway)       │
│  accounts       │   │                                 │
│  session_keys   │   │   ZeroDev SDK → ZeroDev RPC     │
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
                      │  Spark spUSDC (ERC-4626 vault)   │
                      │  Euler V2 / 9Summits (ERC-4626)  │
                      │  Silo savUSD/sUSDp/Gami (ERC-4626)│
                      │  Folks spoke contracts/hub pool   │
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
| Execution Service | Node.js, ZeroDev SDK | Dedicated apps/execution service that verifies signed backend requests, blocks replay, and submits UserOperations |
| Database | Supabase (PostgreSQL) | Accounts, allocations, logs, rate history |
| Bundler & Paymaster | ZeroDev | Bundles ERC-4337 UserOps + gas sponsorship |
| Smart Accounts | ZeroDev (Kernel v3) | ERC-4337 smart accounts with session key support |
| Auth | Privy | Social login + embedded wallets |

### Internal Execution Request Security

- Backend to execution calls are HMAC-SHA256 signed using INTERNAL_SERVICE_KEY.
- Signature input: method, path, timestamp, nonce, and canonical JSON body.
- Execution service rejects missing/invalid signatures.
- Replay protection:
  - Timestamp freshness window enforced via INTERNAL_REQUEST_TTL_SECONDS.
  - Nonce cache blocks duplicate nonces inside the TTL window.

---

## 3. Mainnet Contract Addresses

These are **hardcoded defaults** in the codebase. Override via environment variables for different networks.

| Contract | Address | Network |
|----------|---------|---------|
| **Native USDC** | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Avalanche C-Chain |
| **Aave V3 Pool** | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | Avalanche C-Chain |
| **Benqi qiUSDCn** | `0xB715808a78F6041E46d61Cb123C9B4A27056AE9C` | Avalanche C-Chain |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Avalanche C-Chain |
| **SnowMindRegistry** | `0x849Ca487D5DeD85c93fc3600338a419B100833a8` | Avalanche C-Chain |
| **Spark spUSDC** | `0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d` | Avalanche C-Chain |
| **Euler V2 / 9Summits Vault** | `0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e` | Avalanche C-Chain |
| **Silo savUSD/USDC** | `0x33fAdB3dB0A1687Cdd4a55AB0afa94c8102856A1` | Avalanche C-Chain |
| **Silo sUSDp/USDC** | `0xcd0d510eec4792a944E8dbe5da54DDD6777f02Ca` | Avalanche C-Chain |
| **Silo V3 Gami USDC** | `0x1F0570a081FeE0e4dF6eAC470f9d2D53CDEDa1c5` | Avalanche C-Chain |
| **Folks Spoke Common** | `0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6` | Avalanche C-Chain |
| **Folks Spoke USDC** | `0xcD68014c002184707eaE7218516cB0762A44fDDF` | Avalanche C-Chain |
| **Folks USDC Hub Pool** | `0x88f15e36308ED060d8543DA8E2a5dA0810Efded2` | Avalanche C-Chain |

### Explorer

- Mainnet: `https://snowtrace.io`

---

## 4. Environment Variables

### 4A. Backend (Railway)

Set these in your Railway project's environment variables:

```bash
# ── App ──────────────────────────────────────────────────────
APP_NAME=SnowMind API
API_V1_PREFIX=/api/v1
DEBUG=false

# ── CORS ─────────────────────────────────────────────────────
ALLOWED_ORIGINS=["https://www.snowmind.xyz","https://app.snowmind.xyz"]

# ── Supabase (PRODUCTION project) ───────────────────────────
SUPABASE_URL=https://YOUR_PROD_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your_production_service_role_key...

# ── Blockchain (Avalanche Mainnet) ───────────────────────────
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
INFURA_RPC_URL=https://avalanche-mainnet.infura.io/v3/YOUR_INFURA_KEY
ALCHEMY_RPC_URL=https://avax-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
AVALANCHE_CHAIN_ID=43114
ZERODEV_PROJECT_ID=your_zerodev_project_id

# ── Contract Addresses (Avalanche Mainnet) ───────────────────
REGISTRY_CONTRACT_ADDRESS=0x_YOUR_DEPLOYED_REGISTRY_ADDRESS
AAVE_V3_POOL=0x794a61358D6845594F94dc1DB02A252b5b4814aD
BENQI_QIUSDC=0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
SPARK_SPUSDC=0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
EULER_VAULT=0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
SILO_SAVUSD_USDC_VAULT=0x33fAdB3dB0A1687Cdd4a55AB0afa94c8102856A1
SILO_SUSDP_USDC_VAULT=0xcd0d510eec4792a944E8dbe5da54DDD6777f02Ca
SILO_GAMI_USDC_VAULT=0x1F0570a081FeE0e4dF6eAC470f9d2D53CDEDa1c5
FOLKS_SPOKE_COMMON=0xc03094C4690F3844EA17ef5272Bf6376e0CF2AC6
FOLKS_SPOKE_USDC=0xcD68014c002184707eaE7218516cB0762A44fDDF
FOLKS_USDC_HUB_POOL=0x88f15e36308ED060d8543DA8E2a5dA0810Efded2
USDC_ADDRESS=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032

# ── Protocol-Specific Addresses ──────────────────────────────
SPARK_PSM3=0x7566debc906C17338524a414343FA61bca26a843
BENQI_COMPTROLLER=0x_BENQI_COMPTROLLER_ADDRESS
FOLKS_ACCOUNT_MANAGER=0x12Db9758c4D9902334C523b94e436258EB54156f
FOLKS_LOAN_MANAGER=0xF4c542518320F09943C35Db6773b2f9FeB2F847e
FOLKS_HUB_CHAIN_ID=100
FOLKS_USDC_POOL_ID=1
FOLKS_USDC_LOAN_TYPE_ID=2
FOLKS_ACCOUNT_NONCE=1
FOLKS_LOAN_NONCE=1

# ── Security ─────────────────────────────────────────────────
# Production: use KMS envelope encryption (master key never in env)
KMS_KEY_ID=your_kms_key_id
# Local fallback only; keep empty in production
SESSION_KEY_ENCRYPTION_KEY=
JWT_SECRET=your_jwt_secret
JWT_ALGORITHM=HS256
BACKEND_API_KEY=your_api_key_for_frontend

# ── Auth (Privy) ─────────────────────────────────────────────
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# ── Execution Service (dedicated apps/execution deployment) ──
# In production this should be the internal URL of the dedicated execution service.
EXECUTION_SERVICE_URL=http://execution:3001
INTERNAL_SERVICE_KEY=your_shared_secret_between_backend_and_executor
INTERNAL_REQUEST_TTL_SECONDS=300

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
BASE_LAYER_PROTOCOL_ID=aave_v3
MIN_PROTOCOL_TVL_USD=100000.0

# ── Guarded Launch ───────────────────────────────────────────
MAX_TOTAL_PLATFORM_DEPOSIT_USD=50000.0

# ── Fees ─────────────────────────────────────────────────────
AGENT_FEE_RATE=0.10
PROFIT_FEE_PCT=0.10
TREASURY_ADDRESS=0x_YOUR_GNOSIS_SAFE_MULTISIG_ADDRESS

# ── Oracle Cross-Validation ──────────────────────────────────
DEFILLAMA_BASE_URL=https://yields.llama.fi
RATE_DIVERGENCE_THRESHOLD=0.02

# ── Monitoring & Alerting ────────────────────────────────────
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
SENTRY_DSN=https://your_sentry_dsn
PAYMASTER_LOW_BALANCE_AVAX=10.0

# ── Scheduler ────────────────────────────────────────────────
SCHEDULER_LOCK_TTL_MINUTES=35

# ── Deployer (optional local deployment helper) ───────────────
DEPLOYER_PRIVATE_KEY=
```

### 4B. Frontend (Vercel)

Set these in Vercel project settings → Environment Variables:

```bash
# ── Auth (Privy) ─────────────────────────────────────────────
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id

# ── Smart Accounts (ZeroDev) ─────────────────────────────────
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your_zerodev_project_id

# ── Blockchain (Avalanche Mainnet) ───────────────────────────
NEXT_PUBLIC_AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_CHAIN_ID=43114

# ── Backend API ──────────────────────────────────────────────
NEXT_PUBLIC_BACKEND_URL=https://api.snowmind.xyz
NEXT_PUBLIC_BACKEND_API_KEY=your_api_key_matching_backend

# ── Contract Addresses (Avalanche Mainnet) ───────────────────
NEXT_PUBLIC_USDC_ADDRESS=0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
NEXT_PUBLIC_REGISTRY_ADDRESS=0x_YOUR_DEPLOYED_REGISTRY_ADDRESS
NEXT_PUBLIC_AAVE_POOL_ADDRESS=0x794a61358D6845594F94dc1DB02A252b5b4814aD
NEXT_PUBLIC_BENQI_POOL_ADDRESS=0xB715808a78F6041E46d61Cb123C9B4A27056AE9C
NEXT_PUBLIC_SPARK_VAULT_ADDRESS=0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d
NEXT_PUBLIC_EULER_VAULT_ADDRESS=0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e
NEXT_PUBLIC_TREASURY_ADDRESS=0x_YOUR_GNOSIS_SAFE_MULTISIG_ADDRESS
# ── ZeroDev (Account Abstraction) ───────────────────────────
NEXT_PUBLIC_ZERODEV_PROJECT_ID=your_zerodev_project_id

**Important**: `NEXT_PUBLIC_CHAIN_ID` must be set to `43114` in production.

### 4C. Execution Service (runs alongside backend on Railway)

```bash
ZERODEV_PROJECT_ID=your_zerodev_project_id
AVALANCHE_CHAIN_ID=43114
INTERNAL_SERVICE_KEY=your_shared_secret_matching_backend
INTERNAL_REQUEST_TTL_SECONDS=300
```

---

## 5. Supabase Migrations

Create a **fresh Supabase project** for production.

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
  allocation_caps       JSONB DEFAULT NULL,
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

INSERT INTO protocol_health (protocol_id) VALUES
  ('aave_v3'),
  ('benqi'),
  ('spark'),
  ('euler_v2'),
  ('silo_savusd_usdc'),
  ('silo_susdp_usdc'),
  ('silo_gami_usdc'),
  ('folks')
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

### Migration 3: Protocol Health Rows (Idempotent)

```sql
-- 003_add_protocol_health_rows.sql
INSERT INTO protocol_health (protocol_id) VALUES
  ('aave_v3'),
  ('benqi'),
  ('spark'),
  ('euler_v2'),
  ('silo_savusd_usdc'),
  ('silo_susdp_usdc'),
  ('silo_gami_usdc'),
  ('folks')
ON CONFLICT DO NOTHING;
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

The Registry is an on-chain logging contract with access control. It records account registrations and rebalance events. Only the owner can mutate state.

**Prerequisites:**
- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- A deployer EOA wallet with ~0.001 AVAX for gas (deployment costs ~0.00003 AVAX)
- A Snowtrace API key for contract verification (get one at https://snowtrace.io/myapikey)

```bash
cd contracts

# Install Foundry dependencies (if not already done)
forge install

# Set your deployer private key (EOA with some AVAX for gas)
export DEPLOYER_PRIVATE_KEY=0x_your_private_key_with_avax
export SNOWTRACE_API_KEY=your_snowtrace_api_key

# Deploy to Avalanche mainnet + verify on Snowtrace
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url https://api.avax.network/ext/bc/C/rpc \
  --broadcast \
  --verify \
  --etherscan-api-key $SNOWTRACE_API_KEY
```

The script will print the deployed Registry address. Example output:
```
=== MAINNET DEPLOYMENT COMPLETE ===
SnowMindRegistry: 0x849Ca487D5DeD85c93fc3600338a419B100833a8
Owner:            0x97950A98980a2Fc61ea7eb043bb7666845f77071
```

**After deployment — update these locations with the Registry address:**

| Location | Variable | Example |
|----------|----------|---------|
| **Backend env** (Railway) | `REGISTRY_CONTRACT_ADDRESS` | `0x849Ca...33a8` |
| **Frontend env** (Vercel) | `NEXT_PUBLIC_REGISTRY_ADDRESS` | `0x849Ca...33a8` |
| **Root .env** (local dev) | Both of the above | `0x849Ca...33a8` |

**Then transfer ownership to your Gnosis Safe multisig:**
```bash
cast send <REGISTRY_ADDRESS> "proposeOwnership(address)" <GNOSIS_SAFE_ADDRESS> \
  --rpc-url https://api.avax.network/ext/bc/C/rpc \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Then, from the Gnosis Safe, execute `acceptOwnership()` on the registry.

**Verify on Snowtrace:**
- Visit `https://snowtrace.io/address/<REGISTRY_ADDRESS>#code`
- Confirm the contract source is verified and ownership is transferred

### Step 2: Create Gnosis Safe Multisig

1. Go to [https://safe.global/](https://safe.global/)
2. Connect your wallet → Select **Avalanche** network
3. Create a new Safe with **2/3 signers** minimum (you + trusted co-founders or advisors)
4. Note the Safe address → set as `TREASURY_ADDRESS` in backend env vars
5. Transfer Registry ownership to the Safe address

### Step 3: Create Production Supabase Project

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Create a **new project**
3. Copy the **Project URL** → `SUPABASE_URL`
4. Copy the **Service Role Key** (Settings → API → service_role) → `SUPABASE_SERVICE_KEY`
5. Open the **SQL Editor** and run all 5 migrations from Section 5 above, **in order**

### Step 4: Configure ZeroDev for Mainnet

1. Go to [https://dashboard.zerodev.app/](https://dashboard.zerodev.app/)
2. Create a new project or update your existing one to support **Avalanche mainnet** (chain ID 43114)
3. Copy the Project ID → `ZERODEV_PROJECT_ID` (both backend and frontend)
4. Ensure your ZeroDev project has bundler/paymaster enabled for Avalanche mainnet
5. Ensure your paymaster has sufficient balance for gas sponsorship (monitor in ZeroDev dashboard)

### Step 5: Deploy Backend to Railway

1. Push the `dev` branch to GitHub
2. In Railway, create a **new environment** called "production" (or update the existing one)
3. Set all environment variables from Section 4A
4. Ensure the backend and execution service are both running
5. Set a custom domain: `api.snowmind.xyz`

### Step 7: Deploy Frontend to Vercel

1. In Vercel, go to your project settings
2. Set all environment variables from Section 4B
3. Set the production branch to `dev` (or merge `dev` → `main` first)
4. Add custom domains on the same Vercel project:
  - `www.snowmind.xyz` (marketing landing)
  - `app.snowmind.xyz` (authenticated product app)
  - `snowmind.xyz` (apex; redirects to `www.snowmind.xyz`)
5. Deploy

### Step 8: Verify End-to-End

Run through the full flow with a small amount ($10-50 of real USDC):

1. Visit the frontend → connect wallet → create smart account
2. Deposit a small amount of USDC
3. Approve session key (infinite on-chain lifetime, revocable)
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
3. Add both production web origins to allowed origins:
  - `https://www.snowmind.xyz`
  - `https://app.snowmind.xyz`
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
3. **Cross-protocol**: All active adapters return rates simultaneously via `RateFetcher`
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
- [ ] Fresh Supabase production project created
- [ ] All 5 migrations run successfully in order
- [ ] Railway backend deployed with all env vars set
- [ ] Vercel frontend deployed with all env vars set
- [ ] Execution service running alongside backend
- [ ] Custom domains configured (api.snowmind.xyz, www.snowmind.xyz, app.snowmind.xyz, docs.snowmind.xyz)

### Blockchain
- [ ] SnowMindRegistry deployed on Avalanche mainnet
- [ ] Registry address set in env vars (both backend and frontend)
- [ ] Gnosis Safe multisig created → set as TREASURY_ADDRESS
- [ ] Registry ownership transferred to multisig
- [ ] ZeroDev project configured for Avalanche mainnet with paymaster balance sufficient

### Protocol Adapters
- [ ] Fork tests pass (`pytest tests/fork/test_mainnet_adapters.py`)
- [ ] Aave V3 adapter returns valid APY from mainnet
- [ ] Benqi adapter returns valid APY from mainnet
- [ ] Spark adapter returns valid APY from mainnet (ERC-4626)
- [ ] Euler V2 (9Summits) adapter returns valid APY from mainnet (ERC-4626)
- [ ] Silo savUSD/sUSDp/Gami adapters return valid APY from mainnet
- [ ] Folks adapter returns valid APY and liquidity from mainnet
- [ ] Rate validator cross-checks pass against DefiLlama

### Security
- [ ] Session keys are scoped correctly (infinite lifetime, revocable, rate-limited)
- [ ] Platform deposit cap enforced ($50K)
- [ ] DEPLOYER_PRIVATE_KEY is empty in production
- [ ] All secrets are unique between environments
- [ ] CORS only allows production domains

### Launch Gate: Required Non-Empty Env Vars

All variables below must be set and non-empty before launch.

- [ ] Backend: `SUPABASE_URL`
- [ ] Backend: `SUPABASE_SERVICE_KEY`
- [ ] Backend: `ZERODEV_PROJECT_ID`
- [ ] Backend: `REGISTRY_CONTRACT_ADDRESS`
- [ ] Backend: `TREASURY_ADDRESS`
- [ ] Backend: `JWT_SECRET`
- [ ] Backend: `BACKEND_API_KEY`
- [ ] Backend: `INTERNAL_SERVICE_KEY`
- [ ] Backend: `PRIVY_APP_ID`
- [ ] Backend: `PRIVY_APP_SECRET`
- [ ] Frontend: `NEXT_PUBLIC_PRIVY_APP_ID`
- [ ] Frontend: `NEXT_PUBLIC_ZERODEV_PROJECT_ID`
- [ ] Frontend: `NEXT_PUBLIC_BACKEND_URL`
- [ ] Frontend: `NEXT_PUBLIC_BACKEND_API_KEY`
- [ ] Frontend: `NEXT_PUBLIC_CHAIN_ID=43114`
- [ ] Frontend: `NEXT_PUBLIC_REGISTRY_ADDRESS`
- [ ] Frontend: `NEXT_PUBLIC_TREASURY_ADDRESS`
- [ ] Execution Service: `ZERODEV_PROJECT_ID` (must match backend)
- [ ] Execution Service: `INTERNAL_SERVICE_KEY` (must exactly match backend)
- [ ] Execution Service: `INTERNAL_REQUEST_TTL_SECONDS`

Optional but strongly recommended for production security:

- [ ] Backend: `KMS_KEY_ID` configured
- [ ] Backend: `SESSION_KEY_ENCRYPTION_KEY` left empty in production

### End-to-End Flow
- [ ] Smart account deploys successfully on mainnet
- [ ] USDC deposit + approve works
- [ ] Session key creation works (infinite lifetime, revocable)
- [ ] Scheduler runs and produces rebalance decisions
- [ ] Rebalance execution submits UserOp on mainnet
- [ ] Explorer links point to snowtrace.io
- [ ] Emergency withdrawal works with fee breakdown
- [ ] Platform capacity endpoint returns correct numbers

### Unit Tests
- [ ] All existing unit tests pass (`pytest tests/unit/ -v`)
- [ ] Waterfall allocator tests pass with APY-ranked allocation rules

---

## Mainnet Readiness Notes

- Production chain: Avalanche C-Chain only (`43114`)
- Active protocols: `aave_v3`, `benqi`, `spark`, `euler_v2`, `silo_savusd_usdc`, `silo_susdp_usdc`, `silo_gami_usdc`, `folks`
- Opt-in protocols: `silo_gami_usdc`, `folks` — fully active but not enabled by default in onboarding UI (user must explicitly toggle them on)
- Euler V2 is branded as **Euler (9Summits)** in user-facing UI (the vault is curated by 9Summits on Euler V2 infra)
- Registry ownership transfer is two-step (`proposeOwnership` then Safe `acceptOwnership`)
- Fee language and user-facing disclosures should use "agent fee"
- Euler V2 and Silo vaults use ERC-4626 interface (deposit/redeem), same as Spark
- Session keys grant scoped permissions per-protocol; Euler and Silo included in call policies
- Platform deposit cap: $50K during guarded beta launch

### Risk Scores (informational, out of 9)

Risk scoring uses the 9-point model from `report.md`:

- Static/manual categories (Oracle + Collateral + Architecture) subtotal out of 5
- Dynamic categories (Liquidity + Yield Profile) add up to 4 and refresh daily

| Protocol | Static Subtotal (/5) | Dynamic Add-on (/4) | Runtime Total (/9) |
|----------|-----------------------|---------------------|--------------------|
| Aave V3 | 4 | Liquidity + Yield (daily) | Static + Dynamic |
| Benqi | 5 | Liquidity + Yield (daily) | Static + Dynamic |
| Spark | 4 | Liquidity + Yield (daily) | Static + Dynamic |
| Euler (9Summits) | 2 | Liquidity + Yield (daily) | Static + Dynamic |
| Silo (savUSD/USDC) | 4 | Liquidity + Yield (daily) | Static + Dynamic |
| Silo (sUSDp/USDC) | 3 | Liquidity + Yield (daily) | Static + Dynamic |
| Silo V3 (Gami USDC) | 0 | Liquidity + Yield (daily) | Static + Dynamic |
| Folks Finance xChain | 4 | Liquidity + Yield (daily) | Static + Dynamic |

### Referral Program Reference

- Sail.money referral program: [docs.sail.money/learn/incentives/referral-program](https://docs.sail.money/learn/incentives/referral-program)
- Competitor reference for rebalancing tiers by deposit size
