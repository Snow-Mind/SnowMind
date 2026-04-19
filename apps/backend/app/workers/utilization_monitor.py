"""Real-time utilization monitor for targeted emergency withdrawals.

Polls utilization for active-position lending protocols and triggers protocol-
specific withdrawals when liquidity stress is detected, without waiting for the
regular scheduler cycle.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN

from app.core.config import get_settings
from app.core.database import get_supabase
from app.core.rpc import get_web3
from app.services.execution.session_key import (
    get_active_session_key_record,
    is_session_key_expiry_valid,
)
from app.services.optimizer.rebalancer import Rebalancer, _REBALANCE_EXECUTION_LOCKS
from app.services.protocols import ALL_ADAPTERS, get_adapter

logger = logging.getLogger("snowmind.utilization_monitor")

_MONITORED_PROTOCOLS = frozenset(
    ("aave_v3", "benqi", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc")
)
_HISTORY_SIZE = 20
_VELOCITY_WINDOW = 5
_MIN_POSITION_USDC = Decimal("0.01")
_USDC_QUANT = Decimal("0.000001")
_UTILIZATION_READ_MAX_ATTEMPTS = 3
_UTILIZATION_READ_BASE_BACKOFF_SECONDS = 0.25
_MIN_EMERGENCY_UTILIZATION_THRESHOLD = Decimal("0.92")
_SESSION_KEY_LOG_COOLDOWN_SECONDS = 900
_NON_RETRYABLE_FAILURE_COOLDOWN_SECONDS = 900
_ERC4626_MAX_WITHDRAW_ABI = [
    {
        "name": "maxWithdraw",
        "type": "function",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"name": "maxAssets", "type": "uint256"}],
        "stateMutability": "view",
    },
]
_ERC4626_VAULT_SETTING_BY_PROTOCOL = {
    "spark": "SPARK_SPUSDC",
    "euler_v2": "EULER_VAULT",
    "silo_savusd_usdc": "SILO_SAVUSD_VAULT",
    "silo_susdp_usdc": "SILO_SUSDP_VAULT",
}


@dataclass(frozen=True)
class PositionSnapshot:
    account_id: str
    smart_account_address: str
    amount_usdc: Decimal


class UtilizationMonitor:
    """Background monitor for utilization spikes on lending protocols."""

    LOCK_KEY = "utilization_monitor_lock"

    def __init__(self) -> None:
        self.settings = get_settings()
        self.db = get_supabase()
        self.rebalancer = Rebalancer()
        self.instance = uuid.uuid4().hex[:8]

        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._lock_held = False

        self._history: dict[str, deque[Decimal | None]] = {
            pid: deque(maxlen=_HISTORY_SIZE) for pid in _MONITORED_PROTOCOLS
        }
        self._cooldowns: dict[tuple[str, str], datetime] = {}
        self._session_key_warning_cooldowns: dict[str, datetime] = {}

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(
            self._poll_loop(),
            name="snowmind-utilization-monitor",
        )
        threshold = self._effective_emergency_threshold()
        logger.info(
            "Utilization monitor started [instance=%s interval=%ss threshold=%.1f%%]",
            self.instance,
            int(self.settings.UTILIZATION_POLL_INTERVAL),
            float(threshold) * 100,
        )

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._release_lock()
        logger.info("Utilization monitor stopped [instance=%s]", self.instance)

    async def _poll_loop(self) -> None:
        interval = max(5, int(self.settings.UTILIZATION_POLL_INTERVAL))

        while not self._stop_event.is_set():
            cycle_started = datetime.now(timezone.utc)
            try:
                if not await self._refresh_or_acquire_lock():
                    logger.debug(
                        "Utilization monitor lock held by another instance; skipping poll"
                    )
                else:
                    positions_by_protocol = self._load_active_positions()
                    if positions_by_protocol:
                        utilizations = await self._fetch_utilizations(
                            list(positions_by_protocol.keys())
                        )
                        for protocol_id, utilization in utilizations.items():
                            history = self._history.setdefault(
                                protocol_id, deque(maxlen=_HISTORY_SIZE)
                            )
                            history.append(utilization)

                            trigger_reason = self._evaluate_thresholds(protocol_id)
                            if trigger_reason:
                                await self._handle_protocol_alert(
                                    protocol_id=protocol_id,
                                    utilization=utilization,
                                    trigger_reason=trigger_reason,
                                    positions=positions_by_protocol.get(protocol_id, []),
                                )
                    else:
                        logger.debug("Utilization monitor: no active monitored positions")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Utilization monitor poll cycle failed")

            elapsed = (datetime.now(timezone.utc) - cycle_started).total_seconds()
            sleep_for = max(0.0, interval - elapsed)
            if sleep_for > 0:
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=sleep_for)
                except asyncio.TimeoutError:
                    pass

    def _throttle_session_key_warning(self, account_id: str, reason: str) -> None:
        now = datetime.now(timezone.utc)
        cooldown_until = self._session_key_warning_cooldowns.get(account_id)
        if cooldown_until and now < cooldown_until:
            return

        self._session_key_warning_cooldowns[account_id] = now + timedelta(
            seconds=_SESSION_KEY_LOG_COOLDOWN_SECONDS,
        )
        logger.warning(
            "Utilization monitor skipping account=%s due to non-executable session key: %s",
            account_id,
            reason,
        )

    @staticmethod
    def _is_non_retryable_withdrawal_error(message: str) -> bool:
        normalized = (message or "").lower()
        return (
            "session key" in normalized
            or "must re-grant" in normalized
            or "missing session private key" in normalized
            or "no active session key" in normalized
            or "expires within" in normalized
            or "not enough liquidity" in normalized
            or "notenoughliquidity" in normalized
            or "0x4323a555" in normalized
        )

    async def _read_erc4626_max_withdrawable_assets(
        self,
        protocol_id: str,
        owner_address: str,
    ) -> Decimal | None:
        setting_name = _ERC4626_VAULT_SETTING_BY_PROTOCOL.get(protocol_id)
        if not setting_name:
            return None

        vault_address = str(getattr(self.settings, setting_name, "") or "").strip()
        if not vault_address:
            return None

        try:
            w3 = get_web3()
            vault = w3.eth.contract(
                address=w3.to_checksum_address(vault_address),
                abi=_ERC4626_MAX_WITHDRAW_ABI,
            )
            max_withdraw_raw = int(
                await vault.functions.maxWithdraw(
                    w3.to_checksum_address(owner_address),
                ).call()
            )
            max_withdraw = Decimal(str(max_withdraw_raw)) / Decimal("1000000")
            return max(max_withdraw, Decimal("0"))
        except Exception as exc:
            logger.debug(
                "Failed to read ERC4626 maxWithdraw for account=%s protocol=%s: %s",
                owner_address,
                protocol_id,
                exc,
            )
            return None

    def _load_active_positions(self) -> dict[str, list[PositionSnapshot]]:
        """Return current monitored protocol positions for active accounts only."""
        now = datetime.now(timezone.utc)

        try:
            accounts = (
                self.db.table("accounts")
                .select("id, address")
                .eq("is_active", True)
                .execute()
                .data
                or []
            )
            account_map = {
                str(row.get("id")): str(row.get("address"))
                for row in accounts
                if row.get("id") and row.get("address")
            }
            if not account_map:
                return {}

            active_keys = (
                self.db.table("session_keys")
                .select("account_id, expires_at")
                .eq("is_active", True)
                .execute()
                .data
                or []
            )
            valid_session_accounts = {
                str(row.get("account_id"))
                for row in active_keys
                if row.get("account_id")
                and is_session_key_expiry_valid(row.get("expires_at"), now)
            }
            if not valid_session_accounts:
                return {}

            alloc_rows = (
                self.db.table("allocations")
                .select("account_id, protocol_id, amount_usdc")
                .gt("amount_usdc", "0")
                .execute()
                .data
                or []
            )

            candidate_accounts = {
                str(row.get("account_id") or "")
                for row in alloc_rows
                if str(row.get("protocol_id") or "") in _MONITORED_PROTOCOLS
            }
            executable_session_accounts: set[str] = set()
            for account_id in candidate_accounts:
                if not account_id or account_id not in valid_session_accounts:
                    continue

                try:
                    session_record = get_active_session_key_record(
                        self.db,
                        uuid.UUID(account_id),
                    )
                except Exception as exc:
                    self._throttle_session_key_warning(account_id, str(exc))
                    continue

                if not session_record:
                    self._throttle_session_key_warning(account_id, "no active session key")
                    continue

                session_private_key = str(
                    session_record.get("session_private_key") or ""
                ).strip()
                if not session_private_key:
                    self._throttle_session_key_warning(
                        account_id,
                        "active session key missing private key",
                    )
                    continue

                executable_session_accounts.add(account_id)

            if not executable_session_accounts:
                return {}

            positions_by_protocol: dict[str, list[PositionSnapshot]] = defaultdict(list)
            for row in alloc_rows:
                account_id = str(row.get("account_id") or "")
                protocol_id = str(row.get("protocol_id") or "")
                if protocol_id not in _MONITORED_PROTOCOLS:
                    continue
                if account_id not in executable_session_accounts:
                    continue
                address = account_map.get(account_id)
                if not address:
                    continue

                try:
                    amount_usdc = Decimal(str(row.get("amount_usdc", "0")))
                except Exception:
                    continue
                if amount_usdc <= _MIN_POSITION_USDC:
                    continue

                positions_by_protocol[protocol_id].append(
                    PositionSnapshot(
                        account_id=account_id,
                        smart_account_address=address,
                        amount_usdc=amount_usdc,
                    )
                )

            return dict(positions_by_protocol)
        except Exception as exc:
            logger.warning(
                "Utilization monitor position snapshot failed; skipping this poll cycle: %s",
                exc,
            )
            return {}

    async def _fetch_utilizations(
        self,
        protocol_ids: list[str],
    ) -> dict[str, Decimal | None]:
        """Read utilization concurrently for each active monitored protocol."""

        async def _read_one(protocol_id: str) -> tuple[str, Decimal | None]:
            adapter = ALL_ADAPTERS.get(protocol_id)
            if adapter is None:
                return protocol_id, None

            for attempt in range(_UTILIZATION_READ_MAX_ATTEMPTS):
                try:
                    utilization = await adapter.get_utilization()
                    if utilization is None:
                        return protocol_id, None
                    utilization = max(Decimal("0"), min(Decimal(str(utilization)), Decimal("1")))
                    return protocol_id, utilization
                except Exception as exc:
                    if attempt < _UTILIZATION_READ_MAX_ATTEMPTS - 1:
                        backoff = _UTILIZATION_READ_BASE_BACKOFF_SECONDS * (2 ** attempt)
                        logger.debug(
                            "Utilization read attempt %d/%d failed for %s: %s; retrying in %.2fs",
                            attempt + 1,
                            _UTILIZATION_READ_MAX_ATTEMPTS,
                            protocol_id,
                            exc,
                            backoff,
                        )
                        await asyncio.sleep(backoff)
                        continue

                    logger.warning(
                        "Utilization read failed for %s after %d attempts: %s",
                        protocol_id,
                        _UTILIZATION_READ_MAX_ATTEMPTS,
                        exc,
                    )
                    return protocol_id, None

        results = await asyncio.gather(*(_read_one(pid) for pid in protocol_ids))
        return {pid: util for pid, util in results}

    def _evaluate_thresholds(self, protocol_id: str) -> str | None:
        """Return trigger reason when utilization stress conditions are met."""
        history = self._history.get(protocol_id)
        if not history:
            return None

        confirm_count = max(1, int(self.settings.UTILIZATION_CONFIRM_COUNT))
        if len(history) < confirm_count:
            return None

        recent = list(history)[-confirm_count:]
        if any(point is None for point in recent):
            # Require consecutive successful reads before triggering.
            return None

        emergency_threshold = self._effective_emergency_threshold()
        recent_values = [point for point in recent if point is not None]
        if all(value >= emergency_threshold for value in recent_values):
            return (
                f"absolute utilization at or above {float(emergency_threshold * 100):.1f}% "
                f"for {confirm_count} consecutive reads"
            )

        successful_values = [point for point in history if point is not None]
        if len(successful_values) < 2:
            return None

        velocity_window = successful_values[-max(_VELOCITY_WINDOW, confirm_count):]
        if len(velocity_window) < 2:
            return None

        utilization_jump = velocity_window[-1] - velocity_window[0]
        velocity_threshold = Decimal(str(self.settings.UTILIZATION_VELOCITY_THRESHOLD))
        if utilization_jump >= velocity_threshold:
            return (
                f"utilization jumped by {float(utilization_jump * 100):.1f}% "
                f"within recent polls"
            )

        return None

    def _effective_emergency_threshold(self) -> Decimal:
        """Return configured emergency threshold with a conservative floor."""
        configured = Decimal(str(self.settings.EMERGENCY_UTILIZATION_THRESHOLD))
        clamped = max(Decimal("0"), min(configured, Decimal("1")))
        return max(clamped, _MIN_EMERGENCY_UTILIZATION_THRESHOLD)

    async def _handle_protocol_alert(
        self,
        protocol_id: str,
        utilization: Decimal | None,
        trigger_reason: str,
        positions: list[PositionSnapshot],
    ) -> None:
        if not positions:
            return

        utilization_label = "unknown" if utilization is None else f"{float(utilization * 100):.2f}%"
        logger.warning(
            "Utilization alert on %s (%s): %s; positions=%d",
            protocol_id,
            utilization_label,
            trigger_reason,
            len(positions),
        )

        for position in positions:
            await self._execute_targeted_withdrawal(
                protocol_id=protocol_id,
                position=position,
                trigger_reason=trigger_reason,
            )

    async def _execute_targeted_withdrawal(
        self,
        protocol_id: str,
        position: PositionSnapshot,
        trigger_reason: str,
    ) -> None:
        now = datetime.now(timezone.utc)
        cooldown_key = (position.account_id, protocol_id)
        cooldown_until = self._cooldowns.get(cooldown_key)
        if cooldown_until and now < cooldown_until:
            logger.debug(
                "Utilization monitor cooldown active for account=%s protocol=%s (%ds remaining)",
                position.account_id,
                protocol_id,
                int((cooldown_until - now).total_seconds()),
            )
            return

        execution_lock = _REBALANCE_EXECUTION_LOCKS.setdefault(
            position.account_id,
            asyncio.Lock(),
        )
        if execution_lock.locked():
            logger.info(
                "Skipping utilization-triggered withdrawal for %s/%s — rebalance already in flight",
                position.account_id,
                protocol_id,
            )
            return

        amount_usdc = await self._resolve_withdrawable_amount(position, protocol_id)
        if amount_usdc <= _MIN_POSITION_USDC:
            await self._apply_zero_withdrawable_cooldown_if_needed(
                cooldown_key=cooldown_key,
                position=position,
                protocol_id=protocol_id,
                now=now,
            )
            return

        async with execution_lock:
            try:
                tx_hash = await self.rebalancer.execute_partial_withdrawal(
                    account_id=position.account_id,
                    smart_account_address=position.smart_account_address,
                    protocol_id=protocol_id,
                    amount_usdc=float(amount_usdc),
                )
            except Exception as exc:
                error_message = str(exc)
                if self._is_non_retryable_withdrawal_error(error_message):
                    cooldown_seconds = max(
                        int(self.settings.EMERGENCY_WITHDRAWAL_COOLDOWN),
                        _NON_RETRYABLE_FAILURE_COOLDOWN_SECONDS,
                    )
                    self._cooldowns[cooldown_key] = now + timedelta(seconds=cooldown_seconds)
                    logger.error(
                        "Utilization-triggered withdrawal failed for account=%s protocol=%s "
                        "with non-retryable error; applying %ss cooldown: %s",
                        position.account_id,
                        protocol_id,
                        cooldown_seconds,
                        error_message,
                    )
                else:
                    logger.error(
                        "Utilization-triggered withdrawal failed for account=%s protocol=%s: %s",
                        position.account_id,
                        protocol_id,
                        error_message,
                    )
                return

        cooldown_seconds = max(0, int(self.settings.EMERGENCY_WITHDRAWAL_COOLDOWN))
        self._cooldowns[cooldown_key] = now + timedelta(seconds=cooldown_seconds)

        logger.warning(
            "Emergency partial withdrawal executed for account=%s protocol=%s amount=$%.6f tx=%s",
            position.account_id,
            protocol_id,
            float(amount_usdc),
            tx_hash,
        )

        self._record_withdrawal_activity(
            account_id=position.account_id,
            protocol_id=protocol_id,
            amount_usdc=amount_usdc,
            tx_hash=tx_hash,
            trigger_reason=trigger_reason,
        )

        # Immediately run a single follow-up rebalance so recovered idle funds
        # can be redeployed to healthier protocols without waiting for the
        # next scheduler cadence.
        await self._run_post_withdrawal_rebalance(
            account_id=position.account_id,
            smart_account_address=position.smart_account_address,
            source_protocol_id=protocol_id,
        )

    async def _apply_zero_withdrawable_cooldown_if_needed(
        self,
        *,
        cooldown_key: tuple[str, str],
        position: PositionSnapshot,
        protocol_id: str,
        now: datetime,
    ) -> None:
        """Back off when vault reports zero withdrawable assets for this owner."""
        max_withdrawable_assets = await self._read_erc4626_max_withdrawable_assets(
            protocol_id=protocol_id,
            owner_address=position.smart_account_address,
        )
        if max_withdrawable_assets is None or max_withdrawable_assets > _MIN_POSITION_USDC:
            return

        cooldown_seconds = max(300, int(self.settings.EMERGENCY_WITHDRAWAL_COOLDOWN))
        self._cooldowns[cooldown_key] = now + timedelta(seconds=cooldown_seconds)
        logger.info(
            "Utilization-triggered withdrawal skipped for account=%s protocol=%s "
            "due to zero withdrawable liquidity (maxWithdraw=$%.6f); applying %ss cooldown",
            position.account_id,
            protocol_id,
            float(max_withdrawable_assets),
            cooldown_seconds,
        )

    async def _run_post_withdrawal_rebalance(
        self,
        *,
        account_id: str,
        smart_account_address: str,
        source_protocol_id: str,
    ) -> None:
        """Run one immediate rebalance after an emergency partial withdrawal."""
        try:
            result = await self.rebalancer.check_and_rebalance(
                account_id=account_id,
                smart_account_address=smart_account_address,
            )
            status = "unknown"
            reason = None
            if isinstance(result, dict):
                status = str(result.get("status") or status)
                reason = result.get("skip_reason") or result.get("reason")
            logger.info(
                "Post-emergency rebalance result for account=%s after %s withdrawal: status=%s reason=%s",
                account_id,
                source_protocol_id,
                status,
                reason,
            )
        except Exception as exc:
            # Fail-safe: emergency exit already succeeded; do not roll back.
            logger.warning(
                "Post-emergency rebalance failed for account=%s after %s withdrawal: %s",
                account_id,
                source_protocol_id,
                exc,
            )

    async def _resolve_withdrawable_amount(
        self,
        position: PositionSnapshot,
        protocol_id: str,
    ) -> Decimal:
        """Choose a safe withdrawal amount using DB + on-chain balance."""
        db_amount = max(position.amount_usdc, Decimal("0"))
        onchain_amount = db_amount

        try:
            adapter = get_adapter(protocol_id)
            onchain_raw = await adapter.get_balance(position.smart_account_address)
            onchain_amount = Decimal(str(onchain_raw)) / Decimal("1000000")
        except Exception as exc:
            logger.warning(
                "On-chain balance read failed for account=%s protocol=%s: %s — using DB amount",
                position.account_id,
                protocol_id,
                exc,
            )

        max_withdrawable_assets = await self._read_erc4626_max_withdrawable_assets(
            protocol_id=protocol_id,
            owner_address=position.smart_account_address,
        )
        if max_withdrawable_assets is not None:
            if max_withdrawable_assets < onchain_amount:
                logger.info(
                    "Capping utilization-triggered withdrawal for account=%s protocol=%s "
                    "by ERC4626 maxWithdraw: balance=$%.6f maxWithdraw=$%.6f",
                    position.account_id,
                    protocol_id,
                    float(onchain_amount),
                    float(max_withdrawable_assets),
                )
            onchain_amount = min(onchain_amount, max_withdrawable_assets)

        safe_amount = min(db_amount, max(onchain_amount, Decimal("0")))
        if safe_amount <= _MIN_POSITION_USDC:
            return Decimal("0")

        return safe_amount.quantize(_USDC_QUANT, rounding=ROUND_DOWN)

    def _record_withdrawal_activity(
        self,
        *,
        account_id: str,
        protocol_id: str,
        amount_usdc: Decimal,
        tx_hash: str,
        trigger_reason: str,
    ) -> None:
        """Persist a transaction-feed row for utilization-triggered withdrawals."""
        amount_q = amount_usdc.quantize(_USDC_QUANT)
        reason = f"EMERGENCY_WITHDRAWAL: utilization monitor trigger ({trigger_reason})"
        try:
            self.db.table("rebalance_logs").insert(
                {
                    "account_id": account_id,
                    "status": "executed",
                    "skip_reason": reason,
                    "from_protocol": protocol_id,
                    "to_protocol": "idle",
                    "amount_moved": str(amount_q),
                    "proposed_allocations": {protocol_id: str(amount_q)},
                    "executed_allocations": {"idle": str(amount_q)},
                    "tx_hash": tx_hash,
                    "apr_improvement": None,
                }
            ).execute()
        except Exception as exc:
            logger.warning(
                "Failed to log utilization-monitor withdrawal activity for account=%s protocol=%s: %s",
                account_id,
                protocol_id,
                exc,
            )

    async def _refresh_or_acquire_lock(self) -> bool:
        """Acquire or refresh distributed monitor leadership lock."""
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        ttl_seconds = max(90, int(self.settings.UTILIZATION_POLL_INTERVAL) * 3)
        expiry_iso = (now + timedelta(seconds=ttl_seconds)).isoformat()

        if self._lock_held:
            try:
                refreshed = (
                    self.db.table("scheduler_locks")
                    .update({"expires_at": expiry_iso})
                    .eq("key", self.LOCK_KEY)
                    .eq("holder", self.instance)
                    .gte("expires_at", now_iso)
                    .execute()
                )
                if refreshed.data:
                    return True
            except Exception as exc:
                logger.warning("Utilization monitor lock refresh failed: %s", exc)
            self._lock_held = False

        try:
            self.db.table("scheduler_locks").insert(
                {
                    "key": self.LOCK_KEY,
                    "holder": self.instance,
                    "expires_at": expiry_iso,
                }
            ).execute()
            self._lock_held = True
            return True
        except Exception:
            pass

        try:
            claimed = (
                self.db.table("scheduler_locks")
                .update({"holder": self.instance, "expires_at": expiry_iso})
                .eq("key", self.LOCK_KEY)
                .lte("expires_at", now_iso)
                .execute()
            )
            if claimed.data:
                self._lock_held = True
                return True

            check = (
                self.db.table("scheduler_locks")
                .select("holder")
                .eq("key", self.LOCK_KEY)
                .eq("holder", self.instance)
                .gte("expires_at", now_iso)
                .execute()
            )
            self._lock_held = bool(check.data)
            return self._lock_held
        except Exception as exc:
            logger.warning("Utilization monitor lock acquisition failed: %s", exc)
            return False

    async def _release_lock(self) -> None:
        if not self._lock_held:
            return
        try:
            (
                self.db.table("scheduler_locks")
                .delete()
                .eq("key", self.LOCK_KEY)
                .eq("holder", self.instance)
                .execute()
            )
        except Exception as exc:
            logger.warning("Utilization monitor lock release failed: %s", exc)
        finally:
            self._lock_held = False
