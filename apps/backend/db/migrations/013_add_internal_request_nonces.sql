-- ═══════════════════════════════════════════════════════════════
-- 013_add_internal_request_nonces.sql
-- Persistent nonce store for execution-service replay protection
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS internal_request_nonces (
  nonce      TEXT PRIMARY KEY,
  seen_at    TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_request_nonces_expires_at
  ON internal_request_nonces (expires_at);

ALTER TABLE internal_request_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_public_internal_request_nonces" ON internal_request_nonces;
CREATE POLICY "deny_public_internal_request_nonces" ON internal_request_nonces
  FOR ALL
  USING (false)
  WITH CHECK (false);
