"""Tests for rebalancer safety guards: stranded positions and balance guard.

These tests verify the fixes for the production failure where:
1. Session key excluded protocols with existing positions (stranded funds)
2. On-chain balance reads 0 while DB has a position → deposit-only rebalance
3. Backend sent deposit-only rebalances with no USDC available
"""
import asyncio
import httpx
import pytest
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.optimizer.rebalancer import Rebalancer
import app.services.optimizer.rebalancer as rebalancer_module


@pytest.fixture
def rebalancer():
    """Create a Rebalancer with mocked settings."""
    with patch("app.services.optimizer.rebalancer.get_settings") as mock_settings:
        settings = MagicMock()
        settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
        settings.AVALANCHE_RPC_URL = "https://api.avax.network/ext/bc/C/rpc"
        settings.EXECUTION_URL = "https://execution-service.example.com"
        settings.EXECUTION_HMAC_SECRET = "test-secret"
        settings.BEAT_MARGIN = 0.001
        settings.MIN_REBALANCE_INTERVAL_HOURS = 6
        settings.SESSION_KEY_EXPIRY_GRACE_SECONDS = 120
        settings.GAS_COST_ESTIMATE_USD = 0.01
        settings.TVL_CAP_PCT = 0.01
        settings.MAX_SINGLE_REBALANCE_USD = 50000
        settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD = 100000
        settings.PORTFOLIO_VALUE_DROP_PCT = 0.10
        mock_settings.return_value = settings
        r = Rebalancer()
        yield r


class TestBalanceGuard:
    """Tests for execute_rebalance balance guard."""

    @pytest.mark.asyncio
    async def test_deposit_only_with_no_usdc_skips(self, rebalancer):
        """When deposits exceed available funds, rebalance should be skipped."""
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        # Mock: on-chain shows euler=0, DB has euler=5
        mock_allocations = {
            "euler_v2": Decimal("0"),  # on-chain corrected to 0
        }

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk:

            mock_current.return_value = mock_allocations
            mock_idle.return_value = Decimal("0")  # no idle USDC
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "0xabc",
                "allowed_protocols": ["silo_susdp_usdc", "benqi"],
                "expires_at": expires_later,
            }

            # Target: deposit $5 into Silo (but there's no USDC)
            target = {"silo_susdp_usdc": Decimal("5.00")}
            result = await rebalancer.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account,
                target_allocations=target,
            )

            # Should return None (skipped) because balance guard triggers
            assert result is None

    @pytest.mark.asyncio
    async def test_withdrawal_plus_deposit_passes_guard(self, rebalancer):
        """When withdrawal covers deposit, balance guard should pass."""
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        # Mock: on-chain shows euler=5 (correct)
        mock_allocations = {
            "euler_v2": Decimal("5.00"),  # on-chain balance matches
        }

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec, \
             patch.object(rebalancer, "_update_allocations_db", new_callable=AsyncMock) as mock_update, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk, \
             patch("app.services.optimizer.rebalancer.get_adapter") as mock_adapter:

            mock_current.return_value = mock_allocations
            mock_idle.return_value = Decimal("0")
            mock_exec.return_value = "0xtxhash123"
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "0xabc",
                "allowed_protocols": ["silo_susdp_usdc", "euler_v2"],
                "expires_at": expires_later,
            }
            mock_adapter.return_value = None  # benqi adapter not needed

            # Target: move $5 from Euler to Silo
            target = {"silo_susdp_usdc": Decimal("5.00")}
            result = await rebalancer.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account,
                target_allocations=target,
            )

            # Should proceed (withdraw Euler $5 → deposit Silo $5)
            assert result == "0xtxhash123"
            mock_exec.assert_called_once()

    @pytest.mark.asyncio
    async def test_idle_usdc_covers_deposit(self, rebalancer):
        """Idle USDC alone should be enough to pass the balance guard."""
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        mock_allocations = {}  # no existing positions

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec, \
             patch.object(rebalancer, "_update_allocations_db", new_callable=AsyncMock) as mock_update, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk:

            mock_current.return_value = mock_allocations
            mock_idle.return_value = Decimal("10.00")  # $10 idle USDC
            mock_exec.return_value = "0xtxhash456"
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "0xabc",
                "allowed_protocols": ["benqi"],
                "expires_at": expires_later,
            }

            # Target: deposit $10 into Benqi from idle USDC
            target = {"benqi": Decimal("10.00")}
            result = await rebalancer.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account,
                target_allocations=target,
            )

            assert result == "0xtxhash456"
            mock_exec.assert_called_once()

    @pytest.mark.asyncio
    async def test_known_idle_balance_bypasses_transient_idle_read_failures(self, rebalancer):
        """Known idle balance from preflight should prevent false deposit guard skips."""
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec, \
             patch.object(rebalancer, "_update_allocations_db", new_callable=AsyncMock), \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk:

            mock_current.return_value = {}
            mock_idle.return_value = Decimal("0")  # would fail guard if consulted
            mock_exec.return_value = "0xtxhash789"
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "0xabc",
                "allowed_protocols": ["benqi"],
                "expires_at": expires_later,
            }

            result = await rebalancer.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account,
                target_allocations={"benqi": Decimal("1.00")},
                known_idle_usdc=Decimal("1.00"),
            )

            assert result == "0xtxhash789"
            mock_exec.assert_called_once()
            mock_idle.assert_not_called()


