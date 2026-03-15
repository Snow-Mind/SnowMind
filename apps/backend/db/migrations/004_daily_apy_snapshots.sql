-- Daily APY snapshots for 30-day moving average calculations.
-- Used by the waterfall allocator rebalance gate to compare proposed vs current APY
-- over a stable window, preventing short-lived rate spikes from triggering rebalances.

CREATE TABLE IF NOT EXISTS daily_apy_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    protocol_id TEXT NOT NULL,
    date DATE NOT NULL,
    apy NUMERIC NOT NULL,
    tvl_usd NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(protocol_id, date)
);

-- Index for efficient lookups: last 30 days per protocol
CREATE INDEX IF NOT EXISTS idx_daily_apy_protocol_date
    ON daily_apy_snapshots (protocol_id, date DESC);
