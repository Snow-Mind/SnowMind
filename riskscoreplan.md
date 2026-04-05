# Implementation Plan: Dynamic Risk Scoring System

## Context

We completed a full risk assessment audit of all 6 protocols (see `report.md` in project root). The current risk scoring system has two major problems:

1. **Scores are hardcoded** — `risk_scorer.py` has static `BASE_RISK_SCORES` (Aave=10, Benqi=10, etc.) that never update. The UI shows these stale numbers.
2. **Scoring framework changed** — we moved from a 10-point to a **9-point** system with new categories (Oracle Quality, Liquidity, Collateral Quality, Yield Profile, Architecture). The old categories no longer apply.

The risk scores are **information only** — displayed to users to help them choose protocols. They do NOT affect the rebalancing engine (which has its own separate health checks, utilization monitoring, etc.).

Suyash — `report.md` is the source of truth for all scoring criteria and per-protocol assessments. The AI assistant should use it to explain scores to users.

---

## New Scoring Framework (Max 9 Points)

| # | Category | Max | Type | Update Frequency |
|---|---|---|---|---|
| 1 | Oracle Quality | 2 | Static | Manual review |
| 2 | Liquidity | 3 | **Dynamic** | Every 24 hours from on-chain |
| 3 | Collateral Quality | 2 | Static | Manual review |
| 4 | Yield Profile | 1 | **Dynamic** | Every 24 hours from on-chain |
| 5 | Architecture | 1 | Static | Manual review |

### Current Static Scores (from report.md)

| Protocol | Oracle | Collateral | Architecture | Static Total |
|---|---|---|---|---|
| Aave V3 | 2/2 | 1/2 | 1/1 | 4 |
| Benqi | 2/2 | 2/2 | 1/1 | 5 |
| Spark (spUSDC) | 2/2 | 2/2 | 0/1 | 4 |
| Euler V2 | 1/2 | 1/2 | 0/1 | 2 |
| Silo savUSD/USDC | 2/2 | 1/2 | 1/1 | 4 |
| Silo sUSDp/USDC | 0/2 | 1/2 | 1/1 | 2 |

---

## What Needs to Change

### 1. Update `risk_scorer.py`

**File:** `apps/backend/app/services/optimizer/risk_scorer.py`

Replace the current `BASE_RISK_SCORES` dict (1-10 scale) and `compute_risk_score()` function with the new 9-point framework.

**Static scores** (hardcoded — these only change when we do a manual review):
```python
STATIC_SCORES = {
    "aave_v3":          {"oracle": 2, "collateral": 1, "architecture": 1},
    "benqi":            {"oracle": 2, "collateral": 2, "architecture": 1},
    "spark":            {"oracle": 2, "collateral": 2, "architecture": 0},
    "euler_v2":         {"oracle": 1, "collateral": 1, "architecture": 0},
    "silo_savusd_usdc": {"oracle": 2, "collateral": 1, "architecture": 1},
    "silo_susdp_usdc":  {"oracle": 0, "collateral": 1, "architecture": 1},
}
```

**Dynamic scores** (computed from on-chain data):

**Liquidity score (max 3):**
- IMPORTANT: For lending protocols (Aave, Benqi, Euler, Silo), liquidity = **total supplied - total borrowed** (NOT just total supply). This is the actual USDC available for withdrawal.
- For Spark: liquidity = **vault's 10% instant buffer + USDC available in the PSM** (combined). Spark is not a lending protocol — there's no "borrowed" amount.
- Thresholds: >$10M = 3, >$1M = 2, >$500K = 1, <$500K = 0

**Yield Profile score (max 1):**
- Calculate 30-day APY standard deviation from `daily_apy_snapshots` table
- If std_dev < 30% of mean APY → 1 point
- If std_dev >= 30% of mean APY → 0 points
- Need at least 7 days of data to compute; default to 0 until enough data exists

**Total score** = static scores + liquidity score + yield profile score (max 9)

### 2. Add Daily Risk Score Job in Scheduler

**File:** `apps/backend/app/workers/scheduler.py`

Add a new daily cron job (e.g., 2:30 AM UTC, after the APY snapshot at 2:00 AM):
- Fetch current liquidity for each protocol (supply - borrowed for lending, vault buffer + PSM for Spark)
- Calculate yield stability from 30-day rolling `daily_apy_snapshots`
- Compute total score (static + dynamic)
- Persist to a new `daily_risk_scores` table

### 3. Update API to Serve Dynamic Scores

**File:** `apps/backend/app/api/routes/optimizer.py`

The `/rates` endpoint currently uses a static `RISK_SCORES` dict. Update it to:
- Read the latest computed risk score from the `daily_risk_scores` table (or compute on-demand as fallback)
- Return the new max of 9 (not 10)
- Include score breakdown in the response so the UI can show per-category scores

Suggested API response shape:
```json
{
  "riskScore": 7,
  "riskScoreMax": 9,
  "riskBreakdown": {
    "oracle": 2,
    "liquidity": 2,
    "collateral": 1,
    "yieldProfile": 1,
    "architecture": 1
  }
}
```

### 4. Update UI Risk Display

The frontend needs to display `/9` instead of `/10` and ideally show the breakdown. This depends on how the frontend currently renders the score — check with the frontend code.

### 5. AI Assistant Integration

The AI assistant should use `report.md` as context when helping users understand protocol risks. The report contains:
- Full scoring criteria with clear definitions
- Per-protocol detailed explanations of WHY each score was given
- Risk factors unique to each protocol (e.g., Spark's USDS conversion risk, Euler's curator trust assumptions)
- What the dynamic scores measure and how they're calculated

---

## Key Files to Modify

| File | Change |
|---|---|
| `apps/backend/app/services/optimizer/risk_scorer.py` | Replace scoring logic with 9-point framework |
| `apps/backend/app/workers/scheduler.py` | Add daily risk score computation job |
| `apps/backend/app/api/routes/optimizer.py` | Serve dynamic scores + breakdown instead of static dict |
| `apps/backend/app/models/` | Add `daily_risk_scores` table/model |
| `report.md` (project root) | Reference doc — already complete, no changes needed |

---

## Important Notes for Suyash

1. **Liquidity calculation differs by protocol type:**
   - Lending protocols (Aave, Benqi, Euler, Silo): `available_liquidity = total_supplied - total_borrowed`
   - Spark: `available_liquidity = vault_buffer + psm_usdc_balance`
   - Do NOT use total supply as liquidity — it overstates what's actually withdrawable

2. **The risk score does NOT affect rebalancing** — it's information only for the UI. The rebalancing engine has its own separate safety logic (health checks, circuit breakers, utilization monitoring). Don't couple these systems.

3. **Silo sUSDp/USDC oracle score is 0/2** because we couldn't verify the sUSDp oracle provider. We're waiting for confirmation from the Silo team. Once confirmed, update the `STATIC_SCORES` dict.

4. **Yield Profile needs 30 days of APY data** to be accurate. Until then, default to 0 for new protocols. We already have `daily_apy_snapshots` collecting this data.

5. **report.md is the source of truth** for all scoring rationale. When adding new protocols, do a risk assessment and update report.md first, then update the static scores in code.

---

## Verification

1. After deploying, check `/rates` endpoint returns scores out of 9 with breakdown
2. Verify liquidity scores match on-chain reality (check a few protocols manually)
3. Wait 24 hours and confirm the daily job runs and scores update
4. Check that the rebalancing engine is NOT affected by the score changes
5. Verify the AI assistant can reference report.md to explain scores to users
