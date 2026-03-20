"""Protocol adapter registry — Mainnet: Aave V3, Benqi, Spark, Euler V2."""

import logging

from .base import BaseProtocolAdapter

logger = logging.getLogger("snowmind.protocols")


def _build_adapters() -> dict[str, BaseProtocolAdapter]:
    """Build adapter map. Skip adapters whose contracts aren't configured."""
    adapters: dict[str, BaseProtocolAdapter] = {}

    try:
        from .aave import AaveV3Adapter
        adapters["aave_v3"] = AaveV3Adapter()
    except Exception as exc:
        logger.warning("AaveV3Adapter not loaded: %s", exc)

    try:
        from .benqi import BenqiAdapter
        adapters["benqi"] = BenqiAdapter()
    except Exception as exc:
        logger.warning("BenqiAdapter not loaded (BENQI_QIUSDC missing?): %s", exc)

    try:
        from .spark import SparkAdapter
        adapters["spark"] = SparkAdapter()
    except Exception as exc:
        logger.warning("SparkAdapter not loaded (SPARK_SPUSDC missing?): %s", exc)

    try:
        from .euler_v2 import EulerV2Adapter
        adapters["euler_v2"] = EulerV2Adapter()
    except Exception as exc:
        logger.warning("EulerV2Adapter not loaded (EULER_VAULT missing?): %s", exc)

    return adapters


ALL_ADAPTERS: dict[str, BaseProtocolAdapter] = _build_adapters()
ACTIVE_ADAPTERS: dict[str, BaseProtocolAdapter] = ALL_ADAPTERS

# Risk scores per snowmind-risk-scoring.md framework (higher = safer, out of 10)
RISK_SCORES: dict[str, float] = {
    "aave_v3":  10.0,  # Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 1
    "benqi": 9.0,      # Safety 3 + Liquidity 2 + Collateral 2 + Yield 2 + Architecture 1
    "spark": 9.0,      # Safety 3 + Liquidity 3 + Collateral 2 + Yield 2 + Architecture 0
    "euler_v2": 6.0,   # Safety 2 + Liquidity 2 + Collateral 1 + Yield 1 + Architecture 0
}


def get_adapter(protocol_id: str) -> BaseProtocolAdapter:
    """Get adapter by protocol ID. Raises if not found."""
    if protocol_id == "aave":
        protocol_id = "aave_v3"
    adapter = ALL_ADAPTERS.get(protocol_id)
    if not adapter:
        raise ValueError(f"Unknown protocol: {protocol_id}")
    return adapter
