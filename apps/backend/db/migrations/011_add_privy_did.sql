-- Migration: Add privy_did column to accounts for authorization checks.
--
-- The Privy JWT's `sub` claim (a DID like "did:privy:clyxxx...") uniquely
-- identifies the authenticated user. Without storing this alongside the
-- account, any authenticated Privy user can call protected endpoints
-- (withdrawal, session key revocation, etc.) for ANY smart account.
--
-- This column enables endpoint-level ownership validation:
--   _auth["sub"] == account.privy_did

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS privy_did TEXT;

-- Partial unique index: once set, each DID can own at most one account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_privy_did
  ON accounts (privy_did) WHERE privy_did IS NOT NULL;

COMMENT ON COLUMN accounts.privy_did IS
  'Privy user DID (sub claim from JWT). Used for authorization checks on protected endpoints.';




----
-- 1. Current allocation per account (live positions)
SELECT
    a.address,
    al.protocol_id,
    al.amount_usdc,
    al.updated_at
FROM allocations al
JOIN accounts a ON al.account_id = a.id
WHERE al.amount_usdc > 0
ORDER BY a.address, al.amount_usdc DESC;

-- 2. Rebalance history (last 20 executions)
SELECT
    a.address,
    rl.from_protocol,
    rl.to_protocol,
    rl.amount_usdc,
    rl.tx_hash,
    rl.created_at
FROM rebalance_logs rl
JOIN accounts a ON rl.account_id = a.id
ORDER BY rl.created_at DESC
LIMIT 20;

-- 3. Session key status per account
SELECT
    a.address,
    sk.session_key_address,
    sk.expires_at,
    sk.allowed_protocols,
    sk.is_active
FROM session_keys sk
JOIN accounts a ON sk.account_id = a.id
ORDER BY sk.expires_at DESC;