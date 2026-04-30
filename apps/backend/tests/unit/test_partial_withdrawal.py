"""Unit tests for partial withdrawal share computation.

Tests cover:
    1. Idle USDC covers the entire withdrawal → zero protocol shares
    2. No idle USDC → proportional shares from all protocols
    3. Partial idle coverage → proportional remainder from protocols
    4. Single protocol position → only that protocol's shares used
    5. Zero deployed balance edge case
    6. Fraction capping at 1.0 when needed amount exceeds deployed
    7. Protocol with zero shares → stays zero
    8. 0.5% buffer applied correctly
    9. protocol_fraction accuracy for DB allocation updates
"""

import pytest
from decimal import Decimal

from app.api.routes.withdrawal import _compute_partial_shares


def test_idle_covers_full_withdrawal():
    """When idle USDC >= total needed, all protocol shares should be zero."""
    full_shares = {
        "aave_v3": 5_000_000,
        "benqi": 3_000_000,
        "spark": 2_000_000,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {
        "aave_v3": 5_000_000,
        "benqi": 3_000_000,
        "spark": 2_000_000,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=2_000_000,
        total_needed_raw=1_000_000,
    )

    assert all(v == 0 for v in partial.values())
    assert fraction == Decimal("0")


def test_no_idle_proportional_all_protocols():
    """With zero idle, shares should be proportional to the withdrawal fraction."""
    full_shares = {
        "aave_v3": 10_000_000,
        "benqi": 6_000_000,
        "spark": 4_000_000,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {
        "aave_v3": 10_000_000,
        "benqi": 6_000_000,
        "spark": 4_000_000,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=10_000_000,
    )

    assert fraction == Decimal("0.5")
    # With 0.5% buffer: effective fraction = 0.5 * 1.005 = 0.5025
    assert partial["aave_v3"] == int(Decimal("10000000") * Decimal("0.5025"))
    assert partial["benqi"] == int(Decimal("6000000") * Decimal("0.5025"))
    assert partial["spark"] == int(Decimal("4000000") * Decimal("0.5025"))


def test_partial_idle_coverage():
    """Idle covers part; remainder pulled proportionally from protocols."""
    full_shares = {
        "aave_v3": 8_000_000,
        "benqi": 2_000_000,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {
        "aave_v3": 8_000_000,
        "benqi": 2_000_000,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=1_000_000,
        total_needed_raw=6_000_000,
    )

    assert fraction == Decimal("0.5")
    assert partial["aave_v3"] > 0
    assert partial["benqi"] > 0
    assert partial["spark"] == 0


def test_single_protocol_position():
    """Only one protocol has a position; all withdrawal from that one."""
    full_shares = {
        "aave_v3": 10_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {
        "aave_v3": 10_000_000,
        "benqi": 0,
        "spark": 0,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=5_000_000,
    )

    assert fraction == Decimal("0.5")
    assert partial["aave_v3"] > 0
    assert partial["benqi"] == 0
    assert partial["spark"] == 0


def test_zero_deployed_returns_full_shares():
    """When total deployed is zero, fall back to full shares (fraction=1)."""
    full_shares = {
        "aave_v3": 1_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances={},
        idle_usdc_raw=0,
        total_needed_raw=500_000,
    )

    assert fraction == Decimal("1")
    assert partial == full_shares


def test_fraction_capped_at_one():
    """When needed exceeds deployed (shouldn't happen but guard anyway), fraction = 1."""
    full_shares = {
        "aave_v3": 5_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {"aave_v3": 5_000_000}

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=10_000_000,
    )

    assert fraction == Decimal("1")
    assert partial["aave_v3"] == 5_000_000


def test_buffer_does_not_exceed_full_shares():
    """The 0.5% buffer must not push partial shares above the full balance."""
    full_shares = {
        "aave_v3": 10_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {"aave_v3": 10_000_000}

    # 99.8% withdrawal — buffer would push it to 100.3%, should be capped at 100%
    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=9_980_000,
    )

    assert fraction == Decimal("0.998")
    assert partial["aave_v3"] <= full_shares["aave_v3"]


def test_idle_exactly_equals_needed():
    """Edge case: idle USDC exactly equals the needed amount."""
    full_shares = {
        "aave_v3": 5_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {"aave_v3": 5_000_000}

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=1_000_000,
        total_needed_raw=1_000_000,
    )

    assert all(v == 0 for v in partial.values())
    assert fraction == Decimal("0")


def test_all_six_protocols_proportional():
    """Ensure all six protocol types get proportional shares."""
    full_shares = {
        "aave_v3": 1_000_000,
        "benqi": 2_000_000,
        "spark": 3_000_000,
        "euler_v2": 4_000_000,
        "silo_savusd_usdc": 5_000_000,
        "silo_susdp_usdc": 6_000_000,
    }
    protocol_usdc = {
        "aave_v3": 1_000_000,
        "benqi": 2_000_000,
        "spark": 3_000_000,
        "euler_v2": 4_000_000,
        "silo_savusd_usdc": 5_000_000,
        "silo_susdp_usdc": 6_000_000,
    }

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=10_500_000,
    )

    assert fraction == Decimal("0.5")
    for pid in full_shares:
        assert partial[pid] > 0
        assert partial[pid] < full_shares[pid]


def test_micro_withdrawal_from_large_portfolio():
    """Tiny withdrawal from large portfolio should produce very small share amounts."""
    full_shares = {
        "aave_v3": 100_000_000_000,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {"aave_v3": 100_000_000_000}

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=1,
    )

    assert partial["aave_v3"] >= 1
    assert partial["aave_v3"] < 1_000_000


def test_tiny_partial_withdrawal_does_not_round_positive_protocol_to_zero():
    """A protocol with positive shares and balance should contribute at least 1 share."""
    full_shares = {
        "aave_v3": 5,
        "benqi": 0,
        "spark": 0,
        "euler_v2": 0,
        "silo_savusd_usdc": 0,
        "silo_susdp_usdc": 0,
    }
    protocol_usdc = {"aave_v3": 1_000_000_000}

    partial, fraction = _compute_partial_shares(
        full_shares=full_shares,
        protocol_usdc_balances=protocol_usdc,
        idle_usdc_raw=0,
        total_needed_raw=1,
    )

    assert fraction == Decimal("1E-9")
    assert partial["aave_v3"] == 1
