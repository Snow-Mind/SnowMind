-- SnowMind Supabase schema
-- Run this in the Supabase SQL Editor to bootstrap all tables.
-- Service role (backend) bypasses RLS automatically.
-- Frontend uses anon key — RLS policies below apply to anon key only.

-- ═══════════════════════════════════════════════════════════════
-- 1. TABLES
-- ═══════════════════════════════════════════════════════════════

-- ── Accounts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address         TEXT NOT NULL UNIQUE,         -- Smart account address (checksummed)
  owner_address   TEXT NOT NULL,               -- EOA owner address
  is_active       BOOLEAN DEFAULT true,
  risk_tolerance  TEXT DEFAULT 'moderate',     -- conservative | moderate | aggressive
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Session Keys ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID REFERENCES accounts(id) ON DELETE CASCADE,
  serialized_permission TEXT NOT NULL,        -- Serialized permission account (NOT raw private key)
  session_key_address   TEXT,                 -- The session key's own address
  key_address           TEXT NOT NULL,         -- Legacy column, kept for migration compat
  expires_at            TIMESTAMPTZ NOT NULL,
  is_active             BOOLEAN DEFAULT true,
  allowed_protocols     TEXT[] NOT NULL,
  max_amount_per_tx     TEXT NOT NULL,         -- BigInt as string
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── Allocations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID REFERENCES accounts(id) ON DELETE CASCADE,
  protocol_id       TEXT NOT NULL,            -- 'benqi', 'aave_v3', etc.
  amount_usdc       DECIMAL(20, 6) NOT NULL,
  allocation_pct    DECIMAL(5, 4) NOT NULL,
  apy_at_allocation DECIMAL(8, 6),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Rebalance Logs ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rebalance_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID REFERENCES accounts(id) ON DELETE CASCADE,
  status                TEXT NOT NULL,        -- 'executed', 'skipped', 'failed'
  skip_reason           TEXT,
  proposed_allocations  JSONB,
  executed_allocations  JSONB,
  apr_improvement       DECIMAL(8, 6),
  gas_cost_usd          DECIMAL(10, 6),
  tx_hash               TEXT,
  error_message         TEXT,
  correlation_id        TEXT,                 -- Links related operations
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── Rate Snapshots ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_snapshots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id      TEXT NOT NULL,
  apy              DECIMAL(8, 6) NOT NULL,
  tvl_usd          DECIMAL(20, 2),
  utilization_rate DECIMAL(5, 4),
  source           TEXT NOT NULL,             -- 'on_chain' or 'defillama'
  snapshot_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Scheduler Locks (distributed locking for cron) ──────────
CREATE TABLE IF NOT EXISTS scheduler_locks (
  key        TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- ── Protocol Health Tracking (circuit breaker state) ────────
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

-- ── Session Key Audit Log ───────────────────────────────────
CREATE TABLE IF NOT EXISTS session_key_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID REFERENCES accounts(id) ON DELETE CASCADE,
  action         TEXT NOT NULL,               -- 'used', 'rotated', 'revoked'
  key_address    TEXT,
  ip_address     TEXT,
  detail         JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- 2. INDEXES
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_accounts_owner
  ON accounts(owner_address);

CREATE INDEX IF NOT EXISTS idx_accounts_address
  ON accounts(address);

CREATE INDEX IF NOT EXISTS idx_allocations_account
  ON allocations(account_id);

CREATE INDEX IF NOT EXISTS idx_rebalance_logs_account_time
  ON rebalance_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_snapshots_protocol_time
  ON rate_snapshots(protocol_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_keys_account_active
  ON session_keys(account_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_session_key_audit_account_time
  ON session_key_audit(account_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 3. ROW-LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════
-- Service role (backend) bypasses RLS automatically.
-- These policies restrict the anon key (frontend direct queries).

ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebalance_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_key_audit ENABLE ROW LEVEL SECURITY;

-- ── accounts: users read their own account only ─────────────
CREATE POLICY "own_account_read" ON accounts
  FOR SELECT
  USING (owner_address = lower(current_setting('app.user_address', true)));

CREATE POLICY "service_account_write" ON accounts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "service_account_update" ON accounts
  FOR UPDATE USING (true);

-- ── allocations: linked through account ownership ───────────
CREATE POLICY "own_allocations_read" ON allocations
  FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE owner_address = lower(current_setting('app.user_address', true))
    )
  );

-- ── rebalance_logs: same ownership chain ────────────────────
CREATE POLICY "own_logs_read" ON rebalance_logs
  FOR SELECT
  USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE owner_address = lower(current_setting('app.user_address', true))
    )
  );

-- ── rate_snapshots: public read (no sensitive data) ─────────
CREATE POLICY "public_rates_read" ON rate_snapshots
  FOR SELECT USING (true);

-- ── session_keys: NEVER accessible from frontend ────────────
-- No SELECT policy = anon key gets empty results always.
-- Only service_role key (backend) can read session_keys.
CREATE POLICY "deny_public_session_keys" ON session_keys
  FOR SELECT USING (false);

-- ═══════════════════════════════════════════════════════════════
-- 4. MIGRATION HELPERS (safe to re-run)
-- ═══════════════════════════════════════════════════════════════

-- Rename encrypted_key → serialized_permission (if migrating from old schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'session_keys' AND column_name = 'encrypted_key'
  ) THEN
    ALTER TABLE session_keys RENAME COLUMN encrypted_key TO serialized_permission;
  END IF;
END $$;

-- Add session_key_address if not present
ALTER TABLE session_keys
  ADD COLUMN IF NOT EXISTS session_key_address TEXT;

-- Add correlation_id to rebalance_logs if not present
ALTER TABLE rebalance_logs
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- ═══════════════════════════════════════════════════════════════
-- 5. MAINTENANCE FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Auto-cleanup rate snapshots older than 7 days
CREATE OR REPLACE FUNCTION cleanup_old_rates() RETURNS void AS $$
  DELETE FROM rate_snapshots WHERE snapshot_at < NOW() - INTERVAL '7 days';
$$ LANGUAGE sql;
