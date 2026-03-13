-- 003_add_spark_protocol.sql
-- Adds Spark protocol to protocol_health table

INSERT INTO protocol_health (protocol_id)
VALUES ('spark')
ON CONFLICT DO NOTHING;
