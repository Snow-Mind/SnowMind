"""Unit tests for rebalance status reason-code classification."""

from app.api.routes.rebalance import _classify_reason


def test_classify_permission_recovery_as_session_key_invalid() -> None:
    code, detail = _classify_reason(
        is_active=True,
        has_session_key=True,
        idle_usdc=0,
        last_status="skipped",
        last_skip_reason="PERMISSION_RECOVERY_NEEDED for 0xabc — no working session key found",
    )

    assert code == "SESSION_KEY_INVALID"
    assert "PERMISSION_RECOVERY_NEEDED" in detail


def test_classify_stranded_funds_as_no_permitted_protocols() -> None:
    code, _ = _classify_reason(
        is_active=True,
        has_session_key=True,
        idle_usdc=0,
        last_status="skipped",
        last_skip_reason="All funds ($1.50) stranded in protocols outside session key scope: euler_v2. User must re-grant session key.",
    )

    assert code == "NO_PERMITTED_PROTOCOLS"


def test_classify_all_markets_unsafe_as_no_deposit_safe_protocols() -> None:
    code, _ = _classify_reason(
        is_active=True,
        has_session_key=True,
        idle_usdc=0,
        last_status="skipped",
        last_skip_reason=(
            "No protocol passed deposit safety checks; keeping funds idle "
            "| gate=no_deposit_safe_protocols | observed=idle=$10.00 "
            "| threshold=at least one deposit-safe protocol "
            "Skipped markets: Aave (Utilization > 90%); Benqi (Utilization > 90%); Euler (Utilization > 90%)."
        ),
    )

    assert code == "NO_DEPOSIT_SAFE_PROTOCOLS"