class TestExecutionLock:
    """Tests for per-account execution lock in rebalance pipeline."""

    @pytest.mark.asyncio
    async def test_execute_rebalance_once_runs_when_unlocked(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        target = {"benqi": Decimal("1.00")}

        rebalancer_module._REBALANCE_EXECUTION_LOCKS.clear()

        with patch.object(rebalancer, "execute_rebalance", new_callable=AsyncMock) as mock_exec:
            mock_exec.return_value = "0xtestlock"

            result = await rebalancer._execute_rebalance_once(
                account_id=account_id,
                smart_account_address=smart_account,
                target_allocations=target,
            )

            assert result == "0xtestlock"
            mock_exec.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_execute_rebalance_once_raises_when_in_flight(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        target = {"benqi": Decimal("1.00")}

        rebalancer_module._REBALANCE_EXECUTION_LOCKS.clear()
        lock = asyncio.Lock()
        await lock.acquire()
        rebalancer_module._REBALANCE_EXECUTION_LOCKS[account_id] = lock

        try:
            with pytest.raises(RuntimeError, match="REBALANCE_IN_FLIGHT"):
                await rebalancer._execute_rebalance_once(
                    account_id=account_id,
                    smart_account_address=smart_account,
                    target_allocations=target,
                )
        finally:
            lock.release()
            rebalancer_module._REBALANCE_EXECUTION_LOCKS.clear()


class TestSessionKeyExpirySafety:
    """Tests for session-key expiry grace protections."""

    @pytest.mark.asyncio
    async def test_check_and_rebalance_skips_when_key_expires_within_grace(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"

        expiring_soon = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
        session_record = {
            "serialized_permission": "test",
            "session_private_key": "0xabc",
            "allowed_protocols": ["benqi"],
            "expires_at": expiring_soon,
        }

        with patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_key, \
             patch.object(rebalancer.rate_fetcher, "fetch_all_rates", new_callable=AsyncMock) as mock_rates, \
             patch.object(rebalancer, "_log", new_callable=AsyncMock) as mock_log:

            mock_db_fn.return_value = MagicMock()
            mock_key.return_value = session_record
            mock_log.return_value = {
                "status": "skipped",
                "skip_reason": "Session key expires within 120s safety window",
            }

            result = await rebalancer.check_and_rebalance(
                account_id=account_id,
                smart_account_address=smart_account,
            )

            assert result["status"] == "skipped"
            mock_rates.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_execute_rebalance_raises_when_key_expires_within_grace(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expiring_soon = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk:

            mock_current.return_value = {}
            mock_idle.return_value = Decimal("1.00")
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "0xabc",
                "allowed_protocols": ["benqi"],
                "expires_at": expiring_soon,
            }

            with pytest.raises(ValueError, match="expires within"):
                await rebalancer.execute_rebalance(
                    account_id=account_id,
                    smart_account_address=smart_account,
                    target_allocations={"benqi": Decimal("1.00")},
                )

            mock_exec.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_check_and_rebalance_short_circuits_when_lock_is_in_flight(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"

        rebalancer_module._REBALANCE_EXECUTION_LOCKS.clear()
        lock = asyncio.Lock()
        await lock.acquire()
        rebalancer_module._REBALANCE_EXECUTION_LOCKS[account_id] = lock

        try:
            with patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
                 patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_key, \
                 patch.object(rebalancer.rate_fetcher, "fetch_all_rates", new_callable=AsyncMock) as mock_rates, \
                 patch.object(rebalancer, "_log", new_callable=AsyncMock) as mock_log:

                mock_db_fn.return_value = MagicMock()
                mock_key.return_value = {
                    "serialized_permission": "test",
                    "session_private_key": "0xabc",
                    "allowed_protocols": ["benqi"],
                    "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
                }
                mock_log.return_value = {
                    "status": "skipped",
                    "skip_reason": "Another rebalance attempt in flight",
                }

                result = await rebalancer.check_and_rebalance(
                    account_id=account_id,
                    smart_account_address=smart_account,
                )

                assert result["status"] == "skipped"
                mock_rates.assert_not_awaited()
        finally:
            lock.release()
            rebalancer_module._REBALANCE_EXECUTION_LOCKS.clear()


class TestSessionKeyPrivateKeySafety:
    """Tests for fail-fast behavior when session private key is unavailable."""

    @pytest.mark.asyncio
    async def test_call_execution_service_revokes_on_missing_private_key_validation(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"

        request = httpx.Request("POST", "https://execution-service.example.com/execute-rebalance")
        response = httpx.Response(
            status_code=400,
            request=request,
            json={
                "error": "Validation failed",
                "details": ["sessionPrivateKey is required"],
            },
        )
        validation_error = httpx.HTTPStatusError(
            "400 Bad Request",
            request=request,
            response=response,
        )

        with patch("app.services.optimizer.rebalancer.ExecutionService") as mock_exec_cls, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.revoke_session_key") as mock_revoke:

            mock_exec = mock_exec_cls.return_value
            mock_exec.execute_rebalance = AsyncMock(side_effect=validation_error)
            mock_db_fn.return_value = MagicMock()

            with pytest.raises(ValueError, match="missing session private key"):
                await rebalancer._call_execution_service(
                    serialized_permission="serialized",
                    smart_account_address=smart_account,
                    withdrawals=[{"protocol": "benqi", "amountUSDC": 1.0}],
                    deposits=[],
                    session_private_key="",
                    account_id=account_id,
                )

            mock_revoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_rebalance_deactivates_key_when_private_key_missing(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        with patch.object(rebalancer, "_get_current_allocations", new_callable=AsyncMock) as mock_current, \
             patch.object(rebalancer, "_get_idle_usdc_balance", new_callable=AsyncMock) as mock_idle, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec, \
             patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk, \
             patch("app.services.optimizer.rebalancer.revoke_session_key") as mock_revoke:

            mock_current.return_value = {}
            mock_idle.return_value = Decimal("1.00")
            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "",
                "allowed_protocols": ["benqi"],
                "expires_at": expires_later,
            }

            with pytest.raises(ValueError, match="missing session private key"):
                await rebalancer.execute_rebalance(
                    account_id=account_id,
                    smart_account_address=smart_account,
                    target_allocations={"benqi": Decimal("1.00")},
                )

            mock_revoke.assert_called_once()
            mock_exec.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_execute_partial_withdrawal_deactivates_key_when_private_key_missing(self, rebalancer):
        account_id = str(uuid4())
        smart_account = "0xea5e76244dcAE7b17d9787b804F76dAaF6923184"
        expires_later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        with patch("app.services.optimizer.rebalancer.get_supabase") as mock_db_fn, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as mock_sk, \
             patch("app.services.optimizer.rebalancer.revoke_session_key") as mock_revoke, \
             patch.object(rebalancer, "_call_execution_service", new_callable=AsyncMock) as mock_exec:

            mock_db_fn.return_value = MagicMock()
            mock_sk.return_value = {
                "serialized_permission": "test",
                "session_private_key": "",
                "allowed_protocols": ["benqi"],
                "expires_at": expires_later,
            }

            with pytest.raises(ValueError, match="missing session private key"):
                await rebalancer.execute_partial_withdrawal(
                    account_id=account_id,
                    smart_account_address=smart_account,
                    protocol_id="benqi",
                    amount_usdc=1.0,
                )

            mock_revoke.assert_called_once()
            mock_exec.assert_not_awaited()
