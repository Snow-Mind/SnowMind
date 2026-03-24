"""Tests for rebalancer safety guards: stranded positions and balance guard.

These tests verify the fixes for the production failure where:
1. Session key excluded protocols with existing positions (stranded funds)
2. On-chain balance reads 0 while DB has a position → deposit-only rebalance
3. Backend sent deposit-only rebalances with no USDC available
"""
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.optimizer.rebalancer import Rebalancer


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
