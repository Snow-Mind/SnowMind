"""Static risk scoring model for protocol risk assessment.

MVP: deterministic rules based on base scores + utilization.
Post-MVP: Replace with TD3-BC RL agent output.
"""

from __future__ import annotations

import logging
from decimal import Decimal

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")

# Static base scores (manually assigned, 1-10 scale, lower = safer)
BASE_RISK_SCORES: dict[str, Decimal] = {
    "benqi": Decimal("3.0"),  # Well-established, on Avalanche since 2021
    "aave_v3": Decimal("2.0"),  # Battle-tested, billions in TVL globally
    "euler_v2": Decimal("5.0"),  # Newer, add with caution
    "fluid": Decimal("5.5"),  # Newest, add cautiously
}


class RiskScorer:
    """Compute composite risk scores for lending protocols."""

    def compute_risk_score(
        self,
        protocol_id: str,
        utilization_rate: float | None = None,
        protocol_apy: Decimal = _ZERO,
    ) -> Decimal:
        """
        Composite risk score:
          base_score  — from BASE_RISK_SCORES dict
          +2 if utilization > 85 %  (liquidity risk — hard to withdraw)
          +4 if utilization > 95 %  (extreme liquidity risk)

        Returns final score capped at 10.0.
        """
        base = BASE_RISK_SCORES.get(protocol_id, Decimal("7.0"))
        adjustment = _ZERO

        if utilization_rate is not None:
            if utilization_rate > 0.95:
                adjustment = Decimal("4.0")
            elif utilization_rate > 0.85:
                adjustment = Decimal("2.0")

        score = min(base + adjustment, Decimal("10.0"))
        logger.debug(
            "Risk %s: base=%s util_adj=%s → %s",
            protocol_id,
            base,
            adjustment,
            score,
        )
        return score
