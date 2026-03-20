-- 007_fix_column_mismatches.sql
-- Fixes column name mismatches between migrations and actual code usage.
-- Safe to re-run (all statements use IF EXISTS / IF NOT EXISTS guards).

-- ═══════════════════════════════════════════════════════════════
-- 1. account_yield_tracking — rename columns to match fee_calculator.py
-- ═══════════════════════════════════════════════════════════════
-- Migration 005 defined: total_deposited_usdc, total_withdrawn_usdc, total_fees_collected_usdc
-- Code uses:             cumulative_deposited, cumulative_net_withdrawn
-- Fix: rename to match the code (code is the actual runtime contract).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_yield_tracking'
          AND column_name = 'total_deposited_usdc'
    ) THEN
        ALTER TABLE account_yield_tracking
            RENAME COLUMN total_deposited_usdc TO cumulative_deposited;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_yield_tracking'
          AND column_name = 'total_withdrawn_usdc'
    ) THEN
        ALTER TABLE account_yield_tracking
            RENAME COLUMN total_withdrawn_usdc TO cumulative_net_withdrawn;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'account_yield_tracking'
          AND column_name = 'total_fees_collected_usdc'
    ) THEN
        ALTER TABLE account_yield_tracking
            RENAME COLUMN total_fees_collected_usdc TO cumulative_fees_collected;
    END IF;
END $$;

-- Ensure defaults are NUMERIC (not integer 0)
ALTER TABLE account_yield_tracking
    ALTER COLUMN cumulative_deposited SET DEFAULT 0;
ALTER TABLE account_yield_tracking
    ALTER COLUMN cumulative_net_withdrawn SET DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 2. session_key_audit — add columns used by session_key.py
-- ═══════════════════════════════════════════════════════════════
-- Migration 001 defined: action, key_address, ip_address, detail
-- Code uses:             operation, protocol_id, amount, timestamp
-- Fix: add the code columns. Keep legacy columns for backward compat.

ALTER TABLE session_key_audit
    ADD COLUMN IF NOT EXISTS operation    TEXT;
ALTER TABLE session_key_audit
    ADD COLUMN IF NOT EXISTS protocol_id  TEXT;
ALTER TABLE session_key_audit
    ADD COLUMN IF NOT EXISTS amount       NUMERIC;
ALTER TABLE session_key_audit
    ADD COLUMN IF NOT EXISTS "timestamp"  TIMESTAMPTZ;

-- Index for the 24h anomaly detection query
CREATE INDEX IF NOT EXISTS idx_session_key_audit_account_timestamp
    ON session_key_audit (account_id, "timestamp" DESC);

-- ═══════════════════════════════════════════════════════════════
-- 3. rebalance_logs — add columns used by withdrawal.py
-- ═══════════════════════════════════════════════════════════════
-- withdrawal.py inserts from_protocol, to_protocol, amount_moved
-- but original schema didn't include them.

ALTER TABLE rebalance_logs
    ADD COLUMN IF NOT EXISTS from_protocol TEXT;
ALTER TABLE rebalance_logs
    ADD COLUMN IF NOT EXISTS to_protocol   TEXT;
ALTER TABLE rebalance_logs
    ADD COLUMN IF NOT EXISTS amount_moved  NUMERIC;

-- ═══════════════════════════════════════════════════════════════
-- 4. RLS for account_yield_tracking (was missing)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE account_yield_tracking ENABLE ROW LEVEL SECURITY;

-- Service-role only — no frontend direct access
CREATE POLICY "deny_public_yield_tracking" ON account_yield_tracking
    FOR SELECT USING (false);
