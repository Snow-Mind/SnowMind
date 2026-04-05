from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.services.optimizer.rebalancer import Rebalancer


def _mock_settings(rebalance_interval_seconds: int = 3_600, min_interval_hours: float = 1.0):
    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
    settings.AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
    settings.BENQI_QIUSDC = "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C"
    settings.SPARK_SPUSDC = "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d"
    settings.EULER_VAULT = "0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e"
    settings.SILO_SAVUSD_VAULT = "0x606fe9a70338e798a292CA22C1F28C829F24048E"
    settings.SILO_SUSDP_VAULT = "0x8ad697a333569ca6f04c8c063e9807747ef169c1"
    settings.PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    settings.REBALANCE_CHECK_INTERVAL = rebalance_interval_seconds
    settings.MIN_REBALANCE_INTERVAL_HOURS = min_interval_hours
    return settings


def test_min_rebalance_gap_uses_balance_tiers():
    with patch("app.services.optimizer.rebalancer.get_settings") as gs:
        gs.return_value = _mock_settings(rebalance_interval_seconds=3_600, min_interval_hours=1.0)
        rebalancer = Rebalancer()

        assert rebalancer._min_rebalance_gap(Decimal("50")) == timedelta(hours=12)
        assert rebalancer._min_rebalance_gap(Decimal("3000")) == timedelta(hours=12)
        assert rebalancer._min_rebalance_gap(Decimal("5000")) == timedelta(hours=4)
        assert rebalancer._min_rebalance_gap(Decimal("50000")) == timedelta(hours=2)
        assert rebalancer._min_rebalance_gap(Decimal("500000")) == timedelta(hours=1)


def test_min_rebalance_gap_respects_scheduler_floor():
    with patch("app.services.optimizer.rebalancer.get_settings") as gs:
        gs.return_value = _mock_settings(rebalance_interval_seconds=28_800, min_interval_hours=1.0)
        rebalancer = Rebalancer()

        # Tier would be 2h for this balance, but scheduler floor is 8h.
        assert rebalancer._min_rebalance_gap(Decimal("50000")) == timedelta(hours=8)
