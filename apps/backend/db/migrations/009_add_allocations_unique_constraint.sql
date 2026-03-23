-- Migration 009: Add unique constraint on allocations(account_id, protocol_id)
--
-- Root cause: The rebalancer's discovery sync uses upsert with
--   ON CONFLICT (account_id, protocol_id)
-- but no such unique constraint existed, causing Postgres error 42P10:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- This migration also removes any pre-existing duplicates before adding the constraint.

-- Step 1: Remove duplicates, keeping the most recent row per (account_id, protocol_id)
DELETE FROM allocations a
USING allocations b
WHERE a.account_id = b.account_id
  AND a.protocol_id = b.protocol_id
  AND a.updated_at < b.updated_at;

-- Step 2: Add the unique constraint
ALTER TABLE allocations
  ADD CONSTRAINT allocations_account_protocol_unique
  UNIQUE (account_id, protocol_id);
