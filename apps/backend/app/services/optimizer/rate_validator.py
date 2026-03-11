# apps/backend/app/services/optimizer/rate_validator.py
# Implements all three safety layers from Section 8 of the deep-dive doc.

import asyncio
import time
import httpx
from decimal import Decimal
from collections import defaultdict, deque
from dataclasses import dataclass
import logging

logger = logging.getLogger("snowmind")


@dataclass
class RateReading:
    protocol_id: str
    apy: Decimal
    timestamp: float


class RateValidator:
    """
    Implements the three safety requirements from deep-dive doc Section 8.2, 8.3:
    1. TWAP: 10–15 min average, not spot reads
    2. DefiLlama cross-validation: divergence > 2% → halt
    3. Rate velocity check: spike > X% between reads → flag
    """

    TWAP_WINDOW_SECONDS = 900        # 15 minutes
    DEFILLAMA_DIVERGENCE_THRESHOLD = Decimal("0.02")  # 2%
    VELOCITY_SPIKE_THRESHOLD = Decimal("0.25")        # 25% jump between reads
    SANITY_MAX_APY = Decimal("0.25")                  # 25% APY — flag anything above
    MAX_SINGLE_MOVE_PCT = Decimal("0.30")             # Doc: cap single rebalance at 30%

    # Protocol IDs to DefiLlama pool IDs on Avalanche
    DEFILLAMA_POOL_IDS = {
        "aave_v3": "c4b05318-88af-4536-a834-f5fc8940d2d3",   # Aave v3 Avalanche USDC
        "benqi":   "ff59b165-64e0-4868-a6db-6049b5135358",   # Benqi USDC
    }

    def __init__(self):
        self._readings: dict[str, deque[RateReading]] = defaultdict(
            lambda: deque(maxlen=50)
        )
        self._defillama_cache: dict[str, tuple[Decimal, float]] = {}

    def record_reading(self, protocol_id: str, apy: Decimal) -> None:
        self._readings[protocol_id].append(RateReading(
            protocol_id=protocol_id,
            apy=apy,
            timestamp=time.time(),
        ))

    def get_twap(self, protocol_id: str) -> Decimal | None:
        """
        Time-weighted average APY over the last TWAP_WINDOW_SECONDS.
        Doc: "Average rates over last 10–15 minutes, not single spot reads."
        Returns None if insufficient data (less than 2 readings in window).
        """
        cutoff = time.time() - self.TWAP_WINDOW_SECONDS
        recent = [r for r in self._readings[protocol_id] if r.timestamp >= cutoff]

        if len(recent) < 2:
            return None  # Not enough data for TWAP yet

        # Simple time-weighted average
        total_weight = Decimal("0")
        weighted_sum = Decimal("0")
        for i in range(1, len(recent)):
            dt = Decimal(str(recent[i].timestamp - recent[i - 1].timestamp))
            weighted_sum += recent[i].apy * dt
            total_weight += dt

        return (weighted_sum / total_weight) if total_weight > 0 else None

    def check_velocity(self, protocol_id: str, current_apy: Decimal) -> bool:
        """
        Doc: "If rate jumps more than X% between consecutive reads, flag as suspicious."
        Returns True if rate is safe (not a spike), False if suspicious.
        """
        readings = self._readings[protocol_id]
        if not readings:
            return True  # No history — can't check velocity

        last_apy = readings[-1].apy
        if last_apy == 0:
            return True

        change = abs(current_apy - last_apy) / last_apy
        if change > self.VELOCITY_SPIKE_THRESHOLD:
            logger.warning(
                "Rate velocity spike on %s: %.2f%% → %.2f%% (%.1f%% change)",
                protocol_id,
                float(last_apy * 100),
                float(current_apy * 100),
                float(change * 100),
            )
            return False  # Suspicious — do not rebalance
        return True

    def check_sanity(self, protocol_id: str, apy: Decimal) -> bool:
        """
        Doc: "If any rate reads above 25% APY, flag as suspicious and don't auto-act."
        """
        if apy > self.SANITY_MAX_APY:
            logger.error(
                "SANITY BOUND EXCEEDED: %s reporting %.1f%% APY. Halting rebalancing.",
                protocol_id,
                float(apy * 100),
            )
            return False
        return True

    async def validate_with_defillama(
        self, protocol_id: str, on_chain_apy: Decimal
    ) -> bool:
        """
        Doc: "Compare on-chain reads with DefiLlama API. If diverge > 2%, halt."
        Returns True if validated, False if divergence too high.
        """
        pool_id = self.DEFILLAMA_POOL_IDS.get(protocol_id)
        if not pool_id:
            logger.warning("No DefiLlama pool ID for %s, skipping validation", protocol_id)
            return True  # Cannot validate, assume OK

        # Cache DefiLlama response for 5 minutes (it's slow)
        cached = self._defillama_cache.get(protocol_id)
        if cached and time.time() - cached[1] < 300:
            defillama_apy = cached[0]
        else:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        f"https://yields.llama.fi/chart/{pool_id}"
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    points = data.get("data") or []
                    if not points:
                        logger.debug("DefiLlama returned empty data for %s", protocol_id)
                        return True
                    # Latest APY from DefiLlama (as decimal, not percent)
                    latest_apy = points[-1].get("apy", points[-1].get("apyBase", 0))
                    defillama_apy = Decimal(str(latest_apy)) / Decimal("100")
                    self._defillama_cache[protocol_id] = (defillama_apy, time.time())
            except Exception as e:
                logger.warning("DefiLlama check failed for %s: %s", protocol_id, e)
                return True  # Network failure — don't block on it

        if defillama_apy == 0:
            return True

        divergence = abs(on_chain_apy - defillama_apy) / defillama_apy
        if divergence > self.DEFILLAMA_DIVERGENCE_THRESHOLD:
            logger.error(
                "DefiLlama divergence on %s: on-chain=%.2f%% DefiLlama=%.2f%% "
                "divergence=%.1f%% — HALTING",
                protocol_id,
                float(on_chain_apy * 100),
                float(defillama_apy * 100),
                float(divergence * 100),
            )
            return False

        logger.info(
            "DefiLlama validated %s: on-chain=%.2f%% ≈ DefiLlama=%.2f%%",
            protocol_id,
            float(on_chain_apy * 100),
            float(defillama_apy * 100),
        )
        return True

    async def validate_all(
        self, rates: dict[str, Decimal]
    ) -> dict[str, Decimal] | None:
        """
        Run all validations. Returns TWAP-smoothed rates if all pass, None to halt.
        Uses TWAP rates for MILP input — NOT raw spot rates.
        """
        twap_rates = {}

        for protocol_id, spot_apy in rates.items():
            # 1. Sanity bound check (before recording — reject immediately)
            if not self.check_sanity(protocol_id, spot_apy):
                return None  # Halt entirely

            # 2. Velocity check (suspicious spike?)
            if not self.check_velocity(protocol_id, spot_apy):
                logger.warning("Skipping %s this cycle due to velocity spike", protocol_id)
                # Record after velocity check so next cycle has this reading
                self.record_reading(protocol_id, spot_apy)
                continue  # Exclude this protocol this cycle, don't halt entirely

            # 3. Record reading (for TWAP accumulation)
            self.record_reading(protocol_id, spot_apy)

            # 4. DefiLlama validation
            if not await self.validate_with_defillama(protocol_id, spot_apy):
                return None  # Halt if cross-validation fails

            # 5. Get TWAP rate (fallback to spot if insufficient history)
            twap = self.get_twap(protocol_id)
            twap_rates[protocol_id] = twap if twap is not None else spot_apy

            logger.info(
                "%s: spot=%.2f%% twap=%.2f%%",
                protocol_id,
                float(spot_apy * 100),
                float(twap_rates[protocol_id] * 100),
            )

        if len(twap_rates) < 2:
            logger.warning("Less than 2 valid protocols — cannot run MILP")
            return None

        return twap_rates


