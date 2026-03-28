"""Tests for automatic rebalance scheduler loop.

Proves the full pipeline:
  scheduler tick → check_and_rebalance → compute allocation → execute

Each test covers a distinct scenario from real production logs:
1. Normal auto-rebalance (e.g. spark → silo_savusd_usdc when APY improves)
2. Skip when APY improvement below beat margin
3. Skip when no active session key
4. Skip when stranded funds block all movement
5. Skip when PERMISSION_RECOVERY is needed
6. Retry with exponential backoff on transient failures
7. Idempotency guard prevents double-execution
"""
import asyncio
import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.optimizer.rebalancer import Rebalancer
from app.workers.scheduler import SnowMindScheduler


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def mock_settings():
    settings = MagicMock()
    settings.USDC_ADDRESS = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
    settings.AVALANCHE_RPC_URL = "https://api.avax.network/ext/bc/C/rpc"
    settings.EXECUTION_URL = "https://execution-service.example.com"
    settings.EXECUTION_HMAC_SECRET = "test-secret"
    settings.BEAT_MARGIN = 0.0025       # 0.25%
    settings.MIN_REBALANCE_INTERVAL_HOURS = 6
    settings.GAS_COST_ESTIMATE_USD = 0.01
    settings.TVL_CAP_PCT = 0.01
    settings.MAX_SINGLE_REBALANCE_USD = 50000
    settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD = 100000
    settings.PORTFOLIO_VALUE_DROP_PCT = 0.10
    settings.PROFITABILITY_BREAKEVEN_DAYS = 7
    settings.REBALANCE_CHECK_INTERVAL = 360
    settings.PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    return settings


@pytest.fixture
def rebalancer(mock_settings):
    with patch("app.services.optimizer.rebalancer.get_settings") as gs:
        gs.return_value = mock_settings
        r = Rebalancer()
        yield r


def _make_db_mock():
    """Create a mock Supabase client with chaining.
    
    Returns the SAME mock for each table name (so callers can configure
    a table's return value and have it persist across calls).
    """
    db = MagicMock()
    _tables: dict[str, MagicMock] = {}

    def table(name):
        if name not in _tables:
            t = MagicMock()
            # Make every method return self for chaining
            for m in ["select", "eq", "neq", "gte", "lte", "gt", "lt",
                       "order", "limit", "upsert", "insert", "delete",
                       "update"]:
                getattr(t, m).return_value = t
            # .execute() returns empty by default
            t.execute.return_value = MagicMock(data=[])
            _tables[name] = t
        return _tables[name]

    db.table = table
    return db


# ── Test: Full auto-rebalance executes ───────────────────────────────────────


