# Real-Time Utilization Monitor

## Context

SnowMind's health checker currently only runs every 30 minutes as part of the scheduler cycle. A lending protocol exploit can drain liquidity in seconds — by the time the next cycle fires, user funds could be locked. Competitors like Zyfai have demonstrated that real-time monitoring and automated withdrawal saved users during the Resolv exploit (March 2025).

We're adding a real-time utilization monitor that polls Aave V3 and Benqi every 30-60 seconds. If utilization spikes dangerously, it triggers a targeted withdrawal immediately — pulling funds from the affected protocol without waiting for the next scheduler cycle.

## What Changes

### 1. New file: `apps/backend/app/workers/utilization_monitor.py`

Core `UtilizationMonitor` class with:

- **`_poll_loop()`** — async loop running every `UTILIZATION_POLL_INTERVAL` seconds (default 30s, configurable)
- **Lightweight utilization fetchers per protocol** — minimal RPC calls for utilization only (no full `get_rate()` overhead):
  - Aave: 2 RPC calls (`aToken.totalSupply()` + `USDC.balanceOf(aToken)`)
  - Benqi: 3 RPC calls (`getCash()`, `totalBorrows()`, `totalReserves()`)
  - Euler V2: 2 RPC calls (`totalAssets()` + `totalBorrows()`, fallback to `cash()`)
  - Silo (both markets): 2 RPC calls each (`totalAssets()` + `USDC.balanceOf(vault)`)
- **`_evaluate_thresholds()`** — checks two triggers:
  - Absolute: 2 consecutive reads > 92% utilization
  - Velocity: utilization jumps 10%+ within a few polls
- **`_handle_alerts()`** — queries DB for accounts with funds in the affected protocol, triggers targeted withdrawal for each
- **`_execute_targeted_withdrawal()`** — calls existing `Rebalancer.execute_partial_withdrawal()` with the full position amount for the affected protocol only
- **In-memory ring buffer** (`deque(maxlen=20)`) per protocol for velocity detection — no DB needed
- **Cooldown map** — 5-minute cooldown per (account, protocol) after triggering withdrawal to prevent repeated triggers
- **Coordination** — uses existing `_REBALANCE_EXECUTION_LOCKS` from `rebalancer.py` to avoid conflicting with scheduler rebalances. Also acquires a Supabase distributed lock (`utilization_monitor_lock`) so only one Railway replica runs the monitor.
- **RPC failure handling** — failed reads recorded as `None`, skipped. 2 consecutive successful reads required before triggering emergency (no false positives from RPC timeouts)

### 2. Modify: `apps/backend/app/core/config.py`

Add new settings alongside existing `UTILIZATION_THRESHOLD = 0.90`:

```python
UTILIZATION_POLL_INTERVAL: int = 30              # seconds between polls (lower to 2s later)
EMERGENCY_UTILIZATION_THRESHOLD: float = 0.92    # absolute threshold for emergency withdrawal
UTILIZATION_VELOCITY_THRESHOLD: float = 0.10     # 10% jump triggers emergency
UTILIZATION_CONFIRM_COUNT: int = 2               # consecutive reads above threshold before action
EMERGENCY_WITHDRAWAL_COOLDOWN: int = 300         # 5 min cooldown after emergency withdrawal
```

Note: The existing `UTILIZATION_THRESHOLD = 0.90` stays as-is — it means "don't deposit more." The new `0.92` means "withdraw immediately."

### 3. Modify: `apps/backend/app/services/protocols/aave.py`

Add `get_utilization()` method:
- 2 RPC calls: `aToken.totalSupply()` + `USDC.balanceOf(aToken)` (cache aToken address after first call)
- Returns `Decimal` utilization only

### 4. Modify: `apps/backend/app/services/protocols/benqi.py`

Add `get_utilization()` method:
- 3 RPC calls via `asyncio.gather`: `getCash()`, `totalBorrows()`, `totalReserves()`
- Returns `Decimal` utilization only

### 5. Modify: `apps/backend/app/services/protocols/euler_v2.py`

Add `get_utilization()` method:
- 2 RPC calls: `totalAssets()` + `totalBorrows()` (fallback to `cash()`)
- Returns `Decimal` utilization only

### 6. Modify: `apps/backend/app/services/protocols/silo.py`

Add `get_utilization()` method (works for both savUSD/USDC and sUSDp/USDC markets):
- 2 RPC calls: `totalAssets()` + `USDC.balanceOf(vault)`
- Utilization = `(totalAssets - cash) / totalAssets`
- Returns `Decimal` utilization only

### 7. Modify: `apps/backend/main.py`

Wire monitor into FastAPI lifecycle:
- In `on_startup` (after scheduler start, line 183): create `UtilizationMonitor()`, call `await monitor.start()`, store at `app.state.utilization_monitor`
- In `on_shutdown` (line 190): call `await monitor.stop()`
- Same gate as scheduler: only start if `SUPABASE_URL and SUPABASE_SERVICE_KEY` are set

## Key Design Decisions

- **Utilization as the single signal** — liquidity drops and position share exceeding TVL cap both manifest as utilization increases. One metric, simpler to build.
- **Targeted withdrawal, not full emergency exit** — only withdraw from the affected protocol. Leave other positions intact. Don't revoke session keys or charge fees. The scheduler will optimally reallocate on its next cycle.
- **Reuse existing `execute_partial_withdrawal()`** from `rebalancer.py` (line 1656) — already handles session key lookup, protocol-specific withdrawal encoding (Benqi qiToken conversion, etc.), execution service call, and allocation DB updates.
- **In-memory state only** — ring buffers and cooldowns are ephemeral. If the process restarts, they rebuild within a few poll cycles. No new DB tables needed.
- **2 consecutive reads required** — a single high reading could be noise. Requiring 2 confirms the situation is real.
- **TVL cap change is in a separate plan** — see `tvl-cap-liquidity.md` for the change from % of total supply to % of available liquidity.

## Scope

- **Monitors all lending/borrowing protocols**: Aave V3, Benqi, Euler V2, and both Silo markets — all have utilization metrics.
- **Does NOT monitor Spark** — Spark's spUSDC is a pure savings vault (MakerDAO DSR). No borrowing, no utilization. Risk there is different (MakerDAO governance, PSM liquidity).
- **Only monitors protocols with active user positions** — no wasted RPC calls.

## Verification

1. **Unit tests**: Test `_evaluate_thresholds()` with mock readings — verify absolute and velocity triggers work correctly, verify RPC failures don't trigger false emergencies
2. **Integration test**: Mock RPC responses to simulate utilization spike, verify targeted withdrawal is called
3. **Manual test on Fuji testnet**: Deploy with 10s poll interval, manually create high utilization scenario, verify withdrawal triggers
4. **Production rollout**: Deploy with 30s interval, monitor logs for a week before relying on it
