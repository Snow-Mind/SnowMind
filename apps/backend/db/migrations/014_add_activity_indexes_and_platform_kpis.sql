-- ═══════════════════════════════════════════════════════════════
-- 014_add_activity_indexes_and_platform_kpis.sql
-- Durable activity indexing + enterprise KPI snapshot storage
-- ═══════════════════════════════════════════════════════════════

-- -----------------------------------------------------------------
-- 1) Rebalance activity performance indexes
-- -----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rebalance_logs_account_status_time
  ON rebalance_logs (account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rebalance_logs_tx_hash
  ON rebalance_logs (tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rebalance_logs_account_from_protocol_time
  ON rebalance_logs (account_id, from_protocol, created_at DESC);

-- -----------------------------------------------------------------
-- 2) Backfill a funding activity row for legacy accounts
-- -----------------------------------------------------------------
-- Legacy activations often have principal recorded but no explicit funding
-- activity row. This backfills a single synthetic wallet funding row so
-- transaction feeds and audits can show a complete lifecycle.
INSERT INTO rebalance_logs (
  account_id,
  status,
  skip_reason,
  from_protocol,
  to_protocol,
  amount_moved,
  executed_allocations,
  correlation_id,
  created_at
)
SELECT
  ayt.account_id,
  'executed',
  'Historical funding reconstruction',
  'user_wallet',
  'idle',
  ayt.cumulative_deposited,
  jsonb_build_object('idle', ayt.cumulative_deposited::text),
  'backfill:historical_funding',
  COALESCE(a.created_at, now())
FROM account_yield_tracking ayt
JOIN accounts a ON a.id = ayt.account_id
LEFT JOIN rebalance_logs existing
  ON existing.account_id = ayt.account_id
 AND existing.from_protocol = 'user_wallet'
WHERE COALESCE(ayt.cumulative_deposited, 0) > 0
  AND existing.id IS NULL;

-- -----------------------------------------------------------------
-- 3) Daily platform KPI snapshots (enterprise analytics baseline)
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_kpi_snapshots (
  snapshot_date                  DATE PRIMARY KEY,
  total_users                    BIGINT NOT NULL DEFAULT 0,
  active_users                   BIGINT NOT NULL DEFAULT 0,
  accounts_with_deposits         BIGINT NOT NULL DEFAULT 0,
  current_tvl_usd                NUMERIC(20, 6) NOT NULL DEFAULT 0,
  cumulative_deposited_usd       NUMERIC(20, 6) NOT NULL DEFAULT 0,
  cumulative_net_withdrawn_usd   NUMERIC(20, 6) NOT NULL DEFAULT 0,
  cumulative_fees_collected_usd  NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_rebalances_executed      BIGINT NOT NULL DEFAULT 0,
  total_rebalances_failed        BIGINT NOT NULL DEFAULT 0,
  total_activity_rows            BIGINT NOT NULL DEFAULT 0,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_kpi_snapshots_created_at
  ON platform_kpi_snapshots (created_at DESC);

ALTER TABLE platform_kpi_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_public_platform_kpi_snapshots" ON platform_kpi_snapshots;
CREATE POLICY "deny_public_platform_kpi_snapshots" ON platform_kpi_snapshots
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- -----------------------------------------------------------------
-- 4) Live KPI view + daily snapshot function
-- -----------------------------------------------------------------
CREATE OR REPLACE VIEW platform_kpi_current AS
SELECT
  (SELECT COUNT(*)::BIGINT FROM accounts) AS total_users,
  (
    SELECT COUNT(DISTINCT account_id)::BIGINT
    FROM session_keys
    WHERE is_active = true
      AND expires_at >= now()
  ) AS active_users,
  (
    SELECT COUNT(DISTINCT account_id)::BIGINT
    FROM allocations
    WHERE protocol_id <> 'idle'
      AND amount_usdc > 0
  ) AS accounts_with_deposits,
  (
    SELECT COALESCE(SUM(amount_usdc), 0)::NUMERIC(20, 6)
    FROM allocations
    WHERE protocol_id <> 'idle'
  ) AS current_tvl_usd,
  (
    SELECT COALESCE(SUM(cumulative_deposited), 0)::NUMERIC(20, 6)
    FROM account_yield_tracking
  ) AS cumulative_deposited_usd,
  (
    SELECT COALESCE(SUM(cumulative_net_withdrawn), 0)::NUMERIC(20, 6)
    FROM account_yield_tracking
  ) AS cumulative_net_withdrawn_usd,
  (
    SELECT COALESCE(SUM(cumulative_fees_collected), 0)::NUMERIC(20, 6)
    FROM account_yield_tracking
  ) AS cumulative_fees_collected_usd,
  (
    SELECT COUNT(*)::BIGINT
    FROM rebalance_logs
    WHERE status = 'executed'
  ) AS total_rebalances_executed,
  (
    SELECT COUNT(*)::BIGINT
    FROM rebalance_logs
    WHERE status = 'failed'
  ) AS total_rebalances_failed,
  (
    SELECT COUNT(*)::BIGINT
    FROM rebalance_logs
  ) AS total_activity_rows,
  now() AS generated_at;

CREATE OR REPLACE FUNCTION snapshot_platform_kpi(target_date DATE DEFAULT CURRENT_DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO platform_kpi_snapshots (
    snapshot_date,
    total_users,
    active_users,
    accounts_with_deposits,
    current_tvl_usd,
    cumulative_deposited_usd,
    cumulative_net_withdrawn_usd,
    cumulative_fees_collected_usd,
    total_rebalances_executed,
    total_rebalances_failed,
    total_activity_rows,
    created_at,
    updated_at
  )
  SELECT
    target_date,
    c.total_users,
    c.active_users,
    c.accounts_with_deposits,
    c.current_tvl_usd,
    c.cumulative_deposited_usd,
    c.cumulative_net_withdrawn_usd,
    c.cumulative_fees_collected_usd,
    c.total_rebalances_executed,
    c.total_rebalances_failed,
    c.total_activity_rows,
    now(),
    now()
  FROM platform_kpi_current c
  ON CONFLICT (snapshot_date) DO UPDATE SET
    total_users = EXCLUDED.total_users,
    active_users = EXCLUDED.active_users,
    accounts_with_deposits = EXCLUDED.accounts_with_deposits,
    current_tvl_usd = EXCLUDED.current_tvl_usd,
    cumulative_deposited_usd = EXCLUDED.cumulative_deposited_usd,
    cumulative_net_withdrawn_usd = EXCLUDED.cumulative_net_withdrawn_usd,
    cumulative_fees_collected_usd = EXCLUDED.cumulative_fees_collected_usd,
    total_rebalances_executed = EXCLUDED.total_rebalances_executed,
    total_rebalances_failed = EXCLUDED.total_rebalances_failed,
    total_activity_rows = EXCLUDED.total_activity_rows,
    updated_at = now();
END;
$$;

-- Seed/update today's snapshot when migration runs.
SELECT snapshot_platform_kpi(CURRENT_DATE);
