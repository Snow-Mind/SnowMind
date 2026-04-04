# SnowMind — Database Migrations

## How to apply

Supabase doesn't use a CLI migration tool in our MVP setup. Run each `.sql` file manually in the **Supabase SQL Editor** in numerical order.

### Steps

1. Go to your Supabase project → **SQL Editor**
2. Open and run each file in order: `001_initial_schema.sql`, `002_...`, etc.
3. Verify tables exist:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

Expected tables (after all migrations):
- `accounts`
- `account_yield_tracking`
- `allocations`
- `daily_apy_snapshots`
- `protocol_health`
- `rate_snapshots`
- `rebalance_logs`
- `internal_request_nonces`
- `scheduler_locks`
- `session_key_audit`
- `session_keys`
- `spark_convert_snapshots`
- `platform_kpi_snapshots`
- `twap_snapshots`

## Migration Log

| # | File | Description |
|---|------|-------------|
| 001 | `001_initial_schema.sql` | Core tables, indexes, RLS policies |
| 002 | `002_add_diversification_preference.sql` | Replace risk_tolerance with diversification_preference |
| 003 | `003_add_spark_protocol.sql` | Seed Spark in protocol_health |
| 004 | `004_daily_apy_snapshots.sql` | Daily APY snapshots for TWAP/stability |
| 005 | `005_account_yield_tracking.sql` | Yield tracking for 10% profit fee |
| 006 | `006_twap_and_spark_snapshots.sql` | TWAP buffer persistence + Spark convertToAssets snapshots |
| 007 | `007_fix_column_mismatches.sql` | Fix column names in yield_tracking, session_key_audit, rebalance_logs |
| 008 | `008_add_silo_protocols_and_realtime.sql` | Silo protocols, Supabase Realtime, RLS gaps, data retention |
| 009 | `009_add_allocations_unique_constraint.sql` | Enforce one allocation row per (account, protocol) for safe upserts |
| 010 | `010_generalize_vault_snapshots.sql` | Generalize vault share-price snapshots across ERC-4626 protocols |
| 011 | `011_add_privy_did.sql` | Add Privy DID ownership binding for endpoint authorization |
| 012 | `012_enforce_single_active_session_key.sql` | Enforce single active session key per account to prevent race-induced divergence |
| 013 | `013_add_internal_request_nonces.sql` | Add persistent nonce table for execution-service replay protection across restarts |
| 014 | `014_add_activity_indexes_and_platform_kpis.sql` | Add activity feed indexes, backfill funding activity rows, and enterprise KPI snapshot storage |
| 015 | `015_add_session_key_allocation_caps.sql` | Add per-protocol max allocation caps (`allocation_caps`) to session keys |

## Creating a new migration

1. Create a new file: `NNN_description.sql` (e.g. `002_add_notifications.sql`)
2. Use `IF NOT EXISTS` / `IF EXISTS` guards so migrations are idempotent
3. Add the file to this folder and update the count above
4. Apply in Supabase SQL Editor

## Reference

The full combined schema is also kept at `apps/backend/supabase_schema.sql` for quick bootstrapping of new environments.
