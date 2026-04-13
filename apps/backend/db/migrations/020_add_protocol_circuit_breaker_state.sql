-- Persist protocol circuit-breaker state across service restarts.
-- This prevents immediate re-entry of repeatedly failing protocols after a restart.

create table if not exists protocol_circuit_breaker_state (
  protocol_id text primary key,
  failures integer not null default 0,
  state text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  last_failure_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_protocol_circuit_breaker_updated_at
  on protocol_circuit_breaker_state (updated_at desc);
