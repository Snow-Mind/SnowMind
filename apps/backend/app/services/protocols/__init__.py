"""Protocol adapter registry — Mainnet beta: Aave V3, Benqi, Spark only."""

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

    return adapters


ALL_ADAPTERS: dict[str, BaseProtocolAdapter] = _build_adapters()
ACTIVE_ADAPTERS: dict[str, BaseProtocolAdapter] = ALL_ADAPTERS

# Risk scores per architecture spec
RISK_SCORES: dict[str, float] = {
    "aave_v3":  2.0,   # Battle-tested since 2020, $10B+ TVL globally
    "benqi": 3.0,   # Established on Avalanche since 2021
    "spark": 3.0,   # MakerDAO-backed, well-audited (Avalanche < 6 months)
}


def get_adapter(protocol_id: str) -> BaseProtocolAdapter:
    """Get adapter by protocol ID. Raises if not found."""
    if protocol_id == "aave":
        protocol_id = "aave_v3"
    adapter = ALL_ADAPTERS.get(protocol_id)
    if not adapter:
        raise ValueError(f"Unknown protocol: {protocol_id}")
    return adapter
