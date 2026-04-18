"""
Unified health checker — runs all protocol-specific safety gates.

This module consolidates health checks for all supported protocols into a single
callable that returns per-protocol health status. It's called by the
rebalancer before allocation decisions.

Non-Spark checks:
  - Reserve/comptroller pause flags
  - Utilization > 90% → HIGH_UTILIZATION (exclude from new deposits)
  - Velocity check: >25% APY change in 30 min → exclude
    - Liquidity stress: utilization > 90% with active position → FORCED_REBALANCE
  - Sanity bound: TWAP APY > 25% → exclude
    - 7-day stability (Aave/Benqi only): >50% relative swing → exclude from new deposits
    - TVL cap auto-withdraw: position > 7.5% of available liquidity → FORCED_REBALANCE

Spark checks (ONLY these — all others are intentionally skipped):
  - vat.live() == 1 (MakerDAO global settlement)
  - tin value (PSM deposit gate)

All protocols:
  - Circuit breaker: 3+ consecutive RPC failures → exclude
"""

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.protocols.base import ProtocolHealth, ProtocolStatus

logger = logging.getLogger("snowmind.health_checker")


class RebalanceFlag(Enum):
    """Flags that affect rebalance behavior."""
    NONE = "none"
    FORCED_REBALANCE = "forced_rebalance"     # Bypass beat-margin, time-cooldown, delta gates


@dataclass
class HealthCheckResult:
    """Result of all health checks for a single protocol."""
    protocol_id: str
    is_healthy: bool                     # Can this protocol participate in allocation?
    is_deposit_safe: bool                # Can we deposit new funds?
    is_withdrawal_safe: bool             # Can we withdraw existing funds?
    flag: RebalanceFlag = RebalanceFlag.NONE
    exclusion_reasons: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


