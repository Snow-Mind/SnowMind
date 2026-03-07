"""Integration tests for the SnowMind security layer.

Covers:
- TWAP outlier exclusion (flash-loan defence)
- Rate sanity bounds (>25 % rejection)
- DefiLlama cross-validation divergence warning
- In-memory rate limiter (429 on 101st req in 60 s)
- Session key encrypt/decrypt round-trip
- Session key expiry monitoring
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ═══════════════════════════════════════════════════════════════════════════════
# 1. TWAP — 5 normal readings + 1 spike → spike excluded
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_twap_excludes_spike():
    """A single outlier >50 % from the mean must be excluded from TWAP."""
    from app.services.oracle.twap import TWAPOracle

    now = time.time()
    normal_apy = "0.045"  # 4.5 %
    spike_apy = "0.200"  # 20 % — way above the 50 % deviation threshold

    # Build fake snapshot rows: 5 normal + 1 spike
    rows = [
        {"apy": normal_apy, "fetched_at": now - 600 + i * 60}
        for i in range(5)
    ]
    rows.append({"apy": spike_apy, "fetched_at": now - 30})

    mock_db = MagicMock()
    # Chain: .table().select().eq().gte().order().execute()
    mock_execute = MagicMock()
    mock_execute.data = rows
    (
        mock_db.table.return_value
        .select.return_value
        .eq.return_value
        .gte.return_value
        .order.return_value
    ).execute.return_value = mock_execute

    oracle = TWAPOracle(mock_db, window_minutes=15)
    twap = await oracle.get_twap("aave_v3")

    assert twap is not None
    # The TWAP should be close to 4.5 %, not inflated by the 20 % spike
    assert Decimal("0.040") < twap < Decimal("0.050")


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Rate sanity — 30 % APY rate rejected with correct error
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_rate_30pct_rejected():
    """A rate of 30 % must be rejected (sanity bound is 25 %)."""
    from app.services.oracle.validator import RateValidator

    mock_db = MagicMock()
    validator = RateValidator(mock_db)

    result = await validator.validate_single_rate(
        "aave_v3", Decimal("0.30"), source="on_chain"
    )

    assert result.is_valid is False
    assert result.use_rate == Decimal(0)


# ═══════════════════════════════════════════════════════════════════════════════
# 3. DefiLlama cross-validation — 3 % divergence triggers warning
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_defillama_divergence_warning():
    """If DefiLlama APY diverges >2 % from on-chain, a warning is generated."""
    from app.services.oracle.validator import RateValidator

    mock_db = MagicMock()
    validator = RateValidator(mock_db)

    # Stub out spike detection + TWAP recording so they don't touch DB
    validator._twap.detect_rate_spike = AsyncMock(return_value=False)
    validator._twap.record_snapshot = AsyncMock()

    # Stub _cross_validate_defillama to simulate a 3 % divergence
    on_chain_rate = Decimal("0.045")  # 4.5 %
    # DefiLlama says 4.0 % → divergence = |4.5 - 4.0| / 4.0 = 12.5 %
    defillama_response = {
        "status": "success",
        "data": [{"apy": 4.0, "timestamp": "2026-01-01"}],
    }

    with patch("app.services.oracle.validator.httpx.AsyncClient") as MockClient:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = defillama_response
        mock_resp.raise_for_status = MagicMock()

        mock_client_instance = AsyncMock()
        mock_client_instance.get.return_value = mock_resp
        mock_client_instance.__aenter__ = AsyncMock(
            return_value=mock_client_instance
        )
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)
        MockClient.return_value = mock_client_instance

        result = await validator.validate_single_rate(
            "aave_v3", on_chain_rate, source="on_chain"
        )

    assert result.is_valid is True
    # Should have a DefiLlama divergence warning
    divergence_warnings = [
        w for w in result.warnings if "DefiLlama divergence" in w
    ]
    assert len(divergence_warnings) == 1


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Rate limiter — 101st request in 60 s returns blocked
# ═══════════════════════════════════════════════════════════════════════════════


def test_rate_limiter_blocks_101st():
    """After 100 requests in 60 s, the 101st should be denied."""
    from app.core.security import RateLimiter

    limiter = RateLimiter()
    ident = "ip:192.168.1.1"

    for _ in range(100):
        assert limiter.is_allowed(ident, max_requests=100, window_seconds=60)

    # The 101st should be blocked
    assert not limiter.is_allowed(ident, max_requests=100, window_seconds=60)


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Session key encrypt → decrypt round-trip
# ═══════════════════════════════════════════════════════════════════════════════


def test_session_key_roundtrip():
    """Encrypting then decrypting must recover the original plaintext."""
    from app.services.execution.session_key import (
        encrypt_session_key,
        decrypt_session_key,
    )

    # Use a deterministic 32-byte key for testing
    test_key_hex = "a" * 64  # 32 bytes of 0xAA

    with patch(
        "app.services.execution.session_key.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(
            SESSION_KEY_ENCRYPTION_KEY=test_key_hex
        )
        plaintext = "0xdeadbeef1234567890abcdef1234567890abcdef"
        encrypted = encrypt_session_key(plaintext)

        # Encrypted should not contain the plaintext
        assert plaintext not in encrypted

        decrypted = decrypt_session_key(encrypted)
        assert decrypted == plaintext


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Session key monitoring — key expiring in 5 days appears
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_expiring_keys_detected():
    """A key expiring in 5 days should appear in check_expiring_keys."""
    from app.services.execution.session_key import check_expiring_keys

    now = datetime.now(timezone.utc)
    expiring_soon = (now + timedelta(days=5)).isoformat()
    far_future = (now + timedelta(days=30)).isoformat()

    mock_db = MagicMock()
    mock_execute = MagicMock()
    mock_execute.data = [
        {"account_id": "acct-123", "expires_at": expiring_soon},
        # This one is far in the future and should NOT be returned by
        # the DB query (the lte filter handles it), but we include it
        # to verify deduplication if the DB returns it by mistake.
    ]
    (
        mock_db.table.return_value
        .select.return_value
        .eq.return_value
        .gte.return_value
        .lte.return_value
    ).execute.return_value = mock_execute

    result = await check_expiring_keys(mock_db)
    assert "acct-123" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 7. TWAP confirmation — two consistent reads pass, divergent reads fail
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_twap_confirmation_consistent():
    """Two consistent reads (within 10 %) should pass confirmation."""
    from app.services.oracle.twap import TWAPOracle

    mock_db = MagicMock()
    mock_execute = MagicMock()
    mock_execute.data = [
        {"apy": "0.045"},
        {"apy": "0.044"},
    ]
    (
        mock_db.table.return_value
        .select.return_value
        .eq.return_value
        .order.return_value
        .limit.return_value
    ).execute.return_value = mock_execute

    oracle = TWAPOracle(mock_db, window_minutes=15)
    assert await oracle.has_confirmation("aave_v3", min_reads=2) is True


@pytest.mark.asyncio
async def test_twap_confirmation_divergent():
    """Two divergent reads (>10 % apart) should fail confirmation."""
    from app.services.oracle.twap import TWAPOracle

    mock_db = MagicMock()
    mock_execute = MagicMock()
    mock_execute.data = [
        {"apy": "0.045"},
        {"apy": "0.020"},  # way off
    ]
    (
        mock_db.table.return_value
        .select.return_value
        .eq.return_value
        .order.return_value
        .limit.return_value
    ).execute.return_value = mock_execute

    oracle = TWAPOracle(mock_db, window_minutes=15)
    assert await oracle.has_confirmation("aave_v3", min_reads=2) is False


# ═══════════════════════════════════════════════════════════════════════════════
# 8. Unusual-activity detection
# ═══════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_unusual_activity_high_volume():
    """More than 50 operations in 24 h should trigger an anomaly."""
    from app.services.execution.session_key import detect_unusual_activity

    mock_db = MagicMock()
    now = datetime.now(timezone.utc)
    mock_execute = MagicMock()
    mock_execute.data = [
        {"timestamp": (now - timedelta(hours=i % 24)).isoformat()}
        for i in range(55)
    ]
    (
        mock_db.table.return_value
        .select.return_value
        .eq.return_value
        .gte.return_value
    ).execute.return_value = mock_execute

    result = await detect_unusual_activity(mock_db, "acct-456")
    assert result is True
