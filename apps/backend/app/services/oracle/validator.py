"""Rate sanity checks, anomaly detection, and TWAP smoothing.

Validation pipeline (per rate):
  1. Sanity bound  →  0 < rate < 25 %   (REJECT if violated)
  2. Spike check   →  compare against TWAP history (WARN + use TWAP)
"""

import logging
from dataclasses import dataclass, field
from decimal import Decimal

from supabase import Client

from app.core.config import get_settings
from app.services.oracle.twap import TWAPOracle

logger = logging.getLogger("snowmind")


@dataclass
class ValidationResult:
    """Outcome of validating a single protocol rate."""

    is_valid: bool
    use_rate: Decimal          # the final rate the caller should use
    warnings: list[str] = field(default_factory=list)


class RateValidator:
    """Multi-stage rate validation with oracle defence."""

    def __init__(self, db: Client) -> None:
        self._settings = get_settings()
        self._twap = TWAPOracle(db)
        self._db = db

    # ── Single-rate validation ───────────────────────────────────────────────

    async def validate_single_rate(
        self,
        protocol_id: str,
        rate: Decimal,
        source: str = "on_chain",
    ) -> ValidationResult:
        """Run the three-stage pipeline and return the final usable rate."""
        warnings: list[str] = []

        # ── Stage 1: sanity bound ────────────────────────────────────────
        if rate <= 0:
            logger.critical(
                "Rate non-positive for %s: %s — REJECTED", protocol_id, rate
            )
            return ValidationResult(is_valid=False, use_rate=Decimal(0))

        max_apy = Decimal(str(self._settings.MAX_APY_SANITY_BOUND))
        if rate > max_apy:
            logger.critical(
                "RATE ANOMALY: %s apy=%.6f > bound %.2f — REJECTED",
                protocol_id,
                rate,
                max_apy,
            )
            return ValidationResult(is_valid=False, use_rate=Decimal(0))

        use_rate = rate

        # ── Stage 2: spike detection (TWAP comparison) ───────────────────
        is_spike = await self._twap.detect_rate_spike(protocol_id, rate)
        if is_spike:
            twap_rate = await self._twap.get_twap(protocol_id)
            if twap_rate is not None:
                msg = (
                    f"Spike detected for {protocol_id}: "
                    f"spot={rate:.6f}, using TWAP={twap_rate:.6f}"
                )
                logger.warning(msg)
                warnings.append(msg)
                use_rate = twap_rate
            else:
                msg = (
                    f"Spike detected for {protocol_id} but no TWAP available"
                )
                logger.warning(msg)
                warnings.append(msg)
                # Keep the spot rate but flag it
                warnings.append("Proceeding with caution — no TWAP fallback")


        # Persist the snapshot for future TWAP
        await self._twap.record_snapshot(protocol_id, rate, source)

        return ValidationResult(
            is_valid=True,
            use_rate=use_rate,
            warnings=warnings,
        )

    # ── Batch validation ─────────────────────────────────────────────────────

    async def validate_all_rates(
        self, rates: dict[str, Decimal]
    ) -> dict[str, Decimal]:
        """Validate every protocol rate and return only those that pass.

        Returns a mapping of ``protocol_id → final_rate`` for the protocols
        that survived validation.
        """
        accepted: dict[str, Decimal] = {}
        rejected = 0
        warned = 0

        for pid, rate in rates.items():
            result = await self.validate_single_rate(pid, rate)
            if result.is_valid:
                accepted[pid] = result.use_rate
                if result.warnings:
                    warned += 1
            else:
                rejected += 1

        logger.info(
            "Rate validation: %d accepted, %d warned, %d rejected (of %d)",
            len(accepted),
            warned,
            rejected,
            len(rates),
        )
        return accepted
