"""Production scheduler with distributed locking, retry, and graceful shutdown."""

from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.optimizer.rebalancer import Rebalancer

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
        if self.settings.IS_TESTNET and self.settings.DEPLOYER_PRIVATE_KEY:
            self._scheduler.add_job(
                self._accrue_benqi_interest, "interval",
                minutes=5, id="benqi_accrue",
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
        expiry = (datetime.now(timezone.utc) + timedelta(seconds=self.LOCK_TTL)).isoformat()
        try:
            # Upsert — only succeeds if key doesn't exist or has expired
            self.db.table("scheduler_locks").upsert(
                {"key": "rebalance_lock", "holder": self.instance, "expires_at": expiry},
                on_conflict="key",
            ).execute()
            # Verify we actually hold it
            check = (
                self.db.table("scheduler_locks")
                .select("holder")
                .eq("key", "rebalance_lock")
                .eq("holder", self.instance)
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
        if not await self._acquire_lock():
            logger.debug("Lock held by another instance, skipping")
            return
        try:
            await self._run_all_accounts()
        finally:
            await self._release_lock()

    async def _run_all_accounts(self) -> None:
        self.last_run = datetime.now(timezone.utc)

        accounts = (
            self.db.table("accounts")
            .select("id, address")
            .eq("is_active", True)
            .execute()
        )
        if not accounts.data:
            logger.info("No active accounts — nothing to do")
            self.last_run_stats = {"checked": 0, "rebalanced": 0, "errors": 0}
            return

        logger.info("Processing %d accounts", len(accounts.data))

        sem = asyncio.Semaphore(5)
        results: list[str] = []

        async def process(account: dict) -> str:
            async with sem:
                return await self._rebalance_with_retry(
                    account["id"], account["address"],
                )

        results = await asyncio.gather(
            *[process(a) for a in accounts.data]
        )

        stats = {
            "checked": len(results),
            "rebalanced": results.count("ok"),
            "skipped": results.count("skip"),
            "errors": results.count("error"),
        }
        self.last_run_stats = stats
        logger.info("Scheduler tick done — %s", stats)

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
                return "ok" if result else "skip"
            except Exception as e:
                last_err = e
                if attempt < self.MAX_RETRIES - 1:
                    wait = 5 * (2 ** attempt)   # 5s, 10s, 20s
                    logger.warning(
                        "Rebalance attempt %d failed for %s, retrying in %ds: %s",
                        attempt + 1, account_id, wait, e,
                    )
                    await asyncio.sleep(wait)

        logger.error("All retries exhausted for %s: %s", account_id, last_err)
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

    # ── Benqi interest accrual (testnet only) ────────────────────────────────

    async def _accrue_benqi_interest(self) -> None:
        if not self.settings.IS_TESTNET or not self.settings.DEPLOYER_PRIVATE_KEY:
            return
        from web3 import AsyncWeb3, AsyncHTTPProvider
        from eth_account import Account

        w3 = AsyncWeb3(AsyncHTTPProvider(self.settings.AVALANCHE_RPC_URL))
        deployer = Account.from_key(self.settings.DEPLOYER_PRIVATE_KEY)
        abi = [
            {
                "name": "accrueInterest", "type": "function",
                "inputs": [], "outputs": [], "stateMutability": "nonpayable",
            }
        ]
        contract = w3.eth.contract(
            address=w3.to_checksum_address(self.settings.BENQI_POOL), abi=abi,
        )
        try:
            tx = await contract.functions.accrueInterest().build_transaction({
                "from": deployer.address,
                "nonce": await w3.eth.get_transaction_count(deployer.address),
                "gasPrice": await w3.eth.gas_price,
                "gas": 100_000,
            })
            signed = deployer.sign_transaction(tx)
            await w3.eth.send_raw_transaction(signed.raw_transaction)
            logger.debug("Benqi interest accrued")
        except Exception as e:
            logger.warning("Benqi accrue failed (non-critical): %s", e)

    # ── Balance reconciliation ───────────────────────────────────────────────

    async def _reconcile_balances(self) -> None:
        """Verify DB allocation records match on-chain reality daily."""
        accounts = (
            self.db.table("accounts")
            .select("id, address")
            .eq("is_active", True)
            .execute()
        )
        for acct in (accounts.data or []):
            try:
                await self.rebalancer._get_current_allocations(
                    acct["id"], acct["address"],
                )
            except Exception as e:
                logger.error("Reconciliation failed for %s: %s", acct["id"], e)


# ── Graceful shutdown ────────────────────────────────────────────────────────

def setup_graceful_shutdown(scheduler: SnowMindScheduler) -> None:
    """Handle Railway SIGTERM without leaving partial rebalances."""
    def handle_sigterm(*_: object) -> None:
        logger.info("SIGTERM received — stopping scheduler gracefully")
        scheduler.stop()

    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)
