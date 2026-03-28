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
