-- 021_add_folks_protocol.sql
-- Seed Folks protocol id for health/risk pipelines.
-- Safe to re-run.

INSERT INTO protocol_health (protocol_id) VALUES ('folks')
ON CONFLICT DO NOTHING;
