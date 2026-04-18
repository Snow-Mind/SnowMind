-- 022_seed_all_supported_protocols.sql
-- Ensure protocol_health contains every protocol currently supported by optimizer,
-- risk scoring, and monitoring pipelines.
-- Safe to re-run.

INSERT INTO protocol_health (protocol_id)
VALUES
  ('aave_v3'),
  ('benqi'),
  ('spark'),
  ('euler_v2'),
  ('silo_savusd_usdc'),
  ('silo_susdp_usdc'),
  ('silo_gami_usdc'),
  ('folks')
ON CONFLICT DO NOTHING;
