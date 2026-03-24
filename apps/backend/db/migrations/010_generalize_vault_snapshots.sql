-- 010_generalize_vault_snapshots.sql
-- Extend spark_convert_snapshots to support ALL ERC-4626 vaults (Euler, Silo).
-- Enables stable 24h APY calculation for all share-price-growth adapters.
-- Safe to re-run (all statements are idempotent).

-- Add protocol_id column. Existing Spark rows default to 'spark'.
ALTER TABLE spark_convert_snapshots
    ADD COLUMN IF NOT EXISTS protocol_id TEXT NOT NULL DEFAULT 'spark';

-- New index for per-protocol lookups (the main query pattern)
CREATE INDEX IF NOT EXISTS idx_vault_snapshots_pid_at
    ON spark_convert_snapshots (protocol_id, snapshot_at DESC);
