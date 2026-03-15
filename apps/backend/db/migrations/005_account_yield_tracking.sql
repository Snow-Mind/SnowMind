-- Yield tracking per account for 10% profit fee on withdrawal.
-- Tracks cumulative deposits and withdrawals so profit can be calculated
-- at any point as: current_value - (total_deposited - total_withdrawn).

CREATE TABLE IF NOT EXISTS account_yield_tracking (
    account_id UUID PRIMARY KEY REFERENCES accounts(id),
    total_deposited_usdc NUMERIC NOT NULL DEFAULT 0,
    total_withdrawn_usdc NUMERIC NOT NULL DEFAULT 0,
    total_fees_collected_usdc NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
