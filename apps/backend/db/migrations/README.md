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

Expected tables (after `001`):
- `accounts`
- `allocations`
- `protocol_health`
- `rate_snapshots`
- `rebalance_logs`
- `scheduler_locks`
- `session_key_audit`
- `session_keys`

## Creating a new migration

1. Create a new file: `NNN_description.sql` (e.g. `002_add_notifications.sql`)
2. Use `IF NOT EXISTS` / `IF EXISTS` guards so migrations are idempotent
3. Add the file to this folder and update the count above
4. Apply in Supabase SQL Editor

## Reference

The full combined schema is also kept at `apps/backend/supabase_schema.sql` for quick bootstrapping of new environments.
