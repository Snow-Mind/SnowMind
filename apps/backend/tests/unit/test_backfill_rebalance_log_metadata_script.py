from app.scripts.backfill_rebalance_log_metadata import _compute_patch


def test_compute_patch_backfills_missing_rebalance_fields() -> None:
    row = {
        "status": "executed",
        "from_protocol": None,
        "to_protocol": None,
        "amount_moved": "$0.00",
        "skip_reason": None,
        "executed_allocations": {"euler_v2": "$1.00", "benqi": "0.50"},
        "proposed_allocations": None,
    }

    patch = _compute_patch(row)

    assert patch["amount_moved"] == "1.500000"
    assert patch["from_protocol"] == "rebalance"
    assert patch["to_protocol"] == "euler_v2"


def test_compute_patch_respects_initial_funding_semantics() -> None:
    row = {
        "status": "executed",
        "from_protocol": None,
        "to_protocol": None,
        "amount_moved": None,
        "skip_reason": "Initial funding transfer",
        "executed_allocations": None,
        "proposed_allocations": {"idle": "50.00"},
    }

    patch = _compute_patch(row)

    assert patch["amount_moved"] == "50.000000"
    assert patch["from_protocol"] == "user_wallet"
    assert patch["to_protocol"] == "idle"


def test_compute_patch_respects_withdraw_semantics() -> None:
    row = {
        "status": "executed",
        "from_protocol": None,
        "to_protocol": "user_eoa",
        "amount_moved": "5.250000",
        "skip_reason": "Funds withdrawn",
        "executed_allocations": None,
        "proposed_allocations": None,
    }

    patch = _compute_patch(row)

    assert patch == {"from_protocol": "withdrawal"}


def test_compute_patch_keeps_valid_rows_unchanged() -> None:
    row = {
        "status": "executed",
        "from_protocol": "rebalance",
        "to_protocol": "spark",
        "amount_moved": "10.000000",
        "skip_reason": None,
        "executed_allocations": {"spark": "10.000000"},
        "proposed_allocations": None,
    }

    patch = _compute_patch(row)

    assert patch == {}


def test_compute_patch_ignores_non_executed_rows() -> None:
    row = {
        "status": "skipped",
        "from_protocol": None,
        "to_protocol": None,
        "amount_moved": None,
        "skip_reason": "No active session key",
        "executed_allocations": {"benqi": "20.0"},
        "proposed_allocations": None,
    }

    assert _compute_patch(row) == {}