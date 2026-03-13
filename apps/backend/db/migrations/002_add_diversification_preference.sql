-- Add diversification_preference column to accounts table.
-- Replaces the unused risk_tolerance column.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS guards).

-- 1. Add new column
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS diversification_preference TEXT DEFAULT 'balanced';

-- 2. Drop old risk_tolerance column (no longer used after two-tier refactor)
ALTER TABLE accounts
  DROP COLUMN IF EXISTS risk_tolerance;
