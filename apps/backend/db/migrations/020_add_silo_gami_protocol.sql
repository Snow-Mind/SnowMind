-- 020_add_silo_gami_protocol.sql
-- Seed Silo V3 Gami vault protocol id for health/risk pipelines.
-- Safe to re-run.

INSERT INTO protocol_health (protocol_id) VALUES ('silo_gami_usdc')
ON CONFLICT DO NOTHING;
