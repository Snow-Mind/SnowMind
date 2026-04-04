# Per-Protocol Allocation Caps

## Context

Users currently select which protocols to enable/disable, but have no control over how much of their deposit goes to each protocol. The allocator puts as much as possible into the highest APY protocol, subject to system TVL caps. Users want finer-grained control — e.g., "I trust Euler but only with 20% of my funds."

This feature adds a per-protocol maximum allocation percentage that users set from the UI. The waterfall allocator respects these caps alongside the existing system TVL caps. Default is 100% for all protocols (current behavior unchanged).

## Example

User has $1,000. Sets caps: Benqi 100%, Euler 20%, Aave 50%.
Euler has highest APY, Aave second, Benqi third. All healthy.

Allocation:
- Euler: 20% ($200) — capped by user
- Aave: 50% ($500) — capped by user
- Benqi: 30% ($300) — gets the remainder

If Euler fails health check:
- Aave: 50% ($500) — capped by user
- Benqi: 50% ($500) — gets the remainder

## What Changes

### Backend

**1. Modify: `apps/backend/app/api/routes/accounts.py`**

Add a new endpoint to save per-protocol allocation caps:

```
PUT /api/v1/accounts/{address}/allocation-caps
Body: { "allocationCaps": { "aave_v3": 100, "benqi": 100, "euler_v2": 20, "spark": 50, ... } }
```

- Values are integers 0-100 (percentages)
- Stored in the `session_keys` table as a new JSON column `allocation_caps` alongside `allowed_protocols`
- Default is `null` (meaning 100% for all — current behavior)
- Validation: each value must be 0-100, protocol IDs must be valid

Also modify the existing `GET /api/v1/accounts/{address}` response to include `allocationCaps` in the response.

**2. Database: add column to `session_keys` table**

```sql
ALTER TABLE session_keys ADD COLUMN allocation_caps JSONB DEFAULT NULL;
```

Format: `{"aave_v3": 100, "benqi": 100, "euler_v2": 20, ...}` — integer percentages.
`NULL` means all protocols at 100% (backwards compatible).

**3. Modify: `apps/backend/app/services/optimizer/rebalancer.py` (line 989-992)**

Currently hardcodes `max_pct=None` for all protocols:
```python
user_preferences={
    pid: UserPreference(protocol_id=pid, enabled=True, max_pct=None)
    for pid in allowed_rates
},
```

Change to read `allocation_caps` from the session key record and pass them through:
```python
user_preferences={
    pid: UserPreference(
        protocol_id=pid,
        enabled=True,
        max_pct=Decimal(str(caps.get(pid, 100))) / Decimal("100") if caps else None,
    )
    for pid in allowed_rates
},
```

Where `caps` is the `allocation_caps` JSON from the session key record (already fetched earlier in the pipeline).

**4. No changes needed to allocator.py**

The `UserPreference.max_pct` and `get_effective_cap()` already handle per-protocol caps correctly (lines 79-80). The `min(system_cap, user_cap)` logic means the most restrictive cap always wins.

### Frontend

**5. Modify: `apps/web/app/(app)/onboarding/page.tsx`**

Add a settings icon (gear/slider icon) next to each protocol's toggle switch. When clicked, it reveals a percentage selector for that protocol's max allocation.

- Settings icon appears next to the toggle for each enabled protocol
- Clicking it shows a percentage control (plus/minus buttons or slider)
- Default: 100% for all protocols
- Step size: 10% increments (10%, 20%, 30%, ... 100%)
- Minimum: 10% (below that, just disable the protocol)
- Visual: Show the percentage as a small badge/label next to the toggle
- Only show the settings icon when the protocol toggle is ON

State addition:
```typescript
const [allocationCaps, setAllocationCaps] = useState<Record<string, number>>(
  () => Object.fromEntries(MARKET_PROTOCOLS.map(p => [p.id, 100]))
);
```

Pass `allocationCaps` alongside `allowedProtocols` when calling `api.registerAccount()`.

**6. Modify: `apps/web/components/dashboard/AgentManager.tsx`**

Same UI addition as onboarding — settings icon next to each protocol toggle with percentage selector. When user saves, send allocation caps alongside allowed protocols.

Modify `handleSave()` to also call a new `api.updateAllocationCaps()` endpoint (or bundle with `updateAllowedProtocols()`).

**7. Modify: `apps/web/lib/api-client.ts`**

Add new API method:
```typescript
updateAllocationCaps(address: string, caps: Record<string, number>): Promise<void>
```

Or extend `updateAllowedProtocols()` to also accept caps.

Also update `getAccountDetail()` response type to include `allocationCaps`.

**8. Modify: `apps/web/hooks/useAccountDetail.ts`**

Update the `AccountDetailResponse` type to include `allocationCaps: Record<string, number> | null`.

## Key Files

| File | Change |
|------|--------|
| `apps/backend/app/api/routes/accounts.py` | New PUT endpoint for allocation caps |
| `apps/backend/app/services/optimizer/rebalancer.py` (line 989) | Read caps from DB, pass to allocator |
| `apps/backend/app/services/optimizer/allocator.py` | No changes needed (already supports max_pct) |
| `apps/web/app/(app)/onboarding/page.tsx` | Settings icon + percentage selector per protocol |
| `apps/web/components/dashboard/AgentManager.tsx` | Same UI for post-onboarding changes |
| `apps/web/lib/api-client.ts` | New API method for caps |
| `apps/web/hooks/useAccountDetail.ts` | Updated response type |

## What Does NOT Change

- The allocator algorithm itself — `get_effective_cap()` already handles `max_pct`
- System TVL caps (7.5% of available liquidity) — still enforced, most restrictive wins
- Session key on-chain permissions — caps are a backend concern, not on-chain
- Existing users — `allocation_caps = NULL` means 100% for all (current behavior)

## Verification

1. Unit test: Set Euler cap to 20% with $1000 balance. Verify allocator caps Euler at $200 even if it has the highest APY.
2. Unit test: Set all caps to 100%. Verify behavior is identical to current (no regression).
3. Unit test: Set a cap lower than the system TVL cap. Verify user cap wins.
4. Unit test: Set a cap higher than the system TVL cap. Verify system cap wins.
5. Integration test: Save caps via API, trigger rebalance, verify allocations respect caps.
6. Frontend test: Toggle protocol off — settings icon disappears. Toggle back on — settings icon reappears with previous cap value preserved.
