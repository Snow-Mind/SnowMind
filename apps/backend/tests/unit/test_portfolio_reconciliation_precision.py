"""Unit tests for portfolio balance reconciliation precision and read failure behavior."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.routes import portfolio


def test_should_refresh_amount_tracks_small_yield_deltas() -> None:
    """Small positive growth should be reflected instead of hidden behind coarse thresholds."""
    assert portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.000200"))
    assert not portfolio._should_refresh_amount(Decimal("50.000000"), Decimal("50.0000004"))


class _IdleReadCall:
    def __init__(self, value=None, error: Exception | None = None):
        self._value = value
        self._error = error

    async def call(self):
        if self._error is not None:
            raise self._error
        return self._value


class _IdleReadFunctions:
    def __init__(self, value=None, error: Exception | None = None):
        self._value = value
        self._error = error

    def balanceOf(self, _address):
        return _IdleReadCall(value=self._value, error=self._error)


class _IdleReadContract:
    def __init__(self, value=None, error: Exception | None = None):
        self.functions = _IdleReadFunctions(value=value, error=error)


class _IdleReadEth:
    def __init__(self, value=None, error: Exception | None = None):
        self._value = value
        self._error = error

    def contract(self, **_kwargs):
        return _IdleReadContract(value=self._value, error=self._error)


class _IdleReadW3:
    def __init__(self, value=None, error: Exception | None = None):
        self.eth = _IdleReadEth(value=value, error=error)

    @staticmethod
    def to_checksum_address(address: str) -> str:
        return address


@pytest.mark.asyncio
async def test_get_idle_usdc_returns_none_after_retries() -> None:
    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_shared_async_web3",
        return_value=_IdleReadW3(error=RuntimeError("rpc unavailable")),
    ):
        result = await portfolio._get_idle_usdc("0xabc")

    assert result is None


@pytest.mark.asyncio
async def test_get_idle_usdc_reads_onchain_balance_when_available() -> None:
    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio.get_shared_async_web3",
        return_value=_IdleReadW3(value=1_500_000),
    ):
        result = await portfolio._get_idle_usdc("0xabc")

    assert result == Decimal("1.5")


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


def _topic_from_address(address: str) -> bytes:
    return bytes.fromhex(("0" * 24) + address.lower().replace("0x", ""))


class _ReceiptQuery:
    def __init__(self, effects):
        self._effects = list(effects)
        self.not_ = self

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

    def execute(self):
        if not self._effects:
            return _Response()
        return self._effects.pop(0)


class _ReceiptDB:
    def __init__(self, tx_hash: str):
        self._query = _ReceiptQuery(
            [
                _Response(count=1),
                _Response(data=[{"tx_hash": tx_hash}]),
            ]
        )

    def table(self, name: str):
        if name != "rebalance_logs":
            raise AssertionError(f"Unexpected table: {name}")
        return self._query


class _FakeWeb3ForReceipt:
    def __init__(self, receipt: dict):
        self._receipt = receipt
        self.eth = self

    async def get_transaction_receipt(self, _tx_hash: str):
        return self._receipt


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_prefers_snowtrace_when_available() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
    owner = "0x97950A98980a2Fc61ea7eb043bb7666845f77071"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc
    settings.SNOWTRACE_API_KEY = "test-key"
    settings.SNOWTRACE_API_URL = "https://api.snowtrace.io/api"

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio._collect_principal_from_snowtrace",
        new=AsyncMock(return_value=(Decimal("3"), Decimal("1"))),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rebalance_receipts",
        new=AsyncMock(return_value=(Decimal("2"), Decimal("1"))),
    ):
        reconciled = await portfolio._reconcile_principal_tracking_from_chain(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address=owner,
        )

    assert reconciled == Decimal("2.000000")
    assert db.tracking_query.upsert_payload is not None
    assert db.tracking_query.upsert_payload["cumulative_deposited"] == "3.000000"
    assert db.tracking_query.upsert_payload["cumulative_net_withdrawn"] == "1.000000"
    assert db.tracking_query.upsert_on_conflict == "account_id"


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_falls_back_to_receipts() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
    owner = "0x97950A98980a2Fc61ea7eb043bb7666845f77071"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc
    settings.SNOWTRACE_API_KEY = ""
    settings.SNOWTRACE_API_URL = "https://api.snowtrace.io/api"

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio._collect_principal_from_snowtrace",
        new=AsyncMock(return_value=None),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rebalance_receipts",
        new=AsyncMock(return_value=(Decimal("2"), Decimal("1"))),
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


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_falls_back_to_rpc_logs() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
    owner = "0x97950A98980a2Fc61ea7eb043bb7666845f77071"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc
    settings.SNOWTRACE_API_KEY = ""
    settings.SNOWTRACE_API_URL = "https://api.snowtrace.io/api"

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio._collect_principal_from_snowtrace",
        new=AsyncMock(return_value=None),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rebalance_receipts",
        new=AsyncMock(return_value=None),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rpc_logs",
        new=AsyncMock(return_value=(Decimal("5"), Decimal("2"))),
    ):
        reconciled = await portfolio._reconcile_principal_tracking_from_chain(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address=owner,
        )

    assert reconciled == Decimal("3.000000")
    assert db.tracking_query.upsert_payload is not None
    assert db.tracking_query.upsert_payload["cumulative_deposited"] == "5.000000"
    assert db.tracking_query.upsert_payload["cumulative_net_withdrawn"] == "2.000000"


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_uses_activity_logs_when_owner_missing() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc
    settings.SNOWTRACE_API_KEY = ""
    settings.SNOWTRACE_API_URL = "https://api.snowtrace.io/api"

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio._collect_principal_from_snowtrace",
        new=AsyncMock(return_value=None),
    ) as snowtrace_mock, patch(
        "app.api.routes.portfolio._collect_principal_from_rebalance_receipts",
        new=AsyncMock(return_value=None),
    ) as receipt_mock, patch(
        "app.api.routes.portfolio._collect_principal_from_rpc_logs",
        new=AsyncMock(return_value=None),
    ) as rpc_mock, patch(
        "app.api.routes.portfolio._collect_principal_from_activity_rows",
        new=AsyncMock(return_value=(Decimal("100"), Decimal("50"))),
    ) as activity_mock:
        reconciled = await portfolio._reconcile_principal_tracking_from_chain(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address="",
        )

    assert reconciled == Decimal("50.000000")
    assert snowtrace_mock.await_count == 0
    assert receipt_mock.await_count == 0
    assert rpc_mock.await_count == 0
    assert activity_mock.await_count == 1
    assert db.tracking_query.upsert_payload is not None
    assert db.tracking_query.upsert_payload["cumulative_deposited"] == "100.000000"
    assert db.tracking_query.upsert_payload["cumulative_net_withdrawn"] == "50.000000"


@pytest.mark.asyncio
async def test_reconcile_principal_tracking_uses_snowtrace_outstanding_principal() -> None:
    portfolio._principal_reconcile_cooldowns.clear()

    smart = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
    owner = "0xe476858cf5fba6d45bc6f7c082edc5d3c4737a48"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"

    settings = MagicMock()
    settings.USDC_ADDRESS = usdc
    settings.SNOWTRACE_API_KEY = "test-key"
    settings.SNOWTRACE_API_URL = "https://api.snowtrace.io/api"

    db = _FakeDB()
    with patch("app.api.routes.portfolio.get_settings", return_value=settings), patch(
        "app.api.routes.portfolio._collect_principal_from_snowtrace",
        new=AsyncMock(return_value=(Decimal("20"), Decimal("15"), Decimal("10"))),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rebalance_receipts",
        new=AsyncMock(return_value=None),
    ), patch(
        "app.api.routes.portfolio._collect_principal_from_rpc_logs",
        new=AsyncMock(return_value=None),
    ):
        reconciled = await portfolio._reconcile_principal_tracking_from_chain(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address=owner,
        )

    # Lifetime net is 5, but current-cycle outstanding principal is 10.
    assert reconciled == Decimal("10.000000")
    assert db.tracking_query.upsert_payload is not None
    assert db.tracking_query.upsert_payload["cumulative_deposited"] == "20.000000"
    assert db.tracking_query.upsert_payload["cumulative_net_withdrawn"] == "10.000000"


@pytest.mark.asyncio
async def test_collect_principal_from_activity_rows_ignores_rows_without_tx_hash() -> None:
    query = MagicMock()
    query.not_ = query
    query.select.return_value = query
    query.eq.return_value = query
    query.is_.return_value = query
    query.execute.return_value = MagicMock(
        data=[
            {
                "from_protocol": "user_wallet",
                "to_protocol": "idle",
                "amount_moved": "1",
                "tx_hash": None,
            },
            {
                "from_protocol": "user_wallet",
                "to_protocol": "idle",
                "amount_moved": "2",
                "tx_hash": "0xabc",
            },
            {
                "from_protocol": "withdrawal",
                "to_protocol": "user_eoa",
                "amount_moved": "0.5",
                "tx_hash": "0xdef",
            },
        ]
    )

    db = MagicMock()
    db.table.return_value = query

    deposited, withdrawn = await portfolio._collect_principal_from_activity_rows(db, "acct-1")
    assert deposited == Decimal("2")
    assert withdrawn == Decimal("0.5")


@pytest.mark.asyncio
async def test_collect_principal_from_rebalance_receipts_infers_routed_withdrawal() -> None:
    smart = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
    owner = "0x97950A98980a2Fc61ea7eb043bb7666845f77071"
    router = "0xCda75578328D0CB0e79dB7797289c44fa02a77ad"
    recipient = "0x88f15e36308ed060d8543da8e2a5da0810efded2"
    usdc = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
    tx_hash = "0x123"

    transfer_sig = bytes.fromhex(
        "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    )
    receipt = {
        "logs": [
            {
                "address": usdc,
                "topics": [
                    transfer_sig,
                    _topic_from_address(owner),
                    _topic_from_address(smart),
                ],
                "data": int(2_000_000).to_bytes(32, "big"),
            },
            {
                "address": usdc,
                "topics": [
                    transfer_sig,
                    _topic_from_address(smart),
                    _topic_from_address(router),
                ],
                "data": int(1_000_000).to_bytes(32, "big"),
            },
            {
                "address": usdc,
                "topics": [
                    transfer_sig,
                    _topic_from_address(router),
                    _topic_from_address(recipient),
                ],
                "data": int(1_000_000).to_bytes(32, "big"),
            },
        ]
    }

    db = _ReceiptDB(tx_hash)
    with patch(
        "app.api.routes.portfolio.get_shared_async_web3",
        return_value=_FakeWeb3ForReceipt(receipt),
    ), patch(
        "app.api.routes.portfolio._is_eoa_address",
        new=AsyncMock(return_value=True),
    ):
        deposited, withdrawn = await portfolio._collect_principal_from_rebalance_receipts(
            db=db,
            account_id="acct-1",
            smart_address=smart,
            owner_address=owner,
            usdc_address=usdc,
        )

    assert deposited == Decimal("2")
    assert withdrawn == Decimal("1")
