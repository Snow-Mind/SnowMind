from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.protocols.euler_v2 import EulerV2Adapter


RATE_SCALE = Decimal("1e27")
SECONDS_PER_YEAR = Decimal("31536000")
BPS_SCALE = Decimal("10000")


def _make_async_call(value):
    mock = MagicMock()
    mock.call = AsyncMock(return_value=value)
    return mock


@pytest.mark.asyncio
async def test_get_rate_uses_euler_native_formula() -> None:
    settings = SimpleNamespace(
        EULER_VAULT="0x37ca03aD51B8ff79aAD35FadaCBA4CEDF0C3e74e",
        UTILIZATION_THRESHOLD=0.90,
    )

    with patch("app.services.protocols.euler_v2.get_settings", return_value=settings):
        adapter = EulerV2Adapter()

        vault = MagicMock()
        vault.functions.convertToAssets.return_value = _make_async_call(1_032_795_894_282_044_289)
        vault.functions.totalAssets.return_value = _make_async_call(3_483_699_975_819)
        vault.functions.totalBorrows.return_value = _make_async_call(2_921_838_825_879)
        vault.functions.interestRate.return_value = _make_async_call(1_720_711_446_944_836_515)
        vault.functions.interestFee.return_value = _make_async_call(2_000)

        adapter._get_vault = MagicMock(return_value=vault)

        rate = await adapter.get_rate()

    borrow_rate_per_second = Decimal("1720711446944836515") / RATE_SCALE
    borrow_apy = (borrow_rate_per_second * SECONDS_PER_YEAR).exp() - Decimal("1")
    utilization = Decimal("2921838825879") / Decimal("3483699975819")
    fee_factor = Decimal("1") - (Decimal("2000") / BPS_SCALE)
    expected = borrow_apy * utilization * fee_factor

    assert rate.apy > Decimal("0")
    assert abs(rate.apy - expected) < Decimal("0.000001")
    assert rate.utilization_rate is not None
    assert abs(rate.utilization_rate - utilization) < Decimal("0.000001")
