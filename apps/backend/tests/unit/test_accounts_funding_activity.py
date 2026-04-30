"""Unit tests for persisted funding activity rows during account registration."""

from types import SimpleNamespace
from unittest.mock import patch

from app.api.routes import accounts


class _FakeRebalanceLogsTable:
    def __init__(self, *, existing_tx: bool):
        self._existing_tx = existing_tx
        self._mode = "select"
        self.inserted_rows: list[dict] = []

    def select(self, *_args, **_kwargs):
        self._mode = "select"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def insert(self, row: dict):
        self._mode = "insert"
        self._pending_row = row
        return self

    def execute(self):
        if self._mode == "select":
            return SimpleNamespace(data=[{"id": "existing"}] if self._existing_tx else [])

        self.inserted_rows.append(self._pending_row)
        return SimpleNamespace(data=[self._pending_row])


class _FakeDB:
    def __init__(self, *, existing_tx: bool):
        self.rebalance_logs = _FakeRebalanceLogsTable(existing_tx=existing_tx)

    def table(self, name: str):
        assert name == "rebalance_logs"
        return self.rebalance_logs


def test_record_funding_transfer_inserts_activity_and_updates_principal() -> None:
    """A new funding tx should create an activity row and increment principal."""
    db = _FakeDB(existing_tx=False)

    with patch("app.services.fee_calculator.record_deposit") as record_deposit:
        recorded = accounts._record_funding_transfer(
            db=db,
            account_id="acct-1",
            address="0xabc",
            funding_tx_hash="0xABCDEF",
            funding_amount_usdc="50",
            funding_source="onboarding_wallet_transfer",
            is_existing_account=False,
        )

    assert recorded is True
    assert len(db.rebalance_logs.inserted_rows) == 1
    inserted = db.rebalance_logs.inserted_rows[0]
    assert inserted["from_protocol"] == "user_wallet"
    assert inserted["to_protocol"] == "idle"
    assert inserted["amount_moved"] == "50.000000"
    assert inserted["tx_hash"] == "0xabcdef"
    assert inserted["status"] == "executed"
    assert inserted["correlation_id"] == "funding:onboarding_wallet_transfer"

    record_deposit.assert_called_once()


def test_record_funding_transfer_skips_duplicate_tx_hash() -> None:
    """Duplicate funding tx for same account must be idempotent."""
    db = _FakeDB(existing_tx=True)

    with patch("app.services.fee_calculator.record_deposit") as record_deposit:
        recorded = accounts._record_funding_transfer(
            db=db,
            account_id="acct-1",
            address="0xabc",
            funding_tx_hash="0xABCDEF",
            funding_amount_usdc="50",
            funding_source="onboarding_wallet_transfer",
            is_existing_account=False,
        )

    assert recorded is False
    assert db.rebalance_logs.inserted_rows == []
    record_deposit.assert_not_called()


def test_record_funding_transfer_skips_existing_account_without_tx_hash() -> None:
    """Existing-account retries without tx hash must not inflate principal."""
    db = _FakeDB(existing_tx=False)

    with patch("app.services.fee_calculator.record_deposit") as record_deposit:
        recorded = accounts._record_funding_transfer(
            db=db,
            account_id="acct-1",
            address="0xabc",
            funding_tx_hash=None,
            funding_amount_usdc="50",
            funding_source="onboarding_wallet_transfer",
            is_existing_account=True,
        )

    assert recorded is False
    assert db.rebalance_logs.inserted_rows == []
    record_deposit.assert_not_called()


def test_record_funding_transfer_existing_account_with_new_tx_tracks_top_up() -> None:
    """Existing accounts should still track additional deposits when tx hash is provided."""
    db = _FakeDB(existing_tx=False)

    with patch("app.services.fee_calculator.record_deposit") as record_deposit:
        recorded = accounts._record_funding_transfer(
            db=db,
            account_id="acct-1",
            address="0xabc",
            funding_tx_hash="0xFEDCBA",
            funding_amount_usdc="25",
            funding_source="dashboard_topup",
            is_existing_account=True,
        )

    assert recorded is True
    assert len(db.rebalance_logs.inserted_rows) == 1
    inserted = db.rebalance_logs.inserted_rows[0]
    assert inserted["tx_hash"] == "0xfedcba"
    assert inserted["amount_moved"] == "25.000000"
    assert inserted["correlation_id"] == "funding:dashboard_topup"

    record_deposit.assert_called_once_with(db, "acct-1", accounts.Decimal("25.000000"))
