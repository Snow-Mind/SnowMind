# TVL Cap: Switch from Total Supply to Available Liquidity
## Context   
SnowMind currently caps each user's position at 7.5% of a protocol's **total supply** (`TVL_CAP_PCT = 0.075`). But total supply doesn't reflect how much can actually be withdrawn. A pool with $100M TVL at 85% utilization only has $15M in withdrawable cash — a $1M position is 1% of total supply but 6.7% of actual liquidity.

This change makes the cap check against **available liquidity** (the cash sitting in the pool), so "can I actually get out?" is the determining factor.

## What Changes

### 1. Modify: `apps/backend/app/services/optimizer/health_checker.py`

Change the TVL cap check (line 200) to use available liquidity:

**Current (line 200-208):**
```python
current_share = current_position / protocol_tvl
if current_share > Decimal(str(settings.TVL_CAP_PCT)):
    # FORCED_REBALANCE
```

**New:**
```python
# Available liquidity = total TVL * (1 - utilization)
utilization = protocol_health.utilization or Decimal("0")
available_liquidity = protocol_tvl * (Decimal("1") - utilization)
if available_liquidity > 0:
    current_share = current_position / available_liquidity
else:
    current_share = Decimal("1")  # No liquidity = over cap
if current_share > Decimal(str(settings.TVL_CAP_PCT)):
    # FORCED_REBALANCE
```

- `protocol_health.utilization` is already available as a parameter (passed into `check_protocol_health`)
- No new RPC calls needed
- ERC-4626 vaults (Spark, Euler, Silo) where utilization is None fall back to 0 (current behavior unchanged)

### 2. Modify: `apps/backend/app/services/optimizer/waterfall_allocator.py`

Update the allocation cap calculation to also use available liquidity when computing `max_allowed` per protocol:

**Current:**
```python
max_allowed = min(remaining_funds, TVL_CAP_PCT * protocol_tvl)
```

**New:**
```python
utilization = protocol_utilizations.get(protocol_id, Decimal("0"))
available_liquidity = protocol_tvl * (Decimal("1") - utilization)
max_allowed = min(remaining_funds, TVL_CAP_PCT * available_liquidity)
```

This requires passing utilization data into the allocator (already fetched during the rebalance pipeline, just needs to be threaded through).

## Files to Modify

- `apps/backend/app/services/optimizer/health_checker.py` — TVL cap check (line 200)
- `apps/backend/app/services/optimizer/waterfall_allocator.py` — allocation cap calculation

## Verification

1. Unit test: Mock a pool with $100M TVL, 85% utilization, $1M position. Verify the cap triggers (6.7% of liquidity > 7.5% cap is close but below; test with 90% utilization where $1M / $10M = 10% > 7.5%)
2. Check that ERC-4626 vaults with `utilization=None` behave the same as before (fallback to total supply)
3. Run existing allocator tests to verify no regressions