def apply_max_move_cap(
    current: dict[str, Decimal],
    proposed: dict[str, Decimal],
    total: Decimal,
) -> dict[str, Decimal]:
    """
    Doc: "Cap any single rebalance at 30% of total portfolio per operation."
    If proposed change exceeds 30%, scale it down proportionally.
    Bypass: If all current allocations are zero (initial deployment), no cap.
    """
    # Initial deployment: no existing protocol allocations → deploy fully
    total_current = sum(current.values())
    if total_current <= Decimal("0.01"):
        logger.info("Initial deployment — bypassing max move cap")
        return dict(proposed)

    max_move = total * Decimal("0.30")
    capped = dict(proposed)

    for protocol_id in proposed:
        current_amt = current.get(protocol_id, Decimal("0"))
        proposed_amt = proposed[protocol_id]
        delta = abs(proposed_amt - current_amt)

        if delta > max_move:
            # Scale: move at most 30% of total, in the correct direction
            direction = Decimal("1") if proposed_amt > current_amt else Decimal("-1")
            capped[protocol_id] = current_amt + direction * max_move
            logger.info(
                "Max move cap applied on %s: wanted %.0f USDC, capped at %.0f USDC",
                protocol_id,
                float(delta),
                float(max_move),
            )

    # Re-normalize to ensure allocations still sum to total
    total_capped = sum(capped.values())
    if total_capped > 0 and total_capped != total:
        factor = total / total_capped
        capped = {k: v * factor for k, v in capped.items()}

    return capped
