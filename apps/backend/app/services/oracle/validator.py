"""Rate sanity checks, anomaly detection, and DefiLlama cross-validation.

Validation pipeline (per rate):
  1. Sanity bound  →  0 < rate < 25 %   (REJECT if violated)
  2. Spike check   →  compare against TWAP history (WARN + use TWAP)
  3. DefiLlama     →  cross-validate (WARN if >2 % divergence)
"""

import logging
from dataclasses import dataclass, field
from decimal import Decimal

import httpx
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


# DefiLlama pool-ID mapping for Avalanche mainnet pools.
# Missing pool IDs are treated as non-fatal and only skip cross-validation.
_DEFILLAMA_POOL_MAP: dict[str, str] = {
    "aave_v3": "c4b05318-88af-4536-a834-f5fc8940d2d3",
    "benqi":   "ff59b165-64e0-4868-a6db-6049b5135358",
    "spark":   "e96cbd55-a0a0-446a-89ba-ada6e2991d50",
    "euler_v2": "e1db168e-7c9d-4285-9d3f-ba83a9ecf105",
}


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

        # ── Stage 3: DefiLlama cross-validation ─────────────────────────
        defillama_warnings = await self._cross_validate_defillama(
            protocol_id, use_rate
        )
        warnings.extend(defillama_warnings)

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

    # ── DefiLlama cross-validation ───────────────────────────────────────────

    async def _cross_validate_defillama(
        self, protocol_id: str, on_chain_rate: Decimal
    ) -> list[str]:
        """Compare on-chain rate against DefiLlama yield API."""
        pool_id = _DEFILLAMA_POOL_MAP.get(protocol_id)
        if pool_id is None:
            return []  # no mapping → skip

        base = self._settings.DEFILLAMA_BASE_URL.rstrip("/")
        threshold = Decimal(str(self._settings.RATE_DIVERGENCE_THRESHOLD))
        url = f"{base}/chart/{pool_id}"

        warnings: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()

            # DefiLlama ``/chart/{pool}`` returns ``{status, data: [{...}]}``
            points = data.get("data") or []
            if not points:
                return []

            latest = points[-1]
            dl_apy = Decimal(str(latest.get("apy", latest.get("apyBase", 0))))
            if dl_apy <= 0:
                return []

            # Convert on-chain rate (decimal, e.g. 0.045) to percentage if
            # DefiLlama reports in percent (e.g. 4.5).
            on_chain_pct = on_chain_rate * 100
            divergence = abs(on_chain_pct - dl_apy) / dl_apy

            if divergence > threshold:
                msg = (
                    f"DefiLlama divergence for {protocol_id}: "
                    f"on_chain={on_chain_pct:.4f}% vs DL={dl_apy:.4f}% "
                    f"(Δ={divergence:.4f} > {threshold})"
                )
                logger.warning(msg)
                warnings.append(msg)

        except httpx.HTTPError as exc:
            logger.warning(
                "DefiLlama cross-validation failed for %s: %s",
                protocol_id,
                exc,
            )
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning(
                "DefiLlama response parsing error for %s: %s",
                protocol_id,
                exc,
            )

        return warnings
