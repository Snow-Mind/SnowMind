"""Static risk scoring model for protocol risk assessment.

MVP: deterministic rules based on base scores + utilization.
Post-MVP: Replace with TD3-BC RL agent output.
"""

import logging
from decimal import Decimal

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")

# Static base scores (from snowmind-risk-scoring.md, 1-10 scale, higher = safer)
BASE_RISK_SCORES: dict[str, Decimal] = {
    "benqi": Decimal("9.0"),    # Safety 3 + Liquidity 2 + Collateral 2 + Yield 2 + Architecture 1
    "aave_v3": Decimal("10.0"), # Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 1
    "euler_v2": Decimal("6.0"), # Safety 2 + Liquidity 2 + Collateral 1 + Yield 1 + Architecture 0
    "spark": Decimal("3.0"),    # MakerDAO-backed, well-audited
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
        Composite risk score (higher = safer):
          base_score  — from BASE_RISK_SCORES dict
          -2 if utilization > 85 %  (liquidity risk — hard to withdraw)
          -4 if utilization > 95 %  (extreme liquidity risk)

        Returns final score clamped to [0, 10].
        """
        base = BASE_RISK_SCORES.get(protocol_id, Decimal("5.0"))
        adjustment = _ZERO

        if utilization_rate is not None:
            if utilization_rate > 0.95:
                adjustment = Decimal("-4.0")
            elif utilization_rate > 0.85:
                adjustment = Decimal("-2.0")

        score = max(_ZERO, min(base + adjustment, Decimal("10.0")))
        logger.debug(
            "Risk %s: base=%s util_adj=%s → %s",
            protocol_id,
            base,
            adjustment,
            score,
        )
        return score