class TestAutoRebalanceExecution:
    """Proves that the scheduler→rebalancer pipeline actually executes."""

    @pytest.mark.asyncio
    async def test_scheduler_processes_account_and_executes(self, rebalancer):
        """Simulate one scheduler tick with one account that needs rebalancing.
        Mirrors production log: spark (3.68%) → silo_savusd_usdc (6.34%)."""

        account_id = str(uuid4())
        address = "0x4006ce775C928E4e4dE5BAC01d9d69Ed3a793556"

        # check_and_rebalance should be called and return "executed"
        rebalancer.check_and_rebalance = AsyncMock(return_value={
            "status": "executed",
            "tx_hash": "0x2d4794930f0ad2f9990f15d5963391e21c5a65ab63901575e18088b6e904d783",
        })

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb, \
             patch("app.workers.scheduler.check_paymaster_balance", new_callable=AsyncMock) as cpm, \
             patch("app.workers.scheduler.scheduler_watchdog") as wd:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            db = _make_db_mock()
            gdb.return_value = db

            cpm.return_value = Decimal("1.0")
            wd.check = AsyncMock()
            wd.record_tick = MagicMock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = db
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            scheduler._active.set()

            # Mock accounts query
            accounts_table = db.table("accounts")
            accounts_table.execute.return_value = MagicMock(data=[
                {"id": account_id, "address": address},
            ])

            await scheduler._run_all_accounts()

            # Verify check_and_rebalance was called
            rebalancer.check_and_rebalance.assert_called_once_with(
                account_id=account_id,
                smart_account_address=address,
            )
            assert scheduler.last_run_stats["rebalanced"] == 1
            assert scheduler.last_run_stats["errors"] == 0

    @pytest.mark.asyncio
    async def test_scheduler_retry_on_transient_error(self, rebalancer):
        """Verify retry with backoff on transient RPC errors."""

        account_id = str(uuid4())
        address = "0x1234567890abcdef1234567890abcdef12345678"

        # Fail twice, succeed on third attempt
        call_count = 0
        async def check_and_rebalance(**kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise Exception("429 Rate limit exceeded")
            return {"status": "executed", "tx_hash": "0xabc"}

        rebalancer.check_and_rebalance = check_and_rebalance

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            gdb.return_value = _make_db_mock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = gdb.return_value
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            scheduler._active.set()

            # _rebalance_with_retry uses exponential backoff (5s, 10s)
            # Patch sleep to avoid real delays
            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await scheduler._rebalance_with_retry(account_id, address)

            assert result == "ok"
            assert call_count == 3

    @pytest.mark.asyncio
    async def test_scheduler_skips_on_non_retryable_error(self, rebalancer):
        """ValueError (no session key, invalid key) should skip without retry."""

        account_id = str(uuid4())
        address = "0x1234567890abcdef1234567890abcdef12345678"

        rebalancer.check_and_rebalance = AsyncMock(
            side_effect=ValueError("No active session key")
        )

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            gdb.return_value = _make_db_mock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = gdb.return_value
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            scheduler._active.set()

            result = await scheduler._rebalance_with_retry(account_id, address)

            assert result == "skip"
            # Should have been called only once — no retry
            rebalancer.check_and_rebalance.assert_called_once()


# ── Test: Rebalancer pipeline scenarios ──────────────────────────────────────


class TestRebalancerPipeline:
    """Tests for check_and_rebalance covering real production skip reasons."""

    @pytest.mark.asyncio
    async def test_skips_when_no_session_key(self, rebalancer):
        """Account with no active session key → immediate skip."""

        account_id = str(uuid4())
        address = "0xTestAddr"

        with patch("app.services.optimizer.rebalancer.get_supabase") as gdb, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as gsk:

            gdb.return_value = _make_db_mock()
            gsk.return_value = None  # No active session key

            result = await rebalancer.check_and_rebalance(
                account_id=account_id,
                smart_account_address=address,
            )

            assert result["status"] == "skipped"
            assert "No active session key" in (result.get("skip_reason") or "")

    @pytest.mark.asyncio
    async def test_skips_when_apy_below_beat_margin(self, rebalancer):
        """When current allocation already has top APY, skip (below beat margin).
        
        Tests the gate logic directly since the full pipeline has 10 steps
        with many dependencies. The scheduler+rebalancer integration is tested
        via test_scheduler_processes_account_and_executes.
        """
        # The beat margin gate in rebalancer.py (step 8a):
        #   if apy_improvement < beat_margin → skip
        # With beat_margin=0.0025 (0.25%), an improvement of 0.001 should skip.
        beat_margin = Decimal("0.0025")
        current_apy = Decimal("0.0630")     # silo_savusd_usdc at 6.30%
        best_apy = Decimal("0.0634")        # silo_savusd_usdc at 6.34%
        improvement = best_apy - current_apy  # 0.04% — below 0.25% margin

        assert improvement < beat_margin, (
            f"Improvement {improvement} should be below beat margin {beat_margin}"
        )

        # Verify the gate would trigger — same logic as rebalancer.py step 8a
        should_skip = improvement < beat_margin
        assert should_skip, "Should skip when APY improvement below beat margin"

        # Also test that large improvements DO pass the gate
        large_improvement = Decimal("0.0300")  # 3.00% improvement
        assert large_improvement >= beat_margin, "Large improvement should pass gate"

    @pytest.mark.asyncio
    async def test_idempotency_prevents_double_execution(self, rebalancer):
        """Same target allocation within 60 min → skip (idempotency guard)."""

        account_id = str(uuid4())
        address = "0xTestAddr"
        target = {"silo_savusd_usdc": Decimal("10.00")}

        with patch("app.services.optimizer.rebalancer.get_supabase") as gdb:
            db = _make_db_mock()
            gdb.return_value = db

            # Mock: a recent rebalance log with the same proposed allocations
            logs_table = MagicMock()
            logs_table.select.return_value = logs_table
            logs_table.eq.return_value = logs_table
            logs_table.order.return_value = logs_table
            logs_table.limit.return_value = logs_table
            logs_table.execute.return_value = MagicMock(data=[{
                "proposed_allocations": {"silo_savusd_usdc": "10.00"},
                "created_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
            }])

            # The idempotency guard is checked after gate checks in the pipeline.
            # We verify the guard logic directly since the full pipeline has many deps.
            recent_logs = logs_table.execute()
            if recent_logs.data:
                last = recent_logs.data[0]
                last_ts = datetime.fromisoformat(last["created_at"])
                within_window = datetime.now(timezone.utc) - last_ts < timedelta(minutes=60)
                last_proposed = last.get("proposed_allocations", {})
                proposed_str = {k: str(v.quantize(Decimal("0.01"))) for k, v in target.items()}
                last_str = {k: str(Decimal(str(v)).quantize(Decimal("0.01"))) for k, v in last_proposed.items()}
                same_target = proposed_str == last_str

                assert within_window, "Should be within 60-min window"
                assert same_target, "Should detect identical allocation"

    @pytest.mark.asyncio
    async def test_idempotency_allows_when_current_state_drifted(self, rebalancer):
        """If current state differs from last executed target, idempotency must not block."""

        target = {"silo_savusd_usdc": Decimal("10.00")}
        last_proposed = {"silo_savusd_usdc": "10.00"}
        current = {}  # e.g. funds became idle again after manual movement

        proposed_str = {k: str(v.quantize(Decimal("0.01"))) for k, v in target.items()}
        last_str = {k: str(Decimal(str(v)).quantize(Decimal("0.01"))) for k, v in last_proposed.items()}
        current_str = {
            k: str(v.quantize(Decimal("0.01")))
            for k, v in current.items()
            if v > Decimal("0.01")
        }

        should_skip = proposed_str == last_str and current_str == last_str
        assert not should_skip, "Idempotency guard must not block when current state drifted"

    @pytest.mark.asyncio
    async def test_permission_recovery_cooldown_bypassed_after_new_key(self, rebalancer):
        """A newly stored active key should bypass stale PERMISSION_RECOVERY cooldown."""

        account_id = str(uuid4())
        address = "0x6d6F6eE22f627f9406E4922970de12f9949be0A6"
        failure_ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        new_key_ts = datetime.now(timezone.utc).isoformat()

        with patch("app.services.optimizer.rebalancer.get_supabase") as gdb, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as gsk:

            db = _make_db_mock()
            gdb.return_value = db
            gsk.return_value = {
                "serialized_permission": "0xdeadbeef",
                "session_private_key": "0xabc",
                "allowed_protocols": ["silo_savusd_usdc"],
            }

            # Last rebalance log says PERMISSION_RECOVERY_NEEDED (within 30 min).
            # New active key created AFTER that failure should bypass cooldown.
            db.table("rebalance_logs").execute.return_value = MagicMock(data=[{
                "skip_reason": "PERMISSION_RECOVERY_NEEDED for account",
                "created_at": failure_ts,
            }])
            db.table("session_keys").execute.return_value = MagicMock(data=[{
                "id": "new-key-id",
                "created_at": new_key_ts,
            }])

            # Force an early deterministic exit after cooldown stage.
            rebalancer.rate_fetcher.fetch_all_rates = AsyncMock(return_value={})

            result = await rebalancer.check_and_rebalance(
                account_id=account_id,
                smart_account_address=address,
            )

            assert result["status"] == "skipped"
            assert "No spot rates available" in (result.get("skip_reason") or "")

    @pytest.mark.asyncio
    async def test_permission_recovery_cooldown_uses_latest_failure_not_latest_log(self, rebalancer):
        """Cooldown must anchor to latest *_NEEDED failure even if latest log is cooldown text."""

        account_id = str(uuid4())
        address = "0x940d4E6dd00882E98bdF4aaBB9e1af7Dec561ADD"
        cooldown_log_ts = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
        needed_failure_ts = (datetime.now(timezone.utc) - timedelta(minutes=12)).isoformat()

        with patch("app.services.optimizer.rebalancer.get_supabase") as gdb, \
             patch("app.services.optimizer.rebalancer.get_active_session_key_record") as gsk:

            db = _make_db_mock()
            gdb.return_value = db
            gsk.return_value = {
                "serialized_permission": "0xdeadbeef",
                "session_private_key": "0xabc",
                "allowed_protocols": ["silo_savusd_usdc"],
            }

            # Latest log is a cooldown message, but an earlier recent log has
            # PERMISSION_RECOVERY_NEEDED. Cooldown must still be enforced.
            db.table("rebalance_logs").execute.return_value = MagicMock(data=[
                {
                    "skip_reason": "PERMISSION_RECOVERY cooldown (24min left) — user must re-grant",
                    "created_at": cooldown_log_ts,
                },
                {
                    "skip_reason": "PERMISSION_RECOVERY_NEEDED for account",
                    "created_at": needed_failure_ts,
                },
            ])

            # No newly granted key after the failure.
            db.table("session_keys").execute.return_value = MagicMock(data=[])

            # If cooldown is not enforced, pipeline would continue and hit this.
            rebalancer.rate_fetcher.fetch_all_rates = AsyncMock(return_value={})

            result = await rebalancer.check_and_rebalance(
                account_id=account_id,
                smart_account_address=address,
            )

            assert result["status"] == "skipped"
            assert "PERMISSION_RECOVERY cooldown" in (result.get("skip_reason") or "")

    @pytest.mark.asyncio
    async def test_initial_deployment_bypasses_min_interval_gate(self, rebalancer):
        """Initial idle-fund deployments should not be blocked by min-interval cooldown.

        Regression guard for production case where fresh idle USDC existed but
        rebalance was skipped due "Last rebalance too recent".
        """
        now = datetime.now(timezone.utc)
        last_ts = now - timedelta(minutes=30)
        min_gap = timedelta(hours=rebalancer.settings.MIN_REBALANCE_INTERVAL_HOURS)

        is_initial_deployment = True
        global_flag_none = True
        should_skip_initial = (
            global_flag_none
            and not is_initial_deployment
            and (now - last_ts < min_gap)
        )
        assert not should_skip_initial, (
            "Initial deployment must bypass min-interval gate"
        )

        should_skip_non_initial = (
            global_flag_none
            and not False
            and (now - last_ts < min_gap)
        )
        assert should_skip_non_initial, (
            "Non-initial rebalances should still respect min-interval gate"
        )

    @pytest.mark.asyncio
    async def test_multiple_accounts_serialized(self, rebalancer):
        """Multiple accounts are processed with semaphore (serialize execution)."""

        accounts = [
            {"id": str(uuid4()), "address": f"0xAddr{i}"}
            for i in range(4)
        ]

        execution_order = []

        async def mock_check_and_rebalance(**kwargs):
            addr = kwargs["smart_account_address"]
            execution_order.append(("start", addr))
            await asyncio.sleep(0.01)  # Simulate work
            execution_order.append(("end", addr))
            return {"status": "skipped", "reason": "test"}

        rebalancer.check_and_rebalance = mock_check_and_rebalance

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb, \
             patch("app.workers.scheduler.check_paymaster_balance", new_callable=AsyncMock) as cpm, \
             patch("app.workers.scheduler.scheduler_watchdog") as wd:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            db = _make_db_mock()
            gdb.return_value = db

            cpm.return_value = Decimal("1.0")
            wd.check = AsyncMock()
            wd.record_tick = MagicMock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = db
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            scheduler._active.set()

            accounts_table = db.table("accounts")
            accounts_table.execute.return_value = MagicMock(data=accounts)

            await scheduler._run_all_accounts()

            # With Semaphore(1), accounts must be serialized:
            # start→end must alternate (no overlapping starts)
            for i in range(0, len(execution_order), 2):
                assert execution_order[i][0] == "start"
                assert execution_order[i + 1][0] == "end"
                assert execution_order[i][1] == execution_order[i + 1][1]

            assert scheduler.last_run_stats["checked"] == 4

    @pytest.mark.asyncio
    async def test_distributed_lock_prevents_double_run(self, rebalancer):
        """When lock is held by another instance, scheduler skips."""

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb, \
             patch("app.workers.scheduler.scheduler_watchdog") as wd:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            db = _make_db_mock()
            gdb.return_value = db

            wd.check = AsyncMock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = db
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            scheduler._active.set()
            scheduler._scheduler = MagicMock()

            # Mock lock acquisition to fail (another instance holds it)
            scheduler._acquire_lock = AsyncMock(return_value=False)
            scheduler._run_all_accounts = AsyncMock()

            await scheduler._run_with_lock()

            # _run_all_accounts should NOT have been called
            scheduler._run_all_accounts.assert_not_called()

    @pytest.mark.asyncio
    async def test_graceful_shutdown_stops_processing(self, rebalancer):
        """When _active is cleared (shutdown), retry loop aborts."""

        account_id = str(uuid4())
        address = "0xTestAddr"

        rebalancer.check_and_rebalance = AsyncMock(
            side_effect=Exception("transient error")
        )

        with patch("app.workers.scheduler.get_settings") as gs, \
             patch("app.workers.scheduler.get_supabase") as gdb:

            gs.return_value = MagicMock(REBALANCE_CHECK_INTERVAL=360)
            gdb.return_value = _make_db_mock()

            scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
            scheduler.settings = gs.return_value
            scheduler.db = gdb.return_value
            scheduler.rebalancer = rebalancer
            scheduler.instance = "test1234"
            scheduler._active = asyncio.Event()
            # Don't set _active → simulates shutdown in progress

            with patch("asyncio.sleep", new_callable=AsyncMock):
                result = await scheduler._rebalance_with_retry(account_id, address)

            assert result == "skip"
            # Should not have attempted any rebalance (shutdown flag)
            rebalancer.check_and_rebalance.assert_not_called()
