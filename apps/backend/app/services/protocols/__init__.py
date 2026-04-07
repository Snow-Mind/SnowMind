"""Protocol adapter registry — Mainnet lending/savings adapters."""

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

    try:
        from .silo import SiloSavUSDAdapter
        adapters["silo_savusd_usdc"] = SiloSavUSDAdapter()
    except Exception as exc:
        logger.warning("SiloSavUSDAdapter not loaded (SILO_SAVUSD_VAULT missing?): %s", exc)

    try:
        from .silo import SiloSUSDpAdapter
        adapters["silo_susdp_usdc"] = SiloSUSDpAdapter()
    except Exception as exc:
        logger.warning("SiloSUSDpAdapter not loaded (SILO_SUSDP_VAULT missing?): %s", exc)

    try:
        from .silo import SiloGamiUSDCAdapter
        adapters["silo_gami_usdc"] = SiloGamiUSDCAdapter()
    except Exception as exc:
        logger.warning("SiloGamiUSDCAdapter not loaded (SILO_GAMI_USDC_VAULT missing?): %s", exc)

    try:
        from .folks import FolksAdapter
        adapters["folks"] = FolksAdapter()
    except Exception as exc:
        logger.warning("FolksAdapter not loaded (FOLKS_USDC_HUB_POOL missing?): %s", exc)

    return adapters


ALL_ADAPTERS: dict[str, BaseProtocolAdapter] = _build_adapters()
ACTIVE_ADAPTERS: dict[str, BaseProtocolAdapter] = ALL_ADAPTERS


def get_adapter(protocol_id: str) -> BaseProtocolAdapter:
    """Get adapter by protocol ID. Raises if not found."""
    if protocol_id == "aave":
        protocol_id = "aave_v3"
    elif protocol_id in {"folks_finance_xchain", "folks_finance"}:
        protocol_id = "folks"
    adapter = ALL_ADAPTERS.get(protocol_id)
    if not adapter:
        raise ValueError(f"Unknown protocol: {protocol_id}")
    return adapter
