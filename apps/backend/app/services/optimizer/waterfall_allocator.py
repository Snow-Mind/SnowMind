"""Waterfall allocator — priority-ordered fill with TVL caps and a base layer.

Sorts protocols by APY descending, fills each up to
min(user_exposure_cap, 15% of protocol TVL), and parks any remainder in
the base layer (Spark on mainnet) as the stable yield floor.

Used by the /simulate endpoint. The live rebalancer uses allocator.py.
"""

import logging
import time
from decimal import Decimal

from app.services.optimizer.milp_solver import (
    OptimizerInput,
    OptimizerOutput,
    compute_delta,
    compute_weighted_apy,
    is_rebalance_worth_it,
)

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")
_ONE = Decimal("1")


def waterfall_allocate(
    inp: OptimizerInput,
    tvl_by_protocol: dict[str, Decimal],
    tvl_cap_pct: Decimal = Decimal("0.15"),
    max_exposure_pct: Decimal = Decimal("1.00"),
    base_beat_margin: Decimal = Decimal("0.005"),
    base_layer_protocol_id: str = "spark",
) -> OptimizerOutput:
    """Waterfall allocation: fill highest-APY protocols first, park remainder in base layer.

    Algorithm:
        1. Identify base layer's APY as the yield floor.
        2. Filter protocols that beat base layer by base_beat_margin, sort by APY desc.
        3. For each protocol: cap = min(max_exposure * total, tvl * tvl_cap_pct).
           Allocate min(remaining, cap).
        4. Park any leftover in the base layer.
        5. If nothing beats the base layer, allocate 100% to it.

    Args:
        inp: Standard OptimizerInput (protocols, total_amount, current allocations, gas).
        tvl_by_protocol: Protocol ID → TVL in USD.
        tvl_cap_pct: Max fraction of a protocol's TVL we can own (default 15%).
        max_exposure_pct: Max fraction of total deposit in any single protocol.
        base_beat_margin: Minimum APY advantage over base layer to justify allocation.
        base_layer_protocol_id: Protocol ID for the base layer (Spark on mainnet).
    """
    t0 = time.time()
    total = inp.total_amount_usd
    available = [p for p in inp.protocols if p.is_available]

    if not available:
        return _empty_output(inp)

    # Identify base layer (Spark on mainnet)
    base = next((p for p in available if p.protocol_id == base_layer_protocol_id), None)
    base_apy = base.apy if base else _ZERO

    # Filter protocols that beat the base layer by the margin (exclude base itself)
    candidates = [
        p for p in available
        if p.protocol_id != base_layer_protocol_id and p.apy - base_apy >= base_beat_margin
    ]
    candidates.sort(key=lambda p: p.apy, reverse=True)

    # Waterfall fill
    allocations: dict[str, Decimal] = {}
    remaining = total

    for p in candidates:
        if remaining <= _ZERO:
            break

        tvl = tvl_by_protocol.get(p.protocol_id, _ZERO)
        tvl_cap = tvl * tvl_cap_pct if tvl > _ZERO else total  # skip TVL cap if unknown
        exposure_cap = max_exposure_pct * total
        cap = min(exposure_cap, tvl_cap)

        alloc = min(remaining, cap)
        if alloc > _ONE:  # filter dust
            allocations[p.protocol_id] = alloc.quantize(Decimal("0.01"))
            remaining -= alloc

    # Park remainder in base layer (or all if nothing beat the base)
    if remaining > _ONE and base is not None:
        allocations[base_layer_protocol_id] = remaining.quantize(Decimal("0.01"))
        remaining = _ZERO
    elif remaining > _ONE and candidates:
        # No base layer available — give overflow to the best candidate
        best_pid = candidates[0].protocol_id
        allocations[best_pid] = allocations.get(best_pid, _ZERO) + remaining
        remaining = _ZERO
    elif remaining > _ONE:
        # Nothing available at all
        return _empty_output(inp)

    solve_ms = (time.time() - t0) * 1000

    rates = {p.protocol_id: p.apy for p in available}
    weighted_apy = compute_weighted_apy(allocations, rates)
    total_alloc = sum(allocations.values(), _ZERO) or _ONE
    weighted_risk = sum(
        (allocations.get(p.protocol_id, _ZERO) / total_alloc) * p.risk_score
        for p in available
        if p.protocol_id in allocations
    )

    delta = compute_delta(allocations, inp.current_allocations)
    current_apy = compute_weighted_apy(inp.current_allocations, rates)
    worth, reason = is_rebalance_worth_it(
        delta, total, inp.gas_cost_estimate_usd, weighted_apy, current_apy,
    )

    logger.info(
        "waterfall_allocate → %s (APY %.2f%%): %s",
        ", ".join(f"{pid}={float(amt):.0f}" for pid, amt in allocations.items()),
        float(weighted_apy) * 100,
        reason,
    )

    return OptimizerOutput(
        allocations=allocations,
        expected_apy=weighted_apy,
        risk_score=weighted_risk,
        objective_value=weighted_apy * total,
        solve_time_ms=solve_ms,
        status="optimal",
        is_rebalance_needed=worth,
        delta_from_current=delta,
    )


def _empty_output(inp: OptimizerInput) -> OptimizerOutput:
    return OptimizerOutput(
        allocations={},
        expected_apy=_ZERO,
        risk_score=_ZERO,
        objective_value=_ZERO,
        solve_time_ms=0.0,
        status="infeasible",
        is_rebalance_needed=False,
        delta_from_current={},
    )


# ── 30-day APY average helper ────────────────────────────────────────────────

_MIN_DAYS_FOR_AVG = 7  # Require at least 7 days of history; else fall back to spot


def get_30d_avg_apy(db, protocol_id: str) -> Decimal | None:
    """Return the 30-day average APY for a protocol from daily snapshots.

    Returns None if fewer than MIN_DAYS_FOR_AVG snapshots exist (caller should
    fall back to the current TWAP rate).
    """
    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).date().isoformat()
    rows = (
        db.table("daily_apy_snapshots")
        .select("apy")
        .eq("protocol_id", protocol_id)
        .gte("date", cutoff)
        .order("date", desc=True)
        .execute()
    )
    if not rows.data or len(rows.data) < _MIN_DAYS_FOR_AVG:
        return None

    total = sum(Decimal(str(r["apy"])) for r in rows.data)
    return total / Decimal(str(len(rows.data)))
