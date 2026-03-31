"""Production scheduler with distributed locking, retry, and graceful shutdown."""

import asyncio
import logging
import signal
import uuid
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.execution.session_key import is_session_key_expiry_valid
from app.services.optimizer.rebalancer import Rebalancer
from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.protocols import ALL_ADAPTERS
from app.services.monitoring import (
    check_paymaster_balance,
    scheduler_watchdog,
    send_telegram_alert,
    send_sentry_alert,
)

logger = logging.getLogger("snowmind")


class SnowMindScheduler:
    """
    Production scheduler with:
    - Distributed lock (only one Railway instance runs at a time)
    - Retry with exponential backoff
    - Graceful shutdown (no partial rebalances)
    - Protocol health circuit breaker
    """

    LOCK_TTL = 400    # seconds — longer than check interval
    MAX_RETRIES = 3

    def __init__(self) -> None:
        self.settings   = get_settings()
        self.db: Client = get_supabase()
        self.rebalancer = Rebalancer()
        self.instance   = uuid.uuid4().hex[:8]
        self._active    = asyncio.Event()
        self._active.set()
        self._scheduler = AsyncIOScheduler(timezone="UTC")
        self.last_run: datetime | None = None
        self.last_run_stats: dict | None = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self) -> None:
        self._scheduler.add_job(
            self._run_with_lock, "interval",
            seconds=self.settings.REBALANCE_CHECK_INTERVAL,
            id="rebalance", max_instances=1, coalesce=True, misfire_grace_time=60,
            next_run_time=datetime.now(timezone.utc),
        )
        self._scheduler.add_job(
            self._reconcile_balances, "cron",
            hour=3, minute=0, id="reconcile",
        )
        self._scheduler.add_job(
            self._snapshot_daily_apy, "cron",
            hour=2, minute=0, id="apy_snapshot",
        )
        self._scheduler.add_job(
            self._snapshot_platform_kpi, "cron",
            hour=1, minute=50, id="platform_kpi_snapshot",
        )
        # Seed Spark convertToAssets snapshot on startup if table is empty
        self._scheduler.add_job(
            self._seed_spark_snapshot_if_needed, "date",
            run_date=datetime.now(timezone.utc) + timedelta(seconds=10),
            id="spark_seed",
        )
        # Purge old TWAP/Spark snapshots daily at 4:00 UTC
        self._scheduler.add_job(
            self._purge_old_snapshots, "cron",
            hour=4, minute=0, id="snapshot_purge",
        )
        self._scheduler.start()
        logger.info(
            "Scheduler started [instance=%s, interval=%ds]",
            self.instance, self.settings.REBALANCE_CHECK_INTERVAL,
        )

    def stop(self) -> None:
        self._active.clear()
        self._scheduler.shutdown(wait=True)
        logger.info("Scheduler stopped cleanly [instance=%s]", self.instance)

    @property
    def running(self) -> bool:
        return self._scheduler.running

    @property
    def next_run(self) -> datetime | None:
        job = self._scheduler.get_job("rebalance")
        return job.next_run_time if job else None

    # ── Distributed Lock ─────────────────────────────────────────────────────

    async def _acquire_lock(self) -> bool:
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        expiry = (now + timedelta(seconds=self.LOCK_TTL)).isoformat()

        try:
            # Fast path: try creating the lock row.
            self.db.table("scheduler_locks").insert(
                {
                    "key": "rebalance_lock",
                    "holder": self.instance,
                    "expires_at": expiry,
                }
            ).execute()
            return True
        except Exception:
            # Row already exists (or transient insert failure). Try claiming only
            # if the existing lock is expired.
            pass

        try:
            claimed = (
                self.db.table("scheduler_locks")
                .update({"holder": self.instance, "expires_at": expiry})
                .eq("key", "rebalance_lock")
                .lte("expires_at", now_iso)
                .execute()
            )
            if claimed.data:
                return True

            # Verify we still hold a non-expired lock from an earlier cycle.
            check = (
                self.db.table("scheduler_locks")
                .select("holder")
                .eq("key", "rebalance_lock")
                .eq("holder", self.instance)
                .gte("expires_at", now_iso)
                .execute()
            )
            return len(check.data) > 0
        except Exception as e:
            logger.warning("Lock acquisition error: %s", e)
            return False

    async def _release_lock(self) -> None:
        try:
            (
                self.db.table("scheduler_locks")
                .delete()
                .eq("key", "rebalance_lock")
                .eq("holder", self.instance)
                .execute()
            )
        except Exception as e:
            logger.warning("Lock release error: %s", e)

    # ── Main run cycle ───────────────────────────────────────────────────────

    async def _run_with_lock(self) -> None:
        if not self._active.is_set():
            return

        # Watchdog check — fires even if we don't acquire lock
        try:
            await scheduler_watchdog.check()
        except Exception as exc:
            logger.error("Watchdog check error: %s", exc)

        if not await self._acquire_lock():
            logger.debug("Lock held by another instance, skipping")
            return
        try:
            await self._run_all_accounts()
        finally:
            await self._release_lock()

    async def _run_all_accounts(self) -> None:
        self.last_run = datetime.now(timezone.utc)

        # ── Paymaster balance check ──────────────────────────────────
        try:
            from decimal import Decimal
            balance = await check_paymaster_balance()
            if balance == Decimal("-1"):
                logger.warning("Paymaster balance check inconclusive — proceeding")
        except Exception as exc:
            logger.error("Paymaster balance check error: %s", exc)

        accounts = (
            self.db.table("accounts")
            .select("id, address")
            .eq("is_active", True)
            .execute()
        )
        if not accounts.data:
            logger.info("No active accounts — nothing to do")
            self.last_run_stats = {
                "checked": 0,
                "rebalanced": 0,
                "skipped": 0,
                "errors": 0,
                "no_session_key": 0,
            }
            return

        active_keys = (
            self.db.table("session_keys")
            .select("account_id, expires_at")
            .eq("is_active", True)
            .execute()
        )
        now = datetime.now(timezone.utc)
        active_account_ids = {
            str(row.get("account_id"))
            for row in (active_keys.data or [])
            if row.get("account_id") and is_session_key_expiry_valid(row.get("expires_at"), now)
        }

        eligible_accounts = [
            account for account in accounts.data
            if str(account.get("id")) in active_account_ids
        ]
        skipped_no_key = len(accounts.data) - len(eligible_accounts)

        if skipped_no_key > 0:
            logger.info(
                "Skipping %d active account(s) with no valid session key",
                skipped_no_key,
            )

        if not eligible_accounts:
            logger.info("No active accounts with valid session keys — nothing to do")
            self.last_run_stats = {
                "checked": 0,
                "rebalanced": 0,
                "skipped": 0,
                "errors": 0,
                "no_session_key": skipped_no_key,
            }
            return

        logger.info(
            "Processing %d eligible account(s) out of %d active",
            len(eligible_accounts),
            len(accounts.data),
        )

        results: list[str] = []

        # Process accounts sequentially with a stagger delay between them
        # to reduce sustained RPC / execution-service load on Railway.
        STAGGER_DELAY_SECONDS = 2
        for i, account in enumerate(eligible_accounts):
            result = await self._rebalance_with_retry(
                account["id"], account["address"],
            )
            results.append(result)
            # Stagger: small delay between accounts (skip after last)
            if i < len(eligible_accounts) - 1:
                await asyncio.sleep(STAGGER_DELAY_SECONDS)

        stats = {
            "checked": len(results),
            "rebalanced": results.count("ok"),
            "skipped": results.count("skip"),
            "errors": results.count("error"),
            "no_session_key": skipped_no_key,
        }
        self.last_run_stats = stats
        logger.info("Scheduler tick done — %s", stats)

        # ── Record healthy tick for watchdog ─────────────────────────
        scheduler_watchdog.record_tick()

    # ── Retry logic ──────────────────────────────────────────────────────────

    async def _rebalance_with_retry(
        self, account_id: str, address: str,
    ) -> str:
        last_err = None
        for attempt in range(self.MAX_RETRIES):
            if not self._active.is_set():
                return "skip"
            try:
                result = await self.rebalancer.check_and_rebalance(
                    account_id=account_id,
                    smart_account_address=address,
                )
                status = result.get("status", "unknown") if result else "skip"
                if status == "executed":
                    return "ok"
                return "skip"
            except ValueError as e:
                # Non-retryable (e.g. missing session key, no positions)
                logger.debug("Non-retryable error for %s: %s", account_id, e)
                return "skip"
            except Exception as e:
                last_err = e
                if attempt < self.MAX_RETRIES - 1:
                    wait = 5 * (2 ** attempt)   # 5s, 10s, 20s
                    logger.warning(
                        "Rebalance attempt %d failed for %s (%s), retrying in %ds: %s",
                        attempt + 1,
                        account_id,
                        type(e).__name__,
                        wait,
                        e,
                    )
                    await asyncio.sleep(wait)

        logger.error(
            "All retries exhausted for %s (%s): %s",
            account_id,
            type(last_err).__name__ if last_err is not None else "UnknownError",
            last_err,
        )
        return "error"

    # ── Protocol circuit breaker ─────────────────────────────────────────────

    async def record_protocol_failure(self, protocol_id: str, reason: str) -> None:
        """Doc: 'If protocol starts reverting, auto-exclude from candidate set'"""
        result = (
            self.db.table("protocol_health")
            .select("consecutive_fails")
            .eq("protocol_id", protocol_id)
            .execute()
        )
        current = result.data[0]["consecutive_fails"] if result.data else 0
        new_count = current + 1
        is_excluded = new_count >= 3   # Exclude after 3 consecutive failures

        now_iso = datetime.now(timezone.utc).isoformat()
        self.db.table("protocol_health").upsert(
            {
                "protocol_id": protocol_id,
                "consecutive_fails": new_count,
                "last_fail_at": now_iso,
                "is_excluded": is_excluded,
                "excluded_reason": reason if is_excluded else None,
                "updated_at": now_iso,
            },
            on_conflict="protocol_id",
        ).execute()

        if is_excluded:
            logger.error(
                "Protocol %s EXCLUDED after %d consecutive failures. Reason: %s",
                protocol_id, new_count, reason,
            )

    async def record_protocol_success(self, protocol_id: str) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        self.db.table("protocol_health").upsert(
            {
                "protocol_id": protocol_id,
                "consecutive_fails": 0,
                "is_excluded": False,
                "excluded_reason": None,
                "updated_at": now_iso,
            },
            on_conflict="protocol_id",
        ).execute()

    # ── Daily APY snapshots ─────────────────────────────────────────────────

    async def _snapshot_daily_apy(self) -> None:
        """Record one APY reading per protocol per day for 30-day averages."""
        try:
            fetcher = RateFetcher()
            rates = await fetcher.fetch_active_rates()
            if not rates:
                logger.warning("APY snapshot: no rates available")
                return

            today = datetime.now(timezone.utc).date().isoformat()
            for pid, rate in rates.items():
                try:
                    self.db.table("daily_apy_snapshots").upsert(
                        {
                            "protocol_id": pid,
                            "date": today,
                            "apy": str(rate.apy),
                            "tvl_usd": str(rate.tvl_usd),
                        },
                        on_conflict="protocol_id,date",
                    ).execute()
                except Exception as e:
                    logger.warning("APY snapshot failed for %s: %s", pid, e)

            logger.info("Daily APY snapshot recorded for %d protocols", len(rates))
        except Exception as e:
            logger.error("APY snapshot job failed: %s", e)

        # Save convertToAssets snapshots for ALL ERC-4626 vault adapters
        from app.services.optimizer.rate_fetcher import _VAULT_SNAPSHOT_PROTOCOLS
        fetcher_for_snapshots = RateFetcher()
        for vault_pid in _VAULT_SNAPSHOT_PROTOCOLS:
            try:
                await fetcher_for_snapshots.save_vault_daily_snapshot(vault_pid)
            except Exception as e:
                logger.error("%s daily snapshot failed: %s", vault_pid, e)

    async def _snapshot_platform_kpi(self) -> None:
        """Persist daily platform KPI snapshot if migration 014 is present."""
        try:
            self.db.rpc("snapshot_platform_kpi").execute()
            logger.info("Platform KPI snapshot refreshed")
        except Exception as e:
            logger.warning("Platform KPI snapshot failed (migration may be missing): %s", e)

    # ── Vault snapshot seed ────────────────────────────────────────────────

    async def _seed_spark_snapshot_if_needed(self) -> None:
        """Seed initial convertToAssets snapshots for ALL ERC-4626 vault adapters,
        and purge stale 1e6-scale Spark snapshots that cause scale mismatch errors.

        Without at least one 1e18-scale snapshot per vault, APY falls back to
        the short-term share-price estimator (noisier, less accurate).
        This runs once on startup, 10 seconds after the scheduler starts.
        """
        from app.services.optimizer.rate_fetcher import _VAULT_SNAPSHOT_PROTOCOLS

        fetcher = RateFetcher()

        for vault_pid in _VAULT_SNAPSHOT_PROTOCOLS:
            try:
                result = (
                    self.db.table("spark_convert_snapshots")
                    .select("id, convert_to_assets_value")
                    .eq("protocol_id", vault_pid)
                    .order("snapshot_at", desc=True)
                    .limit(5)
                    .execute()
                )
                if not result.data:
                    logger.info("%s snapshot missing — seeding initial snapshot", vault_pid)
                    await fetcher.save_vault_daily_snapshot(vault_pid)
                    continue

                # Purge stale 1e6-scale values (< 10^12) — only relevant for Spark
                from decimal import Decimal
                stale_ids = [
                    row["id"] for row in result.data
                    if Decimal(str(row["convert_to_assets_value"])) < Decimal("1000000000000")
                ]
                if stale_ids:
                    logger.warning(
                        "Found %d stale 1e6-scale %s snapshots — purging",
                        len(stale_ids), vault_pid,
                    )
                    for sid in stale_ids:
                        self.db.table("spark_convert_snapshots").delete().eq("id", sid).execute()

                    remaining = (
                        self.db.table("spark_convert_snapshots")
                        .select("id")
                        .eq("protocol_id", vault_pid)
                        .limit(1)
                        .execute()
                    )
                    if not remaining.data:
                        logger.info("No valid %s snapshots remain — re-seeding", vault_pid)
                        await fetcher.save_vault_daily_snapshot(vault_pid)
                else:
                    logger.info("%s snapshot table has valid data — skipping seed", vault_pid)
            except Exception as e:
                logger.error("Failed to seed %s snapshot: %s", vault_pid, e)

    # ── Snapshot cleanup ────────────────────────────────────────────────────

    async def _purge_old_snapshots(self) -> None:
        """Delete TWAP and Spark snapshots older than 7 days.

        The TWAP buffer only needs the 3 most recent snapshots per protocol,
        and Spark APY only needs yesterday's value. Keeping 7 days provides
        ample margin while preventing unbounded table growth.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        cutoff_epoch = (datetime.now(timezone.utc) - timedelta(days=7)).timestamp()

        # Purge twap_snapshots (uses fetched_at as Unix epoch float)
        try:
            result = (
                self.db.table("twap_snapshots")
                .delete()
                .lt("fetched_at", cutoff_epoch)
                .execute()
            )
            deleted = len(result.data) if result.data else 0
            if deleted > 0:
                logger.info("Purged %d TWAP snapshots older than 7 days", deleted)
        except Exception as e:
            logger.error("TWAP snapshot purge failed: %s", e)

        # Purge spark_convert_snapshots (uses snapshot_at as timestamptz)
        try:
            result = (
                self.db.table("spark_convert_snapshots")
                .delete()
                .lt("snapshot_at", cutoff)
                .execute()
            )
            deleted = len(result.data) if result.data else 0
            if deleted > 0:
                logger.info("Purged %d Spark snapshots older than 7 days", deleted)
        except Exception as e:
            logger.error("Spark snapshot purge failed: %s", e)

    # ── Balance reconciliation ───────────────────────────────────────────────

    async def _reconcile_balances(self) -> None:
        """Verify DB allocation records match on-chain reality daily.

        Alerts on any discrepancy above the configured threshold.
        This is the single most important control for detecting
        unauthorized fund movement or accounting bugs.
        """
        from decimal import Decimal
        from app.services.monitoring import send_telegram_alert, send_sentry_alert

        settings = get_settings()
        threshold = Decimal(str(settings.RECONCILIATION_ALERT_THRESHOLD_USD))
        accounts = (
            self.db.table("accounts")
            .select("id, address")
            .eq("is_active", True)
            .execute()
        )
        total_discrepancies = 0
        for acct in (accounts.data or []):
            try:
                # Read DB allocations
                alloc_rows = (
                    self.db.table("allocations")
                    .select("protocol_id, amount_usdc")
                    .eq("account_id", acct["id"])
                    .execute()
                )
                db_allocs = {
                    row["protocol_id"]: Decimal(str(row["amount_usdc"]))
                    for row in (alloc_rows.data or [])
                }

                # Read on-chain balances
                on_chain = await self.rebalancer._discover_onchain_balances(
                    acct["address"],
                    set(db_allocs.keys()) | set(ALL_ADAPTERS.keys()),
                )

                # Compare
                all_protocols = set(db_allocs.keys()) | set(on_chain.keys())
                for pid in all_protocols:
                    db_val = db_allocs.get(pid, Decimal("0"))
                    chain_val = on_chain.get(pid, Decimal("0"))
                    diff = abs(db_val - chain_val)
                    if diff > threshold:
                        total_discrepancies += 1
                        msg = (
                            f"RECONCILIATION MISMATCH: {acct['address'][:10]}.../{pid}: "
                            f"DB=${float(db_val):.2f} vs On-chain=${float(chain_val):.2f} "
                            f"(diff=${float(diff):.2f})"
                        )
                        logger.warning(msg)

                        # Update DB to match on-chain (source of truth)
                        if chain_val > Decimal("0.50"):
                            # Compute allocation_pct relative to total on-chain value
                            # (approximate — reconciliation may not know total; use 0 as placeholder)
                            self.db.table("allocations").upsert(
                                {
                                    "account_id": acct["id"],
                                    "protocol_id": pid,
                                    "amount_usdc": str(chain_val.quantize(Decimal("0.000001"))),
                                    "allocation_pct": "0.0000",  # Updated by next rebalance cycle
                                },
                                on_conflict="account_id,protocol_id",
                            ).execute()
                        elif db_val > Decimal("0") and chain_val < Decimal("0.50"):
                            self.db.table("allocations").delete().eq(
                                "account_id", acct["id"]
                            ).eq("protocol_id", pid).execute()

            except Exception as e:
                logger.error("Reconciliation failed for %s: %s", acct["id"], e)
                total_discrepancies += 1

        if total_discrepancies > 0:
            alert_msg = (
                f"Daily reconciliation found {total_discrepancies} discrepancies "
                f"across {len(accounts.data or [])} accounts. "
                f"DB has been updated to match on-chain values."
            )
            logger.warning(alert_msg)
            await send_telegram_alert(alert_msg)
            send_sentry_alert(alert_msg)
        else:
            logger.info(
                "Daily reconciliation: %d accounts checked, all balances match",
                len(accounts.data or []),
            )


# ── Graceful shutdown ────────────────────────────────────────────────────────

def setup_graceful_shutdown(scheduler: SnowMindScheduler) -> None:
    """Handle Railway SIGTERM without leaving partial rebalances."""
    def handle_sigterm(*_: object) -> None:
        logger.info("SIGTERM received — stopping scheduler gracefully")
        scheduler.stop()

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)
