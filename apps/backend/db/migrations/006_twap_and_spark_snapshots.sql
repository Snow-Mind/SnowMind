-- 006_twap_and_spark_snapshots.sql
-- Creates the twap_snapshots and spark_convert_snapshots tables
-- referenced by rate_fetcher.py but missing from prior migrations.
-- Safe to re-run (all statements are idempotent).

-- ═══════════════════════════════════════════════════════════════
-- 1. TWAP Snapshots — in-memory TWAP buffer persistence
-- ═══════════════════════════════════════════════════════════════
-- rate_fetcher.py TWAPBuffer persists snapshots here so the buffer
-- survives backend restarts. Columns match TWAPSnapshot dataclass.

CREATE TABLE IF NOT EXISTS twap_snapshots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    protocol_id      TEXT NOT NULL,
    apy              NUMERIC NOT NULL,
    effective_apy    NUMERIC NOT NULL,
    tvl_usd          NUMERIC,
    utilization_rate NUMERIC,
    fetched_at       DOUBLE PRECISION NOT NULL,  -- Unix epoch seconds
    created_at       TIMESTAMPTZ DEFAULT now()
);

-- Primary query: latest N per protocol ordered by fetched_at DESC
CREATE INDEX IF NOT EXISTS idx_twap_snapshots_protocol_fetched
    ON twap_snapshots (protocol_id, fetched_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 2. Spark convertToAssets daily snapshots
-- ═══════════════════════════════════════════════════════════════
-- Spark APY is derived from: (today_value - yesterday_value) / yesterday_value × 365
-- rate_fetcher.py saves one row per day and queries yesterday's value.

CREATE TABLE IF NOT EXISTS spark_convert_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    convert_to_assets_value NUMERIC NOT NULL,
    snapshot_at             TIMESTAMPTZ DEFAULT now()
);

-- Query: latest row ≤ yesterday
CREATE INDEX IF NOT EXISTS idx_spark_convert_snapshot_at
    ON spark_convert_snapshots (snapshot_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 3. RLS — service-role only (no frontend access needed)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE twap_snapshots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE spark_convert_snapshots ENABLE ROW LEVEL SECURITY;

-- Deny all anon/public access — only service_role backend reads/writes
CREATE POLICY "deny_public_twap" ON twap_snapshots
    FOR SELECT USING (false);

CREATE POLICY "deny_public_spark_convert" ON spark_convert_snapshots
    FOR SELECT USING (false);
