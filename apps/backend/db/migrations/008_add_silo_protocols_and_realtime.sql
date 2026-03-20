-- 008_add_silo_protocols_and_realtime.sql
-- Adds Silo protocol entries, enables Supabase Realtime for frontend
-- subscriptions, and adds data retention helpers.
-- Safe to re-run (all statements are idempotent).

-- ═══════════════════════════════════════════════════════════════
-- 1. Seed protocol_health for Silo markets
-- ═══════════════════════════════════════════════════════════════

INSERT INTO protocol_health (protocol_id) VALUES ('silo_savusd_usdc')
ON CONFLICT DO NOTHING;

INSERT INTO protocol_health (protocol_id) VALUES ('silo_susdp_usdc')
ON CONFLICT DO NOTHING;

-- Also ensure spark is present (migration 003 should have added it,
-- but ON CONFLICT DO NOTHING makes this safe).
INSERT INTO protocol_health (protocol_id) VALUES ('spark')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. Supabase Realtime — enable for frontend WebSocket subscriptions
-- ═══════════════════════════════════════════════════════════════
-- The frontend useRealtimePortfolio hook subscribes to:
--   - INSERT on rebalance_logs (toast notifications)
--   - UPDATE on allocations (portfolio refresh)
-- These tables must be added to the supabase_realtime publication.
--
-- Note: supabase_realtime publication is created automatically by
-- Supabase. ALTER PUBLICATION is idempotent for ADD TABLE.

DO $$
BEGIN
    -- Check if the publication exists (it always does on Supabase)
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        -- Add tables to the realtime publication (idempotent — ignores if already added)
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE rebalance_logs;
        EXCEPTION WHEN duplicate_object THEN
            NULL;  -- Already in publication
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE allocations;
        EXCEPTION WHEN duplicate_object THEN
            NULL;  -- Already in publication
        END;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. RLS for daily_apy_snapshots (was missing)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE daily_apy_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read — APY data is not sensitive (same as rate_snapshots)
CREATE POLICY "public_daily_apy_read" ON daily_apy_snapshots
    FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 4. RLS for scheduler_locks and protocol_health (missing)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE scheduler_locks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_health  ENABLE ROW LEVEL SECURITY;

-- Service-role only — no public access
CREATE POLICY "deny_public_scheduler_locks" ON scheduler_locks
    FOR SELECT USING (false);
CREATE POLICY "deny_public_protocol_health" ON protocol_health
    FOR SELECT USING (false);

-- ═══════════════════════════════════════════════════════════════
-- 5. Data retention — index for cleanup queries
-- ═══════════════════════════════════════════════════════════════
-- Old rate_snapshots and twap_snapshots should be pruned periodically.
-- These indexes support efficient DELETE WHERE snapshot_at < cutoff.

CREATE INDEX IF NOT EXISTS idx_rate_snapshots_snapshot_at
    ON rate_snapshots (snapshot_at);

CREATE INDEX IF NOT EXISTS idx_twap_snapshots_created_at
    ON twap_snapshots (created_at);

-- ═══════════════════════════════════════════════════════════════
-- 6. Retention cleanup function (optional — call via pg_cron or scheduler)
-- ═══════════════════════════════════════════════════════════════
-- Keeps 30 days of rate_snapshots, 7 days of twap_snapshots,
-- and 90 days of rebalance_logs.

CREATE OR REPLACE FUNCTION snowmind_cleanup_old_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- rate_snapshots: keep 30 days
    DELETE FROM rate_snapshots
    WHERE snapshot_at < now() - INTERVAL '30 days';

    -- twap_snapshots: keep 7 days (only needed for TWAP buffer restore)
    DELETE FROM twap_snapshots
    WHERE created_at < now() - INTERVAL '7 days';

    -- spark_convert_snapshots: keep 90 days
    DELETE FROM spark_convert_snapshots
    WHERE snapshot_at < now() - INTERVAL '90 days';

    -- rebalance_logs: keep 90 days of non-executed logs
    -- (executed logs kept indefinitely for audit)
    DELETE FROM rebalance_logs
    WHERE status = 'skipped'
      AND created_at < now() - INTERVAL '90 days';

    -- session_key_audit: keep 90 days
    DELETE FROM session_key_audit
    WHERE created_at < now() - INTERVAL '90 days';
END;
$$;

-- Schedule: call this daily via Supabase pg_cron or from the Python scheduler:
--   SELECT snowmind_cleanup_old_data();
