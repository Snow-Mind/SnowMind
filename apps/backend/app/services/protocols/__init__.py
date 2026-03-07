"""Protocol adapter registry."""

from __future__ import annotations

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

    # Euler V2 — always loads, gracefully no-ops when vault is unconfigured
    adapters["euler_v2"] = EulerV2Adapter()

    return adapters


ALL_ADAPTERS: dict[str, BaseProtocolAdapter] = _build_adapters()

# Only these participate in MILP optimisation for MVP
# Document: "MVP: Benqi + Aave V3 (must have)"
ACTIVE_ADAPTERS: dict[str, BaseProtocolAdapter] = {
    k: v
    for k, v in ALL_ADAPTERS.items()
    if k in ("aave_v3", "benqi")
}

# Static risk scores — document Section 4.3
RISK_SCORES: dict[str, float] = {
    "aave_v3":  2.0,   # "Aave: 2 (battle-tested, billions in TVL)"
    "benqi":    3.0,   # "Benqi: 3 (well-established on Avalanche since 2021)"
    "euler_v2": 5.0,   # "Euler v2: 5 (newer, add with caution)"
    "fluid":    5.5,   # "Fluid: 5.5 (newest, add cautiously)"
}


def get_adapter(protocol_id: str) -> BaseProtocolAdapter:
    adapter = ALL_ADAPTERS.get(protocol_id)
    if not adapter:
        raise ValueError(f"Unknown protocol: {protocol_id}")
    return adapter