async def check_protocol_health(
    protocol_id: str,
    protocol_health: ProtocolHealth,
    current_apy: Decimal,
    twap_apy: Decimal,
    previous_apy: Decimal | None,
    yesterday_avg_apy: Decimal | None,
    daily_snapshots_7d: list[Decimal] | None,
    current_position: Decimal,
    protocol_tvl: Decimal,
    circuit_breaker_failures: int,
) -> HealthCheckResult:
    """
    Run all applicable health checks for a single protocol.

    Spark is intentionally exempt from velocity, sanity bound,
    7-day stability, and TVL-cap checks.
    """
    settings = get_settings()
    result = HealthCheckResult(
        protocol_id=protocol_id,
        is_healthy=True,
        is_deposit_safe=protocol_health.is_deposit_safe,
        is_withdrawal_safe=protocol_health.is_withdrawal_safe,
    )

    # ── Protocol-level health (step 5/6/7) ────────────────────────────
    if protocol_health.status == ProtocolStatus.EMERGENCY:
        result.is_healthy = False
        result.is_deposit_safe = False
        result.flag = RebalanceFlag.FORCED_REBALANCE
        result.exclusion_reasons.append(
            f"EMERGENCY: {protocol_health.details}"
        )
        if current_position > 0:
            logger.critical(
                "Protocol %s in EMERGENCY state with active position $%.2f",
                protocol_id,
                float(current_position),
            )
        return result

    if protocol_health.status in (
        ProtocolStatus.DEPOSITS_DISABLED,
        ProtocolStatus.WITHDRAWALS_DISABLED,
    ):
        result.is_deposit_safe = False
        result.exclusion_reasons.append(f"Protocol status: {protocol_health.status.value}")
        if current_position > 0 and not protocol_health.is_withdrawal_safe:
            logger.error(
                "ALERT: Protocol %s has paused withdrawals with active position!",
                protocol_id,
            )

    if protocol_health.status == ProtocolStatus.HIGH_UTILIZATION:
        result.is_deposit_safe = False
        result.exclusion_reasons.append("Utilization > 90% — exclude from new deposits")

    # ── FORCED_REBALANCE if paused/frozen with active position ────────
    if not result.is_deposit_safe and current_position > 0:
        if result.flag != RebalanceFlag.FORCED_REBALANCE:
            result.flag = RebalanceFlag.FORCED_REBALANCE

    # ── Circuit breaker (step 13 — all protocols) ────────────────────
    if circuit_breaker_failures >= settings.CIRCUIT_BREAKER_THRESHOLD:
        result.is_healthy = False
        result.is_deposit_safe = False
        result.exclusion_reasons.append(
            f"Circuit breaker: {circuit_breaker_failures} consecutive RPC failures"
        )
        return result

    # ── Spark gets ONLY the above checks — everything below is skipped ─
    if protocol_id == "spark":
        return result

    # ══════════════════════════════════════════════════════════════════
    # Non-Spark checks below
    # ══════════════════════════════════════════════════════════════════

    # ── Velocity check (step 10) ─────────────────────────────────────
    if previous_apy is not None and previous_apy > 0:
        delta = abs(current_apy - previous_apy) / previous_apy
        if delta > Decimal(str(settings.VELOCITY_THRESHOLD)):
            result.is_deposit_safe = False
            result.exclusion_reasons.append(
                f"Velocity: {float(delta * 100):.1f}% APY change in 30 min (threshold: {settings.VELOCITY_THRESHOLD * 100}%)"
            )
            result.details["velocity_delta"] = str(delta)

    # ── Liquidity stress detection (utilization-only) ─────────────────
    if protocol_health.utilization is not None:
        utilization_threshold = Decimal(str(settings.UTILIZATION_THRESHOLD))
        if protocol_health.utilization > utilization_threshold:
            result.is_deposit_safe = False
            result.exclusion_reasons.append(
                f"Liquidity stress: utilization {float(protocol_health.utilization * 100):.1f}% "
                f"> {float(utilization_threshold * 100):.1f}%"
            )
            if current_position > 0:
                result.is_healthy = False
                result.flag = RebalanceFlag.FORCED_REBALANCE
                logger.critical(
                    "LIQUIDITY STRESS on %s — utilization %.1f%% with active position. "
                    "Flagging FORCED_REBALANCE.",
                    protocol_id,
                    float(protocol_health.utilization * 100),
                )

    # ── Sanity bound (step 12) ───────────────────────────────────────
    if twap_apy > Decimal(str(settings.MAX_APY_SANITY_BOUND)):
        result.is_deposit_safe = False
        result.exclusion_reasons.append(
            f"Sanity bound: TWAP APY {float(twap_apy * 100):.2f}% > "
            f"{settings.MAX_APY_SANITY_BOUND * 100}% threshold"
        )

    # ── 7-day APY stability check (step 14) ──────────────────────────
    # Apply this only to variable-rate lending pools. For ERC-4626 vaults
    # (Euler/Silo), APY can change in discrete share-price steps and this
    # max-min swing metric creates false positives.
    if protocol_id in ("aave_v3", "benqi") and daily_snapshots_7d and len(daily_snapshots_7d) >= 7:
        max_7d = max(daily_snapshots_7d)
        min_7d = min(daily_snapshots_7d)
        avg_7d = sum(daily_snapshots_7d) / len(daily_snapshots_7d)
        if avg_7d > 0:
            relative_swing = (max_7d - min_7d) / avg_7d
            if relative_swing > Decimal(str(settings.STABILITY_SWING_THRESHOLD)):
                result.is_deposit_safe = False
                result.exclusion_reasons.append(
                    f"7-day instability: {float(relative_swing * 100):.1f}% "
                    f"relative swing (threshold: {settings.STABILITY_SWING_THRESHOLD * 100}%)"
                )
                # Does NOT force-exit existing positions

    # ── Liquidity cap auto-withdraw (step 15) ─────────────────────────
    if protocol_tvl > 0 and current_position > 0:
        utilization = protocol_health.utilization
        if utilization is None:
            utilization = Decimal("0")
        utilization = max(Decimal("0"), min(utilization, Decimal("1")))

        available_liquidity = protocol_tvl * (Decimal("1") - utilization)
        if available_liquidity > 0:
            current_share = current_position / available_liquidity
        else:
            # No liquidity means any non-zero position is effectively over-cap.
            current_share = Decimal("1")

        if current_share > Decimal(str(settings.TVL_CAP_PCT)):
            result.is_deposit_safe = False
            result.flag = RebalanceFlag.FORCED_REBALANCE
            result.exclusion_reasons.append(
                f"Liquidity cap exceeded: position is {float(current_share * 100):.1f}% "
                f"of available liquidity (cap: {settings.TVL_CAP_PCT * 100}%)"
            )

    # ── Final healthy determination ──────────────────────────────────
    if result.exclusion_reasons and result.flag == RebalanceFlag.NONE:
        # Has exclusion reasons but can still participate with restrictions
        result.is_healthy = result.is_deposit_safe or result.is_withdrawal_safe

    return result


async def run_all_health_checks(
    health_results: dict[str, ProtocolHealth],
    current_apys: dict[str, Decimal],
    twap_apys: dict[str, Decimal],
    previous_apys: dict[str, Decimal | None],
    yesterday_avg_apys: dict[str, Decimal | None],
    daily_snapshots_7d: dict[str, list[Decimal] | None],
    current_positions: dict[str, Decimal],
    protocol_tvls: dict[str, Decimal],
    circuit_breaker_failures: dict[str, int],
) -> dict[str, HealthCheckResult]:
    """
    Run health checks for all protocols in parallel.

    Returns a dict mapping protocol_id → HealthCheckResult.
    """
    results: dict[str, HealthCheckResult] = {}
    for protocol_id, health in health_results.items():
        results[protocol_id] = await check_protocol_health(
            protocol_id=protocol_id,
            protocol_health=health,
            current_apy=current_apys.get(protocol_id, Decimal("0")),
            twap_apy=twap_apys.get(protocol_id, Decimal("0")),
            previous_apy=previous_apys.get(protocol_id),
            yesterday_avg_apy=yesterday_avg_apys.get(protocol_id),
            daily_snapshots_7d=daily_snapshots_7d.get(protocol_id),
            current_position=current_positions.get(protocol_id, Decimal("0")),
            protocol_tvl=protocol_tvls.get(protocol_id, Decimal("0")),
            circuit_breaker_failures=circuit_breaker_failures.get(protocol_id, 0),
        )

    return results
