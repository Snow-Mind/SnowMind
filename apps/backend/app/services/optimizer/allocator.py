"""
APY-ranked greedy allocator — the core allocation algorithm.

There is NO base layer. Every protocol competes on effective APY.

Algorithm:
  1. Rank all healthy protocols by effective TWAP APY (highest first)
  2. For each in ranked order:
     - Spark: cap = min(remaining, user_max_cap) — no system TVL cap (fixed rate)
         - All others (Aave, Benqi, Euler, Silo):
             cap = min(remaining, 7.5% × available_liquidity, user_max_cap)
             where available_liquidity = protocol_tvl × (1 - utilization)
  3. If remaining > 0 after all protocols: hold idle, alert ops

User preferences (future):
    - Per-protocol max_pct cap (0.0-1.0)
  - Per-protocol enabled toggle
  - Most restrictive wins: min(system_tvl_cap, user_amount_cap)
"""

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.core.config import get_settings
from app.services.optimizer.health_checker import HealthCheckResult

logger = logging.getLogger("snowmind.allocator")


@dataclass
class AllocationResult:
    """Result of the allocation algorithm."""
    allocations: dict[str, Decimal]       # protocol_id → USDC amount
    idle_amount: Decimal                   # USDC held idle in smart account
    weighted_apy: Decimal                  # Weighted average APY of allocation
    details: dict[str, Any]               # Debug info


@dataclass
class UserPreference:
    """Per-protocol user preference."""
    protocol_id: str
    enabled: bool = True
    max_pct: Decimal | None = None  # None = no cap (default for Spark)


def get_effective_cap(
    protocol_id: str,
    total_balance: Decimal,
    protocol_tvl: Decimal,
    protocol_utilization: Decimal | None,
    user_pref: UserPreference | None,
) -> Decimal:
    """
    Compute the effective cap for a protocol, considering both system TVL cap
    and user preferences. Most restrictive wins.

    For Spark: no system TVL cap (fixed rate doesn't compress).
    For non-Spark protocols: system cap = 7.5% of available liquidity.
    """
    settings = get_settings()

    # User disabled this protocol entirely
    if user_pref and not user_pref.enabled:
        return Decimal("0")

    # System TVL cap (all protocols except Spark; Spark's fixed-rate doesn't compress)
    if protocol_id == "spark":
        system_cap = total_balance  # No system cap for Spark
    else:
        utilization = protocol_utilization if protocol_utilization is not None else Decimal("0")
        utilization = max(Decimal("0"), min(utilization, Decimal("1")))
        available_liquidity = protocol_tvl * (Decimal("1") - utilization)
        system_cap = Decimal(str(settings.TVL_CAP_PCT)) * max(available_liquidity, Decimal("0"))

    # User amount cap
    if user_pref and user_pref.max_pct is not None:
        user_cap = user_pref.max_pct * total_balance
    else:
        user_cap = total_balance  # No user cap

    # Most restrictive wins
    return min(system_cap, user_cap)


def compute_allocation(
    health_results: dict[str, HealthCheckResult],
    twap_apys: dict[str, Decimal],
    protocol_tvls: dict[str, Decimal],
    total_balance: Decimal,
    protocol_utilizations: dict[str, Decimal | None] | None = None,
    user_preferences: dict[str, UserPreference] | None = None,
) -> AllocationResult:
    """
    APY-ranked greedy allocation algorithm.

    1. Filter to healthy protocols that can accept deposits
    2. Sort by effective TWAP APY (highest first)
    3. Greedily allocate top-down, respecting caps
    4. Any remainder stays idle

    Args:
        health_results: Per-protocol health check results
        twap_apys: Effective TWAP APY per protocol
        protocol_tvls: Protocol TVL in USD per protocol
        total_balance: Total USDC to allocate
        user_preferences: Optional per-protocol user caps/toggles

    Returns:
        AllocationResult with per-protocol amounts and weighted APY.
    """
    if total_balance <= 0:
        return AllocationResult(
            allocations={},
            idle_amount=Decimal("0"),
            weighted_apy=Decimal("0"),
            details={"reason": "zero_balance"},
        )

    # Step 1: Filter to deposit-safe protocols
    eligible_protocols: list[str] = []
    for pid, health in health_results.items():
        if health.is_deposit_safe:
            # Also check user preference
            user_pref = (user_preferences or {}).get(pid)
            if user_pref and not user_pref.enabled:
                continue
            eligible_protocols.append(pid)

    if not eligible_protocols:
        return AllocationResult(
            allocations={},
            idle_amount=total_balance,
            weighted_apy=Decimal("0"),
            details={"reason": "no_eligible_protocols"},
        )

    # Step 2: Rank by effective TWAP APY (highest first)
    ranked = sorted(
        eligible_protocols,
        key=lambda pid: twap_apys.get(pid, Decimal("0")),
        reverse=True,
    )

    # Step 3: Greedy allocation
    remaining = total_balance
    allocations: dict[str, Decimal] = {}
    details: dict[str, Any] = {"ranked_order": ranked, "caps": {}}

    for protocol_id in ranked:
        if remaining <= 0:
            break

        user_pref = (user_preferences or {}).get(protocol_id)
        cap = get_effective_cap(
            protocol_id=protocol_id,
            total_balance=total_balance,
            protocol_tvl=protocol_tvls.get(protocol_id, Decimal("0")),
            protocol_utilization=(protocol_utilizations or {}).get(protocol_id),
            user_pref=user_pref,
        )

        allocation = min(remaining, cap)
        details["caps"][protocol_id] = str(cap)

        if allocation > 0:
            allocations[protocol_id] = allocation
            remaining -= allocation

    # Step 4: Calculate weighted APY
    weighted_apy = Decimal("0")
    if total_balance > 0:
        for pid, amount in allocations.items():
            apy = twap_apys.get(pid, Decimal("0"))
            weighted_apy += (amount / total_balance) * apy

    # Handle idle funds
    idle_amount = remaining
    if idle_amount > Decimal("0.01"):  # More than $0.01 idle
        logger.warning(
            "TVL overflow: $%.2f idle after allocation. "
            "Platform TVL cap may need tightening.",
            float(idle_amount),
        )
        details["tvl_overflow"] = True

    return AllocationResult(
        allocations=allocations,
        idle_amount=idle_amount,
        weighted_apy=weighted_apy,
        details=details,
    )


def compute_weighted_apy(
    allocations: dict[str, Decimal],
    total_balance: Decimal,
    twap_apys: dict[str, Decimal],
) -> Decimal:
    """Compute weighted average APY for a given allocation."""
    if total_balance <= 0:
        return Decimal("0")
    weighted = Decimal("0")
    for pid, amount in allocations.items():
        weighted += (amount / total_balance) * twap_apys.get(pid, Decimal("0"))
    return weighted
