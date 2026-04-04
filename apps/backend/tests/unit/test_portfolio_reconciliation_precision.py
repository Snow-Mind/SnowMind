"""Unit tests for portfolio balance reconciliation precision and read failure behavior."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes import portfolio


def test_should_refresh_amount_tracks_small_yield_deltas() -> None:
    """Small positive growth should be reflected instead of hidden behind coarse thresholds."""
    assert portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.000200"))
    assert not portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.0000004"))


@pytest.mark.asyncio
async def test_get_protocol_balance_returns_none_after_rate_limit_retries() -> None:
    """Protocol balance reads should fail-safe (None) after retrying 429 errors."""
    adapter = MagicMock()
    adapter.get_user_balance = AsyncMock(side_effect=RuntimeError("429 Too Many Requests"))

    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    rpc_manager = MagicMock()

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_adapter", return_value=adapter
    ), patch("app.core.rpc.get_rpc_manager", return_value=rpc_manager):
        result = await portfolio._get_protocol_balance("0xabc", "benqi")

    assert result is None
    assert adapter.get_user_balance.await_count == 2
    rpc_manager.report_rate_limit.assert_called_once()


@pytest.mark.asyncio
async def test_get_protocol_balance_returns_none_on_non_retryable_error() -> None:
    """Non-rate-limit balance read failures should return None immediately."""
    adapter = MagicMock()
    adapter.get_user_balance = AsyncMock(side_effect=RuntimeError("execution reverted"))

    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_adapter", return_value=adapter
    ):
        result = await portfolio._get_protocol_balance("0xabc", "benqi")

    assert result is None
    assert adapter.get_user_balance.await_count == 1


class _Response:
    def __init__(self, *, data=None, count=None):
        self.data = data if data is not None else []
        self.count = count


class _Query:
    def __init__(self, execute_side_effect):
        self._effects = list(execute_side_effect)
        self.not_ = self
        self.upsert_payload = None
        self.upsert_on_conflict = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def is_(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def upsert(self, payload, on_conflict=None):
        self.upsert_payload = payload
        self.upsert_on_conflict = on_conflict
        return self

    def execute(self):
        if not self._effects:
            return _Response()
        effect = self._effects.pop(0)
        return effect


class _FakeDB:
    def __init__(self):
        self.rebalance_logs_query = _Query(
            [
                _Response(count=2),
                _Response(data=[{"tx_hash": "0xtx1"}, {"tx_hash": "0xtx2"}]),
            ]
        )
        self.tracking_query = _Query([_Response(data=[{"ok": True}])])

    def table(self, name: str):
        if name == "rebalance_logs":
            return self.rebalance_logs_query
        if name == "account_yield_tracking":
            return self.tracking_query
        raise AssertionError(f"Unexpected table: {name}")


def _topic(value: str):
    return SimpleNamespace(hex=lambda: value)


def _data(amount_raw: int):
    return SimpleNamespace(hex=lambda: hex(amount_raw))


def _pad_topic(address: str) -> str:
    return "0x" + ("0" * 24) + address.lower().replace("0x", "")


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_from_chain_updates_tracking() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
    owner = "0x97950A98980a2Fc61ea7eb043bb7666845f77071"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    deposit_log = {
        "address": usdc,
        "topics": [
            _topic("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
            _topic(_pad_topic(owner)),
            _topic(_pad_topic(smart)),
        ],
        "data": _data(2_000_000),
    }
    withdraw_log = {
        "address": usdc,
        "topics": [
            _topic("ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"),
            _topic(_pad_topic(smart)),
            _topic(_pad_topic(owner)),
        ],
        "data": _data(1_000_000),
    }

    fake_w3 = MagicMock()
    fake_w3.eth.get_transaction_receipt = AsyncMock(
        side_effect=[
            {"logs": [deposit_log]},
            {"logs": [withdraw_log]},
        ]
    )

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_shared_async_web3", return_value=fake_w3
    ):
        reconciled = await portfolio._reconcile_principal_tracking_from_chain(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address=owner,
        )

    assert reconciled == Decimal("1.000000")
    assert db.tracking_query.upsert_payload is not None
    assert db.tracking_query.upsert_payload["cumulative_deposited"] == "2.000000"
    assert db.tracking_query.upsert_payload["cumulative_net_withdrawn"] == "1.000000"
    assert db.tracking_query.upsert_on_conflict == "account_id"
