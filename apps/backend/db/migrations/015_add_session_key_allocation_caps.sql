-- Add per-protocol user allocation caps to session keys.
-- NULL means "no explicit user caps" (equivalent to 100% for all protocols).

ALTER TABLE session_keys
ADD COLUMN IF NOT EXISTS allocation_caps JSONB DEFAULT NULL;

COMMENT ON COLUMN session_keys.allocation_caps IS
  'Per-protocol max allocation percentages (0-100), e.g. {"aave_v3": 50, "euler_v2": 20}. NULL means no explicit caps.';
