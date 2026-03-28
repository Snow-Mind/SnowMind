-- 012_enforce_single_active_session_key.sql
-- Enforce a critical invariant: at most one active session key per account.
--
-- Why:
-- Concurrent re-grant requests can race and leave multiple active rows for the
-- same account, causing nondeterministic key selection in execution paths.
-- This migration normalizes existing data, then enforces the invariant.
--
-- Safe to re-run:
-- - UPDATE only affects extra active keys (rn > 1)
-- - CREATE INDEX uses IF NOT EXISTS

-- 1) Normalize existing data: keep only the newest active key per account.
WITH ranked_active AS (
    SELECT
        id,
        account_id,
        ROW_NUMBER() OVER (
            PARTITION BY account_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM session_keys
    WHERE is_active = TRUE
)
UPDATE session_keys sk
SET is_active = FALSE
FROM ranked_active ra
WHERE sk.id = ra.id
  AND ra.rn > 1;

-- 2) Enforce invariant at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_keys_one_active_per_account
    ON session_keys (account_id)
    WHERE is_active = TRUE;

-- 3) Support fast latest-key lookups used by backend queries.
CREATE INDEX IF NOT EXISTS idx_session_keys_account_created_at
    ON session_keys (account_id, created_at DESC);
