"""Protocol adapter registry."""

import logging

from .base import BaseProtocolAdapter
from .aave import AaveV3Adapter
from .euler_v2 import EulerV2Adapter

logger = logging.getLogger("snowmind")

# ── Build adapter map (skip adapters whose contracts aren't configured) ──────


def _build_adapters() -> dict[str, BaseProtocolAdapter]:
    adapters: dict[str, BaseProtocolAdapter] = {}

    # Always available — Aave V3 Pool has a default in config
    adapters["aave_v3"] = AaveV3Adapter()

    # Benqi requires BENQI_POOL to be set
    try:
        from .benqi import BenqiAdapter
        adapters["benqi"] = BenqiAdapter()
    except (ValueError, Exception) as exc:
        logger.warning("BenqiAdapter not loaded (BENQI_POOL missing?): %s", exc)

    # Euler V2 — ERC-4626 mock vault
    adapters["euler_v2"] = EulerV2Adapter()

    # Spark Savings — ERC-4626 mock vault (same interface as Euler)
    try:
        from .spark import SparkAdapter
        adapters["spark"] = SparkAdapter()
    except (ValueError, Exception) as exc:
        logger.warning("SparkAdapter not loaded (SPARK_VAULT missing?): %s", exc)

    return adapters


ALL_ADAPTERS: dict[str, BaseProtocolAdapter] = _build_adapters()

# Protocols that participate in waterfall allocation (all 4 active on mainnet)
ACTIVE_ADAPTERS: dict[str, BaseProtocolAdapter] = {
    k: v
    for k, v in ALL_ADAPTERS.items()
    if k in ("aave_v3", "benqi", "euler_v2", "spark")
}

# Static risk scores — document Section 4.3
RISK_SCORES: dict[str, float] = {
    "aave_v3":  2.0,   # "Aave: 2 (battle-tested, billions in TVL)"
    "benqi":    3.0,   # "Benqi: 3 (well-established on Avalanche since 2021)"
    "euler_v2": 5.0,   # "Euler v2: 5 (newer, add with caution)"
    "spark":    3.0,   # Spark: 3 (MakerDAO-backed, well-audited)
    "fluid":    5.5,   # "Fluid: 5.5 (newest, add cautiously)"
}


def get_adapter(protocol_id: str) -> BaseProtocolAdapter:
    adapter = ALL_ADAPTERS.get(protocol_id)
    if not adapter:
        raise ValueError(f"Unknown protocol: {protocol_id}")
    return adapter
