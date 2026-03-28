"""Unit tests for initial-deposit tracking safeguards in the rebalancer."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.optimizer.rebalancer import Rebalancer


@pytest.fixture
def rebalancer() -> Rebalancer:
    with patch("app.services.optimizer.rebalancer.get_settings") as mock_settings:
        settings = MagicMock()
        settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
        settings.AVALANCHE_RPC_URL = "https://api.avax.network/ext/bc/C/rpc"
        settings.EXECUTION_URL = "https://execution-service.example.com"
        settings.EXECUTION_HMAC_SECRET = "test-secret"
        settings.BEAT_MARGIN = 0.001
        settings.MIN_REBALANCE_INTERVAL_HOURS = 6
        settings.GAS_COST_ESTIMATE_USD = 0.01
        settings.TVL_CAP_PCT = 0.01
        settings.MAX_SINGLE_REBALANCE_USD = 50000
        settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD = 100000
        settings.PORTFOLIO_VALUE_DROP_PCT = 0.10
        mock_settings.return_value = settings
        yield Rebalancer()


def _mock_tracking_db(row: dict | None = None, *, raise_error: bool = False) -> MagicMock:
    db = MagicMock()
    query = db.table.return_value
    query.select.return_value = query
    query.eq.return_value = query
    query.limit.return_value = query
    if raise_error:
        query.execute.side_effect = RuntimeError("db unavailable")
    else:
        query.execute.return_value = MagicMock(data=[row] if row else [])
    return db


def test_should_record_initial_deposit_when_no_tracking_row(rebalancer: Rebalancer) -> None:
    db = _mock_tracking_db(None)
    assert rebalancer._should_record_initial_deposit(db, "acct-1") is True


def test_should_not_record_when_outstanding_principal_exists(rebalancer: Rebalancer) -> None:
    db = _mock_tracking_db({"cumulative_deposited": "500", "cumulative_net_withdrawn": "50"})
    assert rebalancer._should_record_initial_deposit(db, "acct-1") is False


def test_should_record_when_principal_is_effectively_zero(rebalancer: Rebalancer) -> None:
    db = _mock_tracking_db({"cumulative_deposited": "100.00", "cumulative_net_withdrawn": "100.00"})
    assert rebalancer._should_record_initial_deposit(db, "acct-1") is True


def test_should_skip_write_when_tracking_query_fails(rebalancer: Rebalancer) -> None:
    db = _mock_tracking_db(raise_error=True)
    assert rebalancer._should_record_initial_deposit(db, "acct-1") is False
