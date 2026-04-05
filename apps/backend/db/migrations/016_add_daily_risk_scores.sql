-- Daily protocol risk snapshots (max 9-point framework).
-- Stores static + dynamic score breakdown used by /optimizer/rates.

CREATE TABLE IF NOT EXISTS daily_risk_scores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    protocol_id TEXT NOT NULL,
    date DATE NOT NULL,

    total_score NUMERIC NOT NULL CHECK (total_score >= 0 AND total_score <= 9),
    oracle_score INTEGER NOT NULL CHECK (oracle_score >= 0 AND oracle_score <= 2),
    liquidity_score INTEGER NOT NULL CHECK (liquidity_score >= 0 AND liquidity_score <= 3),
    collateral_score INTEGER NOT NULL CHECK (collateral_score >= 0 AND collateral_score <= 2),
    yield_profile_score INTEGER NOT NULL CHECK (yield_profile_score >= 0 AND yield_profile_score <= 1),
    architecture_score INTEGER NOT NULL CHECK (architecture_score >= 0 AND architecture_score <= 1),

    available_liquidity_usd NUMERIC NOT NULL DEFAULT 0,
    apy_mean NUMERIC,
    apy_stddev NUMERIC,
    sample_days INTEGER NOT NULL DEFAULT 0 CHECK (sample_days >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (protocol_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_risk_scores_protocol_date
    ON daily_risk_scores (protocol_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_risk_scores_date
    ON daily_risk_scores (date DESC);

ALTER TABLE daily_risk_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_daily_risk_scores_read" ON daily_risk_scores;
CREATE POLICY "public_daily_risk_scores_read" ON daily_risk_scores
    FOR SELECT USING (true);
