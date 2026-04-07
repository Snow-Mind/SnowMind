"""Cost-aware rebalance orchestrator â€” full pipeline from rates to on-chain execution.

Transaction ordering: withdrawals FIRST, then deposits (ensure funds are available).
"""

import asyncio
import base64
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from uuid import UUID

import httpx
from web3 import Web3

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.execution.executor import ExecutionService
from app.services.execution.session_key import (
    get_active_session_key,
    get_active_session_key_record,
    get_deactivated_session_key_records,
    reactivate_session_key,
    revoke_session_key,
)
from app.services.optimizer.allocator import (
    UserPreference,
    compute_allocation,
    compute_weighted_apy as compute_alloc_weighted_apy,
)
from app.services.optimizer.health_checker import (
    HealthCheckResult,
    RebalanceFlag,
    check_protocol_health,
)
from app.services.optimizer.rate_fetcher import RateFetcher, circuit_breaker
from app.services.optimizer.rate_validator import RateValidator
from app.services.protocols import ALL_ADAPTERS
from app.services.fee_calculator import (
    record_deposit,
    record_partial_withdrawal,
)
from app.services.protocols import get_adapter
from app.services.protocols.base import ProtocolHealth, ProtocolStatus, get_shared_async_web3

logger = logging.getLogger("snowmind")

MAX_UINT256 = 2**256 - 1

# -- ERC-20 balanceOf ABI -------------------------------------------------
ERC20_BALANCE_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]

# Per-account execution lock to prevent concurrent rebalance submissions
# (e.g. scheduler + manual trigger + onboarding initial deployment) from
# racing and producing contradictory outcomes.
_REBALANCE_EXECUTION_LOCKS: dict[str, asyncio.Lock] = {}

# Deposit-size cadence tiers (larger balances rebalance more frequently).
# Final min gap is still max(tier_gap, scheduler_interval).
_REBALANCE_COOLDOWN_TIERS: tuple[tuple[Decimal, Decimal], ...] = (
    (Decimal("3000"), Decimal("12")),
    (Decimal("10000"), Decimal("4")),
    (Decimal("100000"), Decimal("2")),
)


def _permission_blob_contains_address(serialized_permission: str, address: str) -> bool:
    """Return True if *address* is present in a serialized permission blob.

    The permission payload is typically base64-encoded JSON. Some legacy flows
    may store plain-text JSON. To avoid false negatives, check both the raw blob
    and a best-effort base64-decoded representation.
    """
    if not serialized_permission or not address:
        return False

    normalized = address.lower().removeprefix("0x")
    candidates = (normalized, f"0x{normalized}")

    blob_lower = serialized_permission.lower()
    if any(token in blob_lower for token in candidates):
        return True

    try:
        padded = serialized_permission + ("=" * (-len(serialized_permission) % 4))
        decoded = base64.b64decode(padded, validate=False)
        decoded_lower = decoded.decode("utf-8", errors="ignore").lower()
        return any(token in decoded_lower for token in candidates)
    except Exception as exc:
        logger.debug("Serialized permission decode failed during address scan: %s", exc)
        return False


def _build_user_preferences(
    protocol_ids: set[str],
    allocation_caps: dict[str, int] | None,
) -> dict[str, UserPreference]:
    """Build allocator preferences from allowed protocols and optional cap map."""
    caps = allocation_caps or {}
    preferences: dict[str, UserPreference] = {}

    for pid in protocol_ids:
        cap_value = caps.get(pid)
        if cap_value is None and pid == "aave_v3":
            cap_value = caps.get("aave")

        max_pct: Decimal | None = None
        if cap_value is not None:
            try:
                # Defensive parsing: protect rebalances from malformed DB cap payloads.
                if isinstance(cap_value, bool):
                    raise ValueError("boolean cap values are invalid")
                parsed_cap = int(str(cap_value).strip())
                bounded = max(0, min(parsed_cap, 100))
                max_pct = Decimal(str(bounded)) / Decimal("100")
            except (TypeError, ValueError) as exc:
                logger.warning(
                    "Ignoring invalid allocation cap for %s: %r (%s)",
                    pid,
                    cap_value,
                    exc,
                )

        preferences[pid] = UserPreference(
            protocol_id=pid,
            enabled=True,
            max_pct=max_pct,
        )

    return preferences


class Rebalancer:
    """Decides whether to rebalance and executes the on-chain moves."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.rate_fetcher = RateFetcher()
        self.rate_validator = RateValidator()
        self.w3 = get_shared_async_web3()
        self._protocol_addresses: dict[str, str] = {
            "aave": self.settings.AAVE_V3_POOL,
            "aave_v3": self.settings.AAVE_V3_POOL,
            "benqi": self.settings.BENQI_QIUSDC,
        }
        if self.settings.SPARK_SPUSDC:
            self._protocol_addresses["spark"] = self.settings.SPARK_SPUSDC
        if self.settings.EULER_VAULT:
            self._protocol_addresses["euler_v2"] = self.settings.EULER_VAULT
        if self.settings.SILO_SAVUSD_VAULT:
            self._protocol_addresses["silo_savusd_usdc"] = self.settings.SILO_SAVUSD_VAULT
        if self.settings.SILO_SUSDP_VAULT:
            self._protocol_addresses["silo_susdp_usdc"] = self.settings.SILO_SUSDP_VAULT
        if self.settings.SILO_GAMI_USDC_VAULT:
            self._protocol_addresses["silo_gami_usdc"] = self.settings.SILO_GAMI_USDC_VAULT
        if self.settings.FOLKS_SPOKE_USDC:
            self._protocol_addresses["folks"] = self.settings.FOLKS_SPOKE_USDC

    def _min_rebalance_gap(self, total_usd: Decimal) -> timedelta:
        """Return minimum time between successful rebalances for this balance size.

                Deposit-based tiers:
                    - <= $3,000   : 12h  (2/day)
                    - <= $10,000  : 4h   (6/day)
                    - <= $100,000 : 2h   (12/day)
                    - >  $100,000 : MIN_REBALANCE_INTERVAL_HOURS (default 1h, 24/day)

        The scheduler interval still provides a lower bound so we never demand
        a cadence faster than the worker can actually run.
        """
        normalized_total = max(total_usd, Decimal("0"))
        tier_hours = Decimal(str(self.settings.MIN_REBALANCE_INTERVAL_HOURS))

        for max_usd, hours in _REBALANCE_COOLDOWN_TIERS:
            if normalized_total <= max_usd:
                tier_hours = hours
                break

        tier_seconds = int(
            (tier_hours * Decimal("3600")).quantize(Decimal("1"), rounding=ROUND_DOWN)
        )
        scheduler_seconds = max(int(self.settings.REBALANCE_CHECK_INTERVAL), 60)
        return timedelta(seconds=max(tier_seconds, scheduler_seconds))

    def _should_record_initial_deposit(self, db, account_id: str) -> bool:
        """Return True when initial deposit tracking should be (re)seeded.

        This prevents repeated scheduler retries from inflating
        ``cumulative_deposited`` while keeping re-onboarding support when
        outstanding principal is effectively zero.
        """
        try:
            result = (
                db.table("account_yield_tracking")
                .select("cumulative_deposited, cumulative_net_withdrawn")
                .eq("account_id", account_id)
                .limit(1)
                .execute()
            )
            if not result.data:
                return True

            tracking = result.data[0]
            cumulative_deposited = Decimal(str(tracking.get("cumulative_deposited", "0")))
            cumulative_withdrawn = Decimal(str(tracking.get("cumulative_net_withdrawn", "0")))
            outstanding_principal = cumulative_deposited - cumulative_withdrawn
            return outstanding_principal <= Decimal("0.01")
        except Exception as exc:
            logger.warning(
                "Deposit-tracking guard check failed for %s: %s — skipping deposit write",
                account_id,
                exc,
            )
            # Fail safe: avoid writing potentially wrong deposit totals.
            return False

    async def _get_idle_usdc_balance(self, smart_account_address: str) -> Decimal:
        """Read the on-chain USDC balance sitting idle in the smart account.

        Retries up to 3 times with exponential backoff to handle transient
        RPC errors (e.g. -32603 Internal error from Avalanche public nodes).
        """
        import asyncio

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                usdc_contract = self.w3.eth.contract(
                    address=self.w3.to_checksum_address(self.settings.USDC_ADDRESS),
                    abi=ERC20_BALANCE_ABI,
                )
                balance_wei = await usdc_contract.functions.balanceOf(
                    self.w3.to_checksum_address(smart_account_address)
                ).call()
                balance = Decimal(str(balance_wei)) / Decimal("1000000")
                if attempt > 0:
                    logger.info(
                        "Idle USDC read succeeded on attempt %d for %s: $%.2f",
                        attempt + 1, smart_account_address, float(balance),
                    )
                return balance
            except Exception as exc:
                if attempt < max_attempts - 1:
                    delay = 0.5 * (2 ** attempt)  # 0.5s, 1s
                    logger.warning(
                        "Idle USDC read attempt %d/%d failed for %s: %s — retrying in %.1fs",
                        attempt + 1, max_attempts, smart_account_address, exc, delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "Failed to read idle USDC for %s after %d attempts: %s",
                        smart_account_address, max_attempts, exc,
                    )
                    return Decimal("0")
        return Decimal("0")  # unreachable but makes type-checker happy

    async def _discover_onchain_balances(
        self,
        smart_account_address: str,
        protocol_ids: set[str],
    ) -> dict[str, Decimal]:
        """Scan on-chain balances across all protocols to discover existing positions.

        Used when the allocations DB table is empty but the user may have
        deployed funds directly from the frontend (e.g. during onboarding).
        Returns a dict of protocol_id → USDC value for positions > $0.50.
        """
        discovered: dict[str, Decimal] = {}
        for pid in protocol_ids:
            try:
                balance_usd = await self._read_protocol_balance_usd(
                    smart_account_address,
                    pid,
                )
                if balance_usd > Decimal("0.50"):
                    discovered[pid] = balance_usd
            except Exception as exc:
                logger.debug("On-chain balance check for %s/%s failed: %s", smart_account_address, pid, exc)
        return discovered

    async def _read_protocol_balance_usd(
        self,
        smart_account_address: str,
        protocol_id: str,
    ) -> Decimal:
        """Read one protocol balance with a bounded timeout."""
        adapter = get_adapter(protocol_id)
        if adapter is None:
            raise RuntimeError(f"Adapter not found for protocol {protocol_id}")

        timeout_seconds = max(0.5, float(self.settings.PROTOCOL_BALANCE_READ_TIMEOUT_SECONDS))
        try:
            balance_wei = await asyncio.wait_for(
                adapter.get_balance(smart_account_address),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise TimeoutError(
                f"On-chain read timed out after {timeout_seconds:.1f}s"
            ) from exc

        return Decimal(str(balance_wei)) / Decimal("1000000")

    async def _execute_rebalance_once(
        self,
        account_id: str,
        smart_account_address: str,
        target_allocations: dict[str, Decimal],
        known_idle_usdc: Decimal | None = None,
    ) -> str | None:
        """Execute one rebalance per account at a time.

        Prevents duplicate concurrent UserOps that can happen when multiple
        triggers race (manual trigger and initial onboarding task).
        """
        execution_lock = _REBALANCE_EXECUTION_LOCKS.setdefault(account_id, asyncio.Lock())
        if execution_lock.locked():
            raise RuntimeError("REBALANCE_IN_FLIGHT")

        async with execution_lock:
            return await self.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account_address,
                target_allocations=target_allocations,
                known_idle_usdc=known_idle_usdc,
            )

    # â”€â”€ Full pipeline (cron entry-point) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def check_and_rebalance(
        self,
        account_id: str,
        smart_account_address: str,
    ) -> dict:
        """
        Full pipeline:
          1. Fetch TWAP rates
          2. Validate rates â€” halt if any anomaly
          3. Compute risk scores per protocol
          4. Get current allocations from DB
          5. Run waterfall allocator
          6. Check if rebalance is needed (delta + yield gate)
          7. Check deposit-tier cadence gate
          8. If all conditions met â†’ execute
          9. Log result regardless
         10. Return log dict
        """
        db = get_supabase()

        # 0. Early session-key check — skip expensive pipeline if no key
        try:
            session_key_record = get_active_session_key_record(db, UUID(account_id))
        except ValueError as exc:
            logger.warning(
                "Session key unreadable for %s: %s",
                smart_account_address,
                exc,
            )
            return await self._log(
                db,
                account_id,
                "skipped",
                reason=str(exc),
            )
        if not session_key_record:
            logger.debug("No active session key for %s — skipping", account_id)
            return await self._log(db, account_id, "skipped",
                                   reason="No active session key")

        # Fast-path: if another rebalance is currently executing for this account,
        # skip early to avoid rerunning the full pipeline and amplifying RPC load.
        execution_lock = _REBALANCE_EXECUTION_LOCKS.setdefault(account_id, asyncio.Lock())
        if execution_lock.locked():
            return await self._log(
                db,
                account_id,
                "skipped",
                reason="Another rebalance attempt in flight",
            )

        # 0b. Cooldown after PERMISSION_RECOVERY_NEEDED — stop hammering the
        # ZeroDev bundler every 6 minutes with the same broken session key.
        # The bundler has mempool deduplication: it tracks submitted
        # permissionHashes and rejects duplicates. Retrying with the same
        # session key every tick makes the problem worse. Wait 30 minutes
        # for the bundler's mempool to expire, then retry.
        try:
            # Look back over recent logs and anchor cooldown on the MOST RECENT
            # PERMISSION_RECOVERY_NEEDED failure specifically. Using the latest
            # generic log causes an alternating loop:
            #   tick N: PERMISSION_RECOVERY_NEEDED
            #   tick N+1: cooldown skip
            #   tick N+2: retries again (because latest log is cooldown text)
            # This query keeps cooldown stable until a new key is granted.
            recent_logs = (
                db.table("rebalance_logs")
                .select("skip_reason, created_at")
                .eq("account_id", account_id)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
            latest_recovery_needed_log = None
            for row in recent_logs.data or []:
                reason = row.get("skip_reason") or ""
                if "PERMISSION_RECOVERY_NEEDED" in reason:
                    latest_recovery_needed_log = row
                    break

            if latest_recovery_needed_log:
                last_time = datetime.fromisoformat(
                    str(latest_recovery_needed_log["created_at"]).replace("Z", "+00:00")
                )
                now = datetime.now(timezone.utc)

                # If the user re-granted a fresh active key after the last
                # PERMISSION_RECOVERY failure, do NOT enforce the old cooldown.
                latest_active_key = (
                    db.table("session_keys")
                    .select("id, created_at")
                    .eq("account_id", account_id)
                    .eq("is_active", True)
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )

                has_newer_active_key = False
                if latest_active_key.data:
                    key_created_raw = latest_active_key.data[0].get("created_at")
                    if key_created_raw:
                        key_created_at = datetime.fromisoformat(
                            str(key_created_raw).replace("Z", "+00:00")
                        )
                        has_newer_active_key = key_created_at > last_time
                        if has_newer_active_key:
                            logger.info(
                                "Bypassing PERMISSION_RECOVERY cooldown for %s — "
                                "new active key detected (key_created=%s > failure=%s)",
                                smart_account_address,
                                key_created_at.isoformat(),
                                last_time.isoformat(),
                            )

                if not has_newer_active_key:
                    cooldown_until = last_time + timedelta(minutes=30)
                    if now < cooldown_until:
                        mins_left = int((cooldown_until - now).total_seconds() / 60)
                        logger.debug(
                            "PERMISSION_RECOVERY cooldown for %s — %d min left. "
                            "User must re-grant session key from dashboard.",
                            smart_account_address, mins_left,
                        )
                        return await self._log(
                            db, account_id, "skipped",
                            reason=f"PERMISSION_RECOVERY cooldown ({mins_left}min left) — user must re-grant",
                        )
        except Exception as exc:
            logger.warning(
                "PERMISSION_RECOVERY cooldown check failed for %s: %s — proceeding",
                smart_account_address,
                exc,
            )

        allowed_protocols = set(session_key_record["allowed_protocols"])
        logger.debug(
            "Session key allowed_protocols for %s: %s",
            smart_account_address, sorted(allowed_protocols),
        )

        # ── Permit2 compatibility check ──
        # Old session keys (granted before Permit2 was added to the call policy)
        # do NOT contain an approve rule for the Permit2 contract. Euler V2 (EVK)
        # requires Permit2 for deposits, so exclude it for old session keys to
        # avoid guaranteed revert. Detect by checking for the Permit2 address
        # (0x000000000022D473030F116dDEE9F6B43aC78BA3) in the serialized
        # permission blob — content-based check avoids false positives from
        # length changes due to ONE_OF rule consolidation.
        _perm_blob = session_key_record.get("serialized_permission", "")
        _has_permit2 = _permission_blob_contains_address(
            _perm_blob,
            self.settings.PERMIT2,
        )
        if _perm_blob and not _has_permit2 and "euler_v2" in allowed_protocols:
            allowed_protocols.discard("euler_v2")
            logger.warning(
                "Session key for %s is pre-Permit2 (Permit2 address not found in permission blob, len=%d). "
                "Excluding euler_v2 from allowed protocols. User should re-grant session key.",
                smart_account_address,
                len(_perm_blob),
            )

        # 1. Fetch live spot rates
        spot_rates_raw = await self.rate_fetcher.fetch_all_rates()

        if not spot_rates_raw:
            return await self._log(db, account_id, "skipped",
                                   reason="No spot rates available")

        # 2. Validate with TWAP + velocity check
        spot_rates = {pid: rate.apy for pid, rate in spot_rates_raw.items()}
        validated_rates = await self.rate_validator.validate_all(spot_rates)
        if validated_rates is None:
            return await self._log(db, account_id, "skipped",
                                   reason="Rate validation failed (sanity/velocity)")

        # Rebuild ProtocolRate-like mapping with TWAP-smoothed APYs
        twap_rates = {}
        for pid, twap_apy in validated_rates.items():
            if pid in spot_rates_raw:
                from app.services.protocols.base import ProtocolRate
                orig = spot_rates_raw[pid]
                twap_rates[pid] = ProtocolRate(
                    protocol_id=pid,
                    apy=twap_apy,
                    effective_apy=orig.effective_apy,
                    tvl_usd=orig.tvl_usd,
                    utilization_rate=orig.utilization_rate,
                    fetched_at=orig.fetched_at,
                )

        if not twap_rates:
            return await self._log(db, account_id, "skipped",
                                   reason="No validated TWAP rates available")

        logger.debug(
            "TWAP rates for %s: %s",
            smart_account_address,
            {p: f"{float(r.apy * 100):.2f}%%" for p, r in twap_rates.items()},
        )

        # 3. Filter protocols by active session-key scope
        allowed_rates = {
            pid: rate
            for pid, rate in twap_rates.items()
            if pid in allowed_protocols
        }
        filtered_out = sorted(set(twap_rates.keys()) - set(allowed_rates.keys()))

        if filtered_out:
            logger.info(
                "Session key for %s excludes protocols: %s",
                smart_account_address,
                ", ".join(sorted(filtered_out)),
            )

        if not allowed_rates:
            return await self._log(
                db,
                account_id,
                "skipped",
                reason="No protocols permitted by active session key",
            )

        # 4. Get current allocations from DB + on-chain verification
        # CRITICAL: Always verify DB allocations against on-chain balances.
        # Stale DB entries (from failed rebalances, partial executions, etc.)
        # cause the optimizer to generate impossible moves that revert on-chain,
        # creating an infinite failure loop.
        alloc_rows = (
            db.table("allocations")
            .select("protocol_id, amount_usdc")
            .eq("account_id", account_id)
            .execute()
        )
        current: dict[str, Decimal] = {}
        total_usd = Decimal("0")
        db_needs_update = False
        for row in alloc_rows.data:
            db_amt = Decimal(str(row["amount_usdc"]))
            pid = row["protocol_id"]
            # Verify each DB allocation against on-chain balance
            try:
                onchain_usd = await self._read_protocol_balance_usd(
                    smart_account_address,
                    pid,
                )
                if abs(onchain_usd - db_amt) > Decimal("0.10"):
                    logger.warning(
                        "Allocation mismatch %s/%s: DB=$%.2f, on-chain=$%.2f — using on-chain",
                        smart_account_address, pid, float(db_amt), float(onchain_usd),
                    )
                    db_needs_update = True
                if onchain_usd >= Decimal("0.01"):
                    current[pid] = onchain_usd
                    total_usd += onchain_usd
                elif db_amt >= Decimal("0.01"):
                    # On-chain says $0 but DB says >$0 — stale entry, skip it
                    logger.warning(
                        "Stale DB allocation %s/%s: DB=$%.4f, on-chain=$%.4f — removing",
                        smart_account_address, pid, float(db_amt), float(onchain_usd),
                    )
                    db_needs_update = True
            except Exception as exc:
                logger.warning("On-chain check failed for %s/%s: %s — using DB value", account_id, pid, exc)
                if db_amt >= Decimal("0.01"):
                    current[pid] = db_amt
                    total_usd += db_amt

        # Sync DB to on-chain truth if mismatches were detected
        if db_needs_update:
            try:
                if current:
                    await self._update_allocations_db(db, account_id, current)
                    logger.info("Synced allocations DB to on-chain for %s: %s",
                                account_id, {p: f"${float(v):.2f}" for p, v in current.items()})
                else:
                    # All DB allocations were stale — wipe them
                    db.table("allocations").delete().eq("account_id", account_id).execute()
                    logger.info("Cleared all stale allocations for %s", account_id)
            except Exception as exc:
                logger.warning("Failed to sync allocations DB: %s", exc)

        # 4a. On-chain balance discovery — if allocations table is empty,
        # scan ALL known protocol adapters for existing positions.
        # CRITICAL: must NOT limit to twap_rates/allowed_rates because
        # protocols that temporarily fail rate validation (e.g. velocity
        # spike) would be excluded, causing the rebalancer to miss real
        # on-chain positions and report "No deposited balance" when funds
        # are deployed.
        if not current:
            all_protocol_ids = set(self._protocol_addresses.keys())
            discovered = await self._discover_onchain_balances(
                smart_account_address, all_protocol_ids,
            )
            if discovered:
                logger.info(
                    "Discovered on-chain positions for %s (not in DB): %s",
                    smart_account_address,
                    {pid: f"${float(amt):.2f}" for pid, amt in discovered.items()},
                )
                # Sync discovered positions to DB
                total_discovered = sum(discovered.values()) or Decimal("1")
                for pid, amt in discovered.items():
                    try:
                        db.table("allocations").upsert(
                            {
                                "account_id": account_id,
                                "protocol_id": pid,
                                "amount_usdc": str(amt.quantize(Decimal("0.000001"))),
                                "allocation_pct": str((amt / total_discovered).quantize(Decimal("0.0001"))),
                            },
                            on_conflict="account_id,protocol_id",
                        ).execute()
                    except Exception as exc:
                        logger.warning("Failed to sync allocation for %s/%s: %s", account_id, pid, exc)
                current = discovered
                total_usd = sum(discovered.values())

        # Check on-chain idle USDC balance (not yet deployed to any protocol)
        idle_usdc = await self._get_idle_usdc_balance(smart_account_address)
        if idle_usdc > Decimal("0.01"):
            logger.info(
                "Detected %.2f idle USDC in %s (protocol-deployed: %.2f)",
                idle_usdc, smart_account_address, total_usd,
            )
            total_usd += idle_usdc

        if total_usd <= 0:
            return await self._log(db, account_id, "skipped",
                                   reason="No deposited balance")

        min_balance = Decimal(str(getattr(self.settings, "MIN_BALANCE_USD", 0)))
        if total_usd < min_balance:
            return await self._log(
                db,
                account_id,
                "skipped",
                reason=(
                    f"Total balance ${float(total_usd):.2f} below minimum "
                    f"${float(min_balance):.2f}"
                ),
            )

        # ── 4c. Portfolio value circuit breaker ──────────────────────
        # Compare current on-chain value to last recorded value.
        # If portfolio dropped >10% between scheduler ticks, halt and alert.
        # This catches exploits, oracle failures, or protocol depegs in real-time.
        try:
            prev_rows = (
                db.table("rebalance_logs")
                .select("proposed_allocations, created_at")
                .eq("account_id", account_id)
                .eq("status", "executed")
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )

            prev_snapshot = None
            for row in prev_rows.data or []:
                allocs = row.get("proposed_allocations")
                if isinstance(allocs, dict) and allocs:
                    prev_snapshot = row
                    break

            if prev_snapshot:
                prev_allocs = prev_snapshot["proposed_allocations"]
                prev_total = sum(Decimal(str(v)) for v in prev_allocs.values())
                baseline_total = prev_total

                # Adjust baseline by withdrawals that happened after the snapshot.
                # This prevents false exploit-halts when users legitimately pull funds.
                withdrawals_since_snapshot = Decimal("0")
                baseline_ts = prev_snapshot.get("created_at")
                if baseline_ts:
                    withdrawal_rows = (
                        db.table("rebalance_logs")
                        .select("amount_moved")
                        .eq("account_id", account_id)
                        .eq("status", "executed")
                        .eq("from_protocol", "withdrawal")
                        .gte("created_at", baseline_ts)
                        .execute()
                    )
                    for withdrawal_row in withdrawal_rows.data or []:
                        raw_amount = withdrawal_row.get("amount_moved")
                        if raw_amount is None:
                            continue
                        try:
                            withdrawals_since_snapshot += Decimal(str(raw_amount))
                        except Exception:
                            logger.debug(
                                "Skipping non-numeric withdrawal amount in circuit-breaker baseline: %s",
                                raw_amount,
                            )

                adjusted_baseline = max(prev_total - withdrawals_since_snapshot, Decimal("0"))
                if adjusted_baseline > Decimal("0.01"):
                    baseline_total = adjusted_baseline

                if withdrawals_since_snapshot > Decimal("0"):
                    logger.info(
                        "Circuit-breaker baseline adjusted for %s: previous=$%.2f, withdrawals=$%.2f, adjusted=$%.2f",
                        account_id,
                        float(prev_total),
                        float(withdrawals_since_snapshot),
                        float(baseline_total),
                    )

                principal_matches_balance = False
                try:
                    tracking_row = (
                        db.table("account_yield_tracking")
                        .select("cumulative_deposited, cumulative_net_withdrawn")
                        .eq("account_id", account_id)
                        .limit(1)
                        .execute()
                    )
                    if tracking_row.data:
                        cumulative_deposited = Decimal(
                            str(tracking_row.data[0].get("cumulative_deposited", "0"))
                        )
                        cumulative_withdrawn = Decimal(
                            str(tracking_row.data[0].get("cumulative_net_withdrawn", "0"))
                        )
                        outstanding_principal = max(
                            cumulative_deposited - cumulative_withdrawn,
                            Decimal("0"),
                        )
                        principal_matches_balance = (
                            abs(total_usd - outstanding_principal) <= Decimal("0.50")
                        )
                except Exception as tracking_exc:
                    logger.debug(
                        "Portfolio principal reconciliation unavailable for %s: %s",
                        account_id,
                        tracking_exc,
                    )

                if baseline_total > Decimal("0.01"):
                    drop_pct = (baseline_total - total_usd) / baseline_total
                    drop_threshold = Decimal(str(self.settings.PORTFOLIO_VALUE_DROP_PCT))
                    if drop_pct > drop_threshold:
                        if principal_matches_balance:
                            logger.info(
                                "Portfolio-drop alert suppressed for %s: on-chain balance matches outstanding principal (current=$%.2f)",
                                account_id,
                                float(total_usd),
                            )
                        else:
                            from app.services.monitoring import send_telegram_alert, send_sentry_alert
                            msg = (
                                f"CIRCUIT BREAKER: Portfolio value dropped {float(drop_pct * 100):.1f}% "
                                f"for account {account_id}. "
                                f"Baseline: ${float(baseline_total):.2f}, Current: ${float(total_usd):.2f}. "
                                f"Halting rebalance — manual investigation required."
                            )
                            logger.critical(msg)
                            await send_telegram_alert(msg)
                            send_sentry_alert(msg)
                            return await self._log(db, account_id, "halted", reason=msg)
        except Exception as exc:
            logger.warning("Portfolio circuit breaker check failed: %s — proceeding", exc)

        # 4b. Guarded launch — enforce platform-wide deposit cap
        has_existing_positions = any(v > Decimal("0.01") for v in current.values())
        if not has_existing_positions and idle_usdc > Decimal("0.01"):
            cap = Decimal(str(self.settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD))
            all_allocs = db.table("allocations").select("amount_usdc").execute()
            platform_total = sum(
                Decimal(str(r["amount_usdc"])) for r in all_allocs.data
            )
            if platform_total + idle_usdc > cap:
                return await self._log(
                    db, account_id, "skipped",
                    reason=f"Platform deposit cap reached (${float(cap):.0f}). "
                           f"Current: ${float(platform_total):.0f}, "
                           f"Deposit: ${float(idle_usdc):.0f}",
                )

            # Record the initial deposit once per principal lifecycle.
            if self._should_record_initial_deposit(db, account_id):
                record_deposit(db, account_id, idle_usdc)

        # ── 5. TARGETED health checks ──────────────────────────────
        # Architecture: check ONLY (a) protocols with active positions
        # and (b) candidate protocols in APY-ranked order until we have
        # enough healthy capacity. Never blanket-check all protocols.
        apy_by_protocol = {pid: rate.apy for pid, rate in allowed_rates.items()}
        tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in allowed_rates.items()}

        # 5a. Load historical APY data for ALL allowed protocols (cheap DB reads)
        previous_apys: dict[str, Decimal | None] = {}
        yesterday_avg_apys: dict[str, Decimal | None] = {}
        daily_snapshots_7d: dict[str, list[Decimal] | None] = {}
        for pid in allowed_rates:
            previous_apys[pid] = None
            yesterday_avg_apys[pid] = None
            daily_snapshots_7d[pid] = None

        try:
            today = datetime.now(timezone.utc).date()
            week_ago = (today - timedelta(days=7)).isoformat()
            yesterday = (today - timedelta(days=1)).isoformat()

            snap_result = (
                db.table("daily_apy_snapshots")
                .select("protocol_id, date, apy")
                .gte("date", week_ago)
                .execute()
            )
            if snap_result.data:
                from collections import defaultdict
                by_proto: dict[str, list[tuple[str, Decimal]]] = defaultdict(list)
                for row in snap_result.data:
                    by_proto[row["protocol_id"]].append(
                        (row["date"], Decimal(str(row["apy"])))
                    )
                for pid, entries in by_proto.items():
                    if pid in allowed_rates:
                        daily_snapshots_7d[pid] = [apy for _, apy in entries]
                        yesterday_entries = [apy for d, apy in entries if d == yesterday]
                        if yesterday_entries:
                            yesterday_avg_apys[pid] = yesterday_entries[0]
        except Exception as exc:
            logger.warning("Failed to load APY history for health checks: %s", exc)

        from app.services.optimizer.rate_fetcher import twap_buffer
        for pid in allowed_rates:
            latest = twap_buffer.get_latest(pid)
            if latest:
                previous_apys[pid] = latest.apy

        # ── Helper: health-check a SINGLE protocol via its adapter ───
        _NO_TVL_CAP_PROTOCOLS = frozenset(("spark",))
        protocol_utilizations: dict[str, Decimal | None] = {}

        async def _check_one(pid: str, position: Decimal) -> HealthCheckResult:
            """Fetch adapter health + run check_protocol_health for one protocol."""
            try:
                adapter = ALL_ADAPTERS.get(pid)
                if adapter:
                    proto_health = await adapter.get_health()
                else:
                    proto_health = ProtocolHealth(
                        protocol_id=pid,
                        status=ProtocolStatus.HEALTHY,
                        is_deposit_safe=True,
                        is_withdrawal_safe=True,
                    )
            except Exception as exc:
                logger.warning("Health check RPC failed for %s: %s", pid, exc)
                proto_health = ProtocolHealth(
                    protocol_id=pid,
                    status=ProtocolStatus.HEALTHY,
                    is_deposit_safe=True,
                    is_withdrawal_safe=True,
                )
            protocol_utilizations[pid] = proto_health.utilization
            return await check_protocol_health(
                protocol_id=pid,
                protocol_health=proto_health,
                current_apy=apy_by_protocol.get(pid, Decimal("0")),
                twap_apy=apy_by_protocol.get(pid, Decimal("0")),
                previous_apy=previous_apys.get(pid),
                yesterday_avg_apy=yesterday_avg_apys.get(pid),
                daily_snapshots_7d=daily_snapshots_7d.get(pid),
                current_position=position,
                protocol_tvl=tvl_by_protocol.get(pid, Decimal("0")),
                circuit_breaker_failures=circuit_breaker.get_failure_count(pid),
            )

        def _estimate_capacity(pid: str) -> Decimal:
            """Rough protocol capacity for early-stop estimation."""
            if pid in _NO_TVL_CAP_PROTOCOLS:
                return total_usd
            tvl = tvl_by_protocol.get(pid, Decimal("0"))
            if tvl <= Decimal("0"):
                return Decimal("0")
            utilization = protocol_utilizations.get(pid)
            if utilization is None:
                utilization = Decimal("0")
            utilization = max(Decimal("0"), min(utilization, Decimal("1")))
            available_liquidity = tvl * (Decimal("1") - utilization)
            return Decimal(str(self.settings.TVL_CAP_PCT)) * max(available_liquidity, Decimal("0"))

        # ── 5b. Check health of CURRENT positions ONLY ──────────────
        health_results: dict[str, HealthCheckResult] = {}
        unhealthy_positions: list[str] = []
        stranded_positions: dict[str, Decimal] = {}  # pid → USD amount

        for pid, position_amt in current.items():
            if position_amt < Decimal("0.01"):
                continue
            if pid not in allowed_rates:
                # Session key does NOT cover this protocol — we CANNOT
                # withdraw from it.  Treat the funds as stranded (not
                # actionable) and deduct from total_usd so the allocator
                # doesn't try to re-deploy money we can't actually move.
                logger.warning(
                    "STRANDED: $%.2f in %s — session key does not cover "
                    "this protocol.  User must re-grant session key with "
                    "all protocols to allow fund recovery.",
                    float(position_amt), pid,
                )
                stranded_positions[pid] = position_amt
                continue

            hr = await _check_one(pid, position_amt)
            health_results[pid] = hr

            if not hr.is_deposit_safe or not hr.is_healthy:
                logger.warning(
                    "FORCED EXIT: position $%.2f in %s failed health checks: %s",
                    float(position_amt), pid,
                    "; ".join(hr.exclusion_reasons) or "unhealthy",
                )
                unhealthy_positions.append(pid)

        # Deduct stranded funds — these are inaccessible with current
        # session key, so they must NOT be counted in the allocatable total.
        stranded_total = sum(stranded_positions.values())
        if stranded_total > Decimal("0"):
            total_usd -= stranded_total
            logger.warning(
                "Deducted $%.2f stranded funds from total_usd "
                "(new allocatable total: $%.2f)",
                float(stranded_total), float(total_usd),
            )
            if total_usd <= Decimal("0.01"):
                return await self._log(
                    db, account_id, "skipped",
                    reason=(
                        f"All funds (${float(stranded_total):.2f}) stranded in "
                        f"protocols outside session key scope: "
                        f"{', '.join(stranded_positions.keys())}. "
                        f"User must re-grant session key."
                    ),
                )

        # ── 5c. Check CANDIDATES in APY-ranked order (one at a time) ─
        # Walk the ranked list; health-check each candidate ONE at a
        # time and stop once we have enough healthy capacity for total_usd.
        ranked_candidates = sorted(
            allowed_rates.keys(),
            key=lambda pid: apy_by_protocol.get(pid, Decimal("0")),
            reverse=True,
        )

        remaining_to_allocate = total_usd
        # Deduct capacity already covered by healthy current positions
        for pid, hr in health_results.items():
            if hr.is_deposit_safe:
                remaining_to_allocate -= min(
                    remaining_to_allocate, _estimate_capacity(pid)
                )

        for pid in ranked_candidates:
            # NOTE: Do NOT early-stop based on remaining_to_allocate.
            # The allocator must see ALL healthy candidates to find the
            # best APY, even when current positions already cover capacity.
            # Without this, a lower-APY current position (e.g. Benqi 3.50%)
            # causes the early-stop to skip a higher-APY candidate (e.g.
            # Silo 3.54%), making the allocator propose no improvement.
            if pid in health_results:
                continue  # Already checked (current position)

            hr = await _check_one(pid, Decimal("0"))
            health_results[pid] = hr

            if hr.is_deposit_safe:
                logger.info(
                    "Candidate %s passed health check (TWAP APY: %.2f%%)",
                    pid, float(apy_by_protocol.get(pid, Decimal("0")) * 100),
                )
            else:
                logger.info(
                    "Candidate %s failed health check: %s — trying next",
                    pid, "; ".join(hr.exclusion_reasons),
                )

        # ── 5d. Determine global rebalance flag ─────────────────────
        global_flag = RebalanceFlag.NONE
        for hr in health_results.values():
            if hr.flag == RebalanceFlag.FORCED_REBALANCE:
                global_flag = RebalanceFlag.FORCED_REBALANCE
                break

        if unhealthy_positions and global_flag == RebalanceFlag.NONE:
            global_flag = RebalanceFlag.FORCED_REBALANCE

        if unhealthy_positions:
            logger.warning(
                "Current-protocol health enforcement triggered for %s: "
                "forcing rebalance out of %s",
                smart_account_address,
                ", ".join(unhealthy_positions),
            )

        # Log exclusions for checked protocols only
        for pid, hr in health_results.items():
            if hr.exclusion_reasons:
                logger.warning(
                    "Health check exclusions for %s: %s",
                    pid,
                    "; ".join(hr.exclusion_reasons),
                )

        allocation_caps = session_key_record.get("allocation_caps")
        allocation_result = compute_allocation(
            health_results=health_results,
            twap_apys=apy_by_protocol,
            protocol_tvls=tvl_by_protocol,
            total_balance=total_usd,
            protocol_utilizations=protocol_utilizations,
            user_preferences=_build_user_preferences(
                set(allowed_rates.keys()),
                allocation_caps if isinstance(allocation_caps, dict) else None,
            ),
        )

        result_allocations = allocation_result.allocations
        ranked_protocols = allocation_result.details.get("ranked_order", [])
        new_weighted_apy = allocation_result.weighted_apy
        current_weighted_apy = compute_alloc_weighted_apy(
            allocations=current,
            total_balance=total_usd,
            twap_apys=apy_by_protocol,
        )
        apy_improvement = new_weighted_apy - current_weighted_apy

        # 6. Beat-margin gate (bypassed by FORCED/EMERGENCY flags AND initial deployments)
        #    Initial deployment: idle USDC earning 0% → any protocol is better.
        has_existing_protocol_positions = any(v > Decimal("0.01") for v in current.values())
        is_initial_deployment = not has_existing_protocol_positions and idle_usdc > Decimal("0.01")
        is_idle_topup_deployment = has_existing_protocol_positions and idle_usdc >= Decimal("1.00")
        skip_performance_gates = is_initial_deployment or is_idle_topup_deployment

        if is_idle_topup_deployment:
            logger.info(
                "Idle top-up deployment for %s detected (idle=$%.2f) — bypassing beat/min-gap/profitability gates",
                smart_account_address,
                float(idle_usdc),
            )

        if global_flag == RebalanceFlag.NONE and not skip_performance_gates and apy_improvement < Decimal(str(self.settings.BEAT_MARGIN)):
            # Detailed diagnostics for beat-margin skip — the most common
            # skip reason; helps operators understand why rebalance didn't fire.
            logger.info(
                "BEAT-MARGIN SKIP for %s: current_wAPY=%.4f%%, proposed_wAPY=%.4f%%, "
                "improvement=%.4f%%, margin=%.4f%%, is_initial=%s, idle=$%.2f, "
                "current_allocs=%s, proposed=%s, allowed=%s, all_twap_rates=%s",
                smart_account_address,
                float(current_weighted_apy * 100),
                float(new_weighted_apy * 100),
                float(apy_improvement * 100),
                float(Decimal(str(self.settings.BEAT_MARGIN)) * 100),
                is_initial_deployment,
                float(idle_usdc),
                {p: f"${float(v):.2f}" for p, v in current.items()},
                {p: f"${float(v):.2f}" for p, v in result_allocations.items()},
                sorted(allowed_rates.keys()),
                {p: f"{float(r.apy * 100):.2f}%" for p, r in allowed_rates.items()},
            )
            return await self._log(
                db, account_id, "skipped",
                reason="APY improvement below beat margin",
                proposed=result_allocations,
            )

        # 7. Check time since last rebalance
        last = (
            db.table("rebalance_logs")
            .select("created_at")
            .eq("account_id", account_id)
            .eq("status", "executed")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if last.data and global_flag == RebalanceFlag.NONE and not skip_performance_gates:
            last_ts = datetime.fromisoformat(last.data[0]["created_at"])
            min_gap = self._min_rebalance_gap(total_usd)
            if datetime.now(timezone.utc) - last_ts < min_gap:
                return await self._log(
                    db, account_id, "skipped",
                    reason=(
                        "Last rebalance too recent "
                        f"({last_ts.isoformat()}, min_gap={str(min_gap)})"
                    ),
                    proposed=result_allocations,
                )

        # 8. Delta check — skip if total movement is below $0.01 (bypassed by FORCED/EMERGENCY
        #    and initial deployments where idle USDC has no counterpart in current)
        all_protocols = set(current.keys()) | set(result_allocations.keys())
        total_movement = sum(
            abs(result_allocations.get(pid, Decimal("0")) - current.get(pid, Decimal("0")))
            for pid in all_protocols
        ) / Decimal("2")
        if global_flag == RebalanceFlag.NONE and not skip_performance_gates and total_movement < Decimal("0.01"):
            return await self._log(
                db,
                account_id,
                "skipped",
                reason="Total movement below $0.01",
                proposed=result_allocations,
            )

        # 8b. Profitability gate — skip if expected gain does not cover gas.
        # Bypassed for initial deployments: idle USDC at 0% should be deployed.
        if global_flag == RebalanceFlag.NONE and total_usd > 0 and not skip_performance_gates:
            daily_gain = apy_improvement * total_usd / Decimal("365")
            gas_cost = Decimal(str(self.settings.GAS_COST_ESTIMATE_USD))
            breakeven_days = Decimal(str(self.settings.PROFITABILITY_BREAKEVEN_DAYS))
            if daily_gain * breakeven_days < gas_cost:
                return await self._log(
                    db,
                    account_id,
                    "skipped",
                    reason=(
                        f"Profitability gate: {int(breakeven_days)}d gain "
                        f"${float(daily_gain * breakeven_days):.4f} < gas ${float(gas_cost):.4f}"
                    ),
                    proposed=result_allocations,
                )

        # 8c. Max single rebalance value — cap per-operation movement
        max_rebalance = Decimal(str(self.settings.MAX_SINGLE_REBALANCE_USD))
        if total_movement > max_rebalance:
            from app.services.monitoring import send_telegram_alert, send_sentry_alert
            msg = (
                f"Rebalance value limit exceeded for {account_id}: "
                f"${float(total_movement):.2f} > ${float(max_rebalance):.2f} cap. "
                f"Blocking rebalance — manual review required."
            )
            logger.critical(msg)
            await send_telegram_alert(msg)
            send_sentry_alert(msg)
            return await self._log(
                db, account_id, "halted",
                reason=msg,
                proposed=result_allocations,
            )

        # 8d. Idempotency guard — prevent double-execution on retries.
        # If a rebalance with the exact same target was executed in the last 60 min, skip.
        try:
            recent_logs = (
                db.table("rebalance_logs")
                .select("proposed_allocations, created_at")
                .eq("account_id", account_id)
                .eq("status", "executed")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if not is_initial_deployment and recent_logs.data:
                last_executed = recent_logs.data[0]
                last_ts = datetime.fromisoformat(last_executed["created_at"])
                if datetime.now(timezone.utc) - last_ts < timedelta(minutes=60):
                    last_proposed = last_executed.get("proposed_allocations") or {}
                    proposed_str = {k: str(v.quantize(Decimal("0.01"))) for k, v in result_allocations.items()}
                    last_str = {k: str(Decimal(str(v)).quantize(Decimal("0.01"))) for k, v in last_proposed.items()}
                    current_str = {
                        k: str(v.quantize(Decimal("0.01")))
                        for k, v in current.items()
                        if v > Decimal("0.01")
                    }

                    # Skip only when BOTH target and current state are identical.
                    # If state drifted (e.g. funds became idle again), allow execute.
                    if proposed_str == last_str and current_str == last_str:
                        return await self._log(
                            db, account_id, "skipped",
                            reason="Idempotency: identical rebalance executed within 60 min",
                            proposed=result_allocations,
                        )
                    if proposed_str == last_str and current_str != last_str:
                        logger.info(
                            "Idempotency bypass for %s — target matches last executed "
                            "but current state diverged (current=%s, last=%s)",
                            smart_account_address,
                            current_str,
                            last_str,
                        )
        except Exception as exc:
            logger.warning("Idempotency guard check failed: %s — proceeding", exc)

        # 9. Execute
        logger.info(
            "EXECUTING rebalance for %s: current=%s, target=%s, "
            "idle=$%.2f, total=$%.2f, movement=$%.2f, apy_gain=%.4f%%, "
            "flag=%s, is_initial=%s, is_idle_topup=%s",
            smart_account_address,
            {p: f"${float(v):.2f}" for p, v in current.items()},
            {p: f"${float(v):.2f}" for p, v in result_allocations.items()},
            float(idle_usdc), float(total_usd), float(total_movement),
            float(apy_improvement * 100),
            global_flag.name, is_initial_deployment, is_idle_topup_deployment,
        )
        try:
            tx_hash = await self._execute_rebalance_once(
                account_id=account_id,
                smart_account_address=smart_account_address,
                target_allocations=result_allocations,
                known_idle_usdc=idle_usdc,
            )
        except RuntimeError as exc:
            if str(exc) == "REBALANCE_IN_FLIGHT":
                logger.info(
                    "Rebalance for %s skipped — another attempt in flight",
                    smart_account_address,
                )
                return await self._log(
                    db,
                    account_id,
                    "skipped",
                    reason="Another rebalance attempt in flight",
                    proposed=result_allocations,
                )
            raise
        except ValueError as exc:
            # Non-retryable (e.g. invalid/revoked session key)
            logger.warning("Rebalance skipped for %s: %s", smart_account_address, exc)
            await self._log(db, account_id, "skipped",
                            reason=str(exc),
                            proposed=result_allocations)
            raise  # Let scheduler see ValueError as non-retryable
        except Exception as exc:
            logger.exception("Rebalance execution failed for %s", smart_account_address)

            # ── Detect "inner calls reverting" and force-reconcile DB ──
            # When the execution error states that inner calls (withdrawals/
            # deposits) are reverting, it usually means the DB allocations
            # are stale (e.g. DB says user has $1 in Euler but on-chain
            # they have $0).  Force-reconcile the DB to on-chain truth so
            # the NEXT scheduler cycle does not repeat the same failure.
            err_msg = str(exc).lower()
            if "inner calls" in err_msg or "reverting" in err_msg or "useroperation reverted" in err_msg:
                logger.warning(
                    "Inner calls reverted for %s — force-reconciling DB allocations to on-chain",
                    smart_account_address,
                )
                try:
                    all_protocol_ids = set(self._protocol_addresses.keys())
                    onchain = await self._discover_onchain_balances(
                        smart_account_address, all_protocol_ids,
                    )
                    if onchain:
                        await self._update_allocations_db(db, account_id, onchain)
                        logger.info(
                            "Reconciled allocations for %s to on-chain: %s",
                            account_id,
                            {p: f"${float(v):.2f}" for p, v in onchain.items()},
                        )
                    else:
                        db.table("allocations").delete().eq("account_id", account_id).execute()
                        logger.info("Cleared all allocations for %s (no on-chain positions found)", account_id)
                except Exception as reconcile_exc:
                    logger.warning("DB reconciliation failed: %s", reconcile_exc)

            # Initial deployment fallback: if top protocol fails, try next-best protocol
            # so idle USDC is still put to work.
            has_existing_positions = any(v > Decimal("0.01") for v in current.values())
            is_initial_deployment = (not has_existing_positions) and idle_usdc > Decimal("0.01")

            if is_initial_deployment and ranked_protocols:
                primary_protocol = max(result_allocations, key=result_allocations.get)
                attempted = [primary_protocol]
                for fallback_protocol in ranked_protocols:
                    if fallback_protocol == primary_protocol:
                        continue
                    attempted.append(fallback_protocol)
                    fallback_target = {fallback_protocol: total_usd}
                    logger.warning(
                        "Initial deployment fallback for %s: trying %s after %s failed",
                        smart_account_address,
                        fallback_protocol,
                        primary_protocol,
                    )
                    try:
                        tx_hash = await self._execute_rebalance_once(
                            account_id=account_id,
                            smart_account_address=smart_account_address,
                            target_allocations=fallback_target,
                            known_idle_usdc=idle_usdc,
                        )
                        if tx_hash:
                            return await self._log(
                                db,
                                account_id,
                                "executed",
                                proposed=fallback_target,
                                tx_hash=tx_hash,
                                apr_improvement=apy_by_protocol.get(fallback_protocol, Decimal("0")),
                            )
                    except ValueError:
                        raise
                    except Exception:
                        logger.exception(
                            "Fallback deployment failed for %s on %s",
                            smart_account_address,
                            fallback_protocol,
                        )

                return await self._log(
                    db,
                    account_id,
                    "failed",
                    reason=(
                        f"Execution failed on all candidate protocols: {', '.join(attempted)}"
                    ),
                    proposed=result_allocations,
                )

            return await self._log(db, account_id, "failed",
                                   reason=str(exc),
                                   proposed=result_allocations)

        if tx_hash is None:
            return await self._log(db, account_id, "skipped",
                                   reason="No concrete moves generated",
                                   proposed=result_allocations)

        # 10. Log success
        return await self._log(
            db, account_id, "executed",
            proposed=result_allocations,
            tx_hash=tx_hash,
            apr_improvement=apy_improvement,
        )

    # â”€â”€ Get current allocations (DB + on-chain verification) â”€â”€â”€â”€â”€â”€â”€â”€

    async def _get_current_allocations(
        self,
        account_id: str,
        smart_account_address: str,
    ) -> dict[str, Decimal]:
        """Read allocations from DB, cross-check with on-chain balances."""
        db = get_supabase()
        alloc_rows = (
            db.table("allocations")
            .select("protocol_id, amount_usdc")
            .eq("account_id", account_id)
            .execute()
        )
        current: dict[str, Decimal] = {}
        for row in alloc_rows.data:
            current[row["protocol_id"]] = Decimal(str(row["amount_usdc"]))

        # On-chain verification: read actual balances and prefer them
        usdc = self.settings.USDC_ADDRESS
        for pid in list(current.keys()):
            try:
                adapter = get_adapter(pid)
                balance_wei = await adapter.get_balance(smart_account_address)
                # Convert to USD (USDC = 6 decimals)
                balance_usd = Decimal(str(balance_wei)) / Decimal("1000000")
                if abs(balance_usd - current[pid]) > Decimal("0.000001"):
                    logger.warning(
                        "Balance mismatch for %s/%s: DB=%s, on-chain=%s â€” using on-chain",
                        smart_account_address, pid, current[pid], balance_usd,
                    )
                    current[pid] = balance_usd
            except Exception as exc:
                logger.warning("On-chain balance check failed for %s: %s", pid, exc)

        return current

    # â”€â”€ Execute rebalance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def _call_execution_service(
        self,
        serialized_permission: str,
        smart_account_address: str,
        withdrawals: list[dict],
        deposits: list[dict],
        session_private_key: str = "",
        account_id: str | None = None,
        fee_transfer: dict | None = None,
        user_transfer: dict | None = None,
    ) -> str:
        """Call the Node.js execution service to execute via ZeroDev.

        fee_transfer: optional {"to": treasury_address, "amountUSDC": float}
        user_transfer: optional {"to": eoa_address, "amountUSDC": float}
        Both appended to the batch after withdrawals, before deposits.
        """
        try:
            result = await ExecutionService().execute_rebalance(
                serialized_permission=serialized_permission,
                smart_account_address=smart_account_address,
                withdrawals=withdrawals,
                deposits=deposits,
                session_private_key=session_private_key,
                fee_transfer=fee_transfer,
                user_transfer=user_transfer,
            )
            logger.info("Execution service returned: %s", result)
            return result["txHash"]
        except httpx.HTTPStatusError as exc:
            # Detect DEFINITIVELY invalid session key errors and revoke.
            # IMPORTANT: "validateUserOp" was removed — it's too broad.
            # validateUserOp can fail for transient reasons (gas, nonce,
            # bundler timeout, paymaster) that do NOT indicate a bad session
            # key. Revoking on transient errors destroys user authorization
            # and blocks all future rebalances until the user re-activates.
            err_msg = ""
            if exc.response is not None:
                try:
                    err_msg = exc.response.json().get("error", "")
                except Exception as parse_exc:
                    logger.warning(
                        "Execution error JSON parse failed for %s: %s",
                        smart_account_address,
                        parse_exc,
                    )
                    err_msg = exc.response.text

            # 429 = execution service concurrency limit — transient, do NOT revoke
            if exc.response is not None and exc.response.status_code == 429:
                logger.warning(
                    "Execution service at capacity (429) for %s — will retry next cycle",
                    smart_account_address,
                )
                raise

            # EnableNotApproved from the ACTIVE key means the enable signature
            # is fundamentally invalid. Skip recovery loop — old keys will also
            # fail. Deactivate immediately so we stop retrying.
            if "EnableNotApproved" in err_msg:
                logger.warning(
                    "EnableNotApproved for %s — enable signature invalid. "
                    "Deactivating session key. User must re-grant.",
                    smart_account_address,
                )
                if account_id:
                    db = get_supabase()
                    revoke_session_key(db, UUID(account_id))
                raise ValueError(
                    f"Session key invalid for {smart_account_address} — "
                    f"EnableNotApproved, revoked"
                ) from exc

            # PERMISSION_RECOVERY_NEEDED: The current session key can't install
            # its permission (duplicate hash from a previous grant) and can't
            # use regular mode (different permissionId). Try deactivated keys
            # whose permission may still be installed on-chain.
            if "PERMISSION_RECOVERY_NEEDED" in err_msg:
                logger.warning(
                    "PERMISSION_RECOVERY_NEEDED for %s — trying old session keys",
                    smart_account_address,
                )
                if account_id:
                    db = get_supabase()
                    old_keys = get_deactivated_session_key_records(
                        db, UUID(account_id), limit=12
                    )
                    for old_key in old_keys:
                        try:
                            logger.info(
                                "Trying deactivated key %s for %s",
                                old_key["key_id"],
                                smart_account_address,
                            )
                            result = await ExecutionService().execute_rebalance(
                                serialized_permission=old_key[
                                    "serialized_permission"
                                ],
                                smart_account_address=smart_account_address,
                                withdrawals=withdrawals,
                                deposits=deposits,
                                session_private_key=old_key[
                                    "session_private_key"
                                ],
                                fee_transfer=fee_transfer,
                                user_transfer=user_transfer,
                            )
                            # Old key worked! Reactivate it.
                            logger.info(
                                "Old session key %s succeeded for %s — "
                                "reactivating",
                                old_key["key_id"],
                                smart_account_address,
                            )
                            reactivate_session_key(
                                db, UUID(account_id), old_key["key_id"]
                            )
                            return result["txHash"]
                        except Exception as recovery_err:
                            logger.debug(
                                "Old key %s failed for %s: %s",
                                old_key["key_id"],
                                smart_account_address,
                                str(recovery_err)[:200],
                            )
                            continue
                    # No old key worked — log and skip (do NOT deactivate)
                    logger.error(
                        "All old session keys failed for %s. "
                        "This happens because the on-chain permissionHash belongs "
                        "to a session key signer that is no longer available. "
                        "User must re-grant from dashboard (frontend must include a "
                        "non-repeating gasNonce for unique permissionHash). "
                        "NOT deactivating current key to avoid re-grant loop.",
                        smart_account_address,
                    )
                raise ValueError(
                    f"PERMISSION_RECOVERY_NEEDED for {smart_account_address} "
                    f"— no working session key found"
                ) from exc

            # DEADLOCK = gas policy exhausted on-chain → regular mode AA23,
            # and permission is already installed → enable mode "duplicate permissionHash".
            # The stored session key can never work again with this permissionId.
            # Deactivate it so the scheduler stops retrying every cycle.
            # The user must re-grant from the dashboard (new signer → new permissionId
            # → fresh gas policy counter).
            if "DEADLOCK" in err_msg:
                logger.warning(
                    "DEADLOCK detected for %s — gas policy likely exhausted. "
                    "Deactivating session key. User must re-grant from dashboard.",
                    smart_account_address,
                )
                if account_id:
                    db = get_supabase()
                    revoke_session_key(db, UUID(account_id))
                    logger.info(
                        "Session key deactivated for %s due to DEADLOCK",
                        smart_account_address,
                    )
                raise ValueError(
                    f"DEADLOCK for {smart_account_address} — session key stale, user must re-grant"
                ) from exc

            # Only revoke on errors that definitively mean the session key
            # itself is corrupt, expired, or for the wrong account.
            #
            # EnableNotApproved: The Kernel contract's _checkApproval rejects
            # the enable signature — ecrecover(typedDataHash, enableSig) does
            # NOT match the on-chain ECDSA validator owner. This is a definitive
            # session key error: the blob's enable signature is invalid and no
            # amount of retrying will fix it. Old keys will also fail because
            # they use different enable signatures that are equally invalid.
            # Deactivate and require re-grant.
            is_definite_session_key_error = (
                "EnableNotApproved" in err_msg
                or "serializedSessionKey" in err_msg
                or "No signer" in err_msg
                or "Session key/account mismatch" in err_msg
            )
            if is_definite_session_key_error:
                logger.warning(
                    "Definitive session key error for %s — revoking. Error: %s",
                    smart_account_address,
                    err_msg[:300],
                )
                if account_id:
                    db = get_supabase()
                    revoke_session_key(db, UUID(account_id))
                raise ValueError(
                    f"Session key invalid for {smart_account_address} — revoked"
                ) from exc
            raise

    async def execute_rebalance(
        self,
        account_id: str,
        smart_account_address: str,
        target_allocations: dict[str, Decimal],
        known_idle_usdc: Decimal | None = None,
    ) -> str | None:
        """
        Execute a full rebalance via the Node.js execution service:
          1. Get current allocations (DB + on-chain balance check)
          2. Compute withdrawals/deposits from deltas
          3. Call execution service with ZeroDev serialized permission
          4. Update allocations in DB
        Returns tx_hash, or None if nothing to do.
        """
        db = get_supabase()

        # Step 1: Get current allocations
        current = await self._get_current_allocations(account_id, smart_account_address)

        # Step 2: Compute what needs to happen
        withdrawals: list[tuple[str, Decimal]] = []  # (protocol_id, usd_amount)
        deposits: list[tuple[str, Decimal]] = []

        # Dust threshold for individual moves — intentionally low ($0.01)
        # because all strategic gating (beat margin, delta check, profitability)
        # already happened in steps 6-8b above. This is only to avoid zero-value
        # calls to the execution service.
        _MOVE_DUST = Decimal("0.01")

        for protocol_id, target_usd in target_allocations.items():
            current_usd = current.get(protocol_id, Decimal("0"))
            delta = target_usd - current_usd
            if delta < -_MOVE_DUST:
                withdrawals.append((protocol_id, abs(delta)))
            elif delta > _MOVE_DUST:
                deposits.append((protocol_id, delta))

        # Check for protocols being fully exited (in current but not in target)
        for protocol_id, current_usd in current.items():
            if protocol_id not in target_allocations and current_usd > _MOVE_DUST:
                withdrawals.append((protocol_id, current_usd))

        if not withdrawals and not deposits:
            return None

        # ── Balance guard ────────────────────────────────────────────
        # Verify that the funds we plan to deposit actually exist.
        # total_deposits must not exceed total_withdrawals + idle USDC.
        # This prevents sending impossible "deposit-only" rebalances
        # when on-chain balance reads differ from the scheduler's DB view.
        total_deposit_amt = sum(amt for _, amt in deposits)
        total_withdraw_amt = sum(amt for _, amt in withdrawals)
        idle_usdc = (
            max(known_idle_usdc, Decimal("0"))
            if known_idle_usdc is not None
            else await self._get_idle_usdc_balance(smart_account_address)
        )

        available_for_deposit = total_withdraw_amt + idle_usdc
        if total_deposit_amt > available_for_deposit + Decimal("0.05"):
            logger.warning(
                "BALANCE GUARD: deposit $%.2f exceeds available funds $%.2f "
                "(withdrawals=$%.2f + idle=$%.2f) for %s — skipping rebalance",
                float(total_deposit_amt),
                float(available_for_deposit),
                float(total_withdraw_amt),
                float(idle_usdc),
                smart_account_address,
            )
            return None

        # ERC-4626 rounding protection: redeem(shares) may return 1-2 micro-USDC
        # less than convertToAssets(shares) predicted (due to block timing and
        # integer rounding).  The deposit amount (from target_allocations) was
        # computed using balance reads from an earlier block, so it can exceed
        # the actual USDC available after the withdrawal.  Cap deposits to
        # available funds minus a small buffer to prevent the atomic UserOp
        # batch from reverting on-chain.
        if total_deposit_amt > Decimal("0") and total_deposit_amt > available_for_deposit - Decimal("0.000002"):
            capped = available_for_deposit - Decimal("0.000002")
            if capped > Decimal("0") and total_deposit_amt > capped:
                ratio = capped / total_deposit_amt
                deposits = [
                    (pid, (amt * ratio).quantize(Decimal("0.000001"), rounding=ROUND_DOWN))
                    for pid, amt in deposits
                ]
                logger.info(
                    "Capped deposit amounts from $%.6f to $%.6f "
                    "(ERC-4626 rounding protection) for %s",
                    float(total_deposit_amt),
                    float(sum(a for _, a in deposits)),
                    smart_account_address,
                )

        # Step 3: Get session key and call execution service
        try:
            session_record = get_active_session_key_record(db, UUID(account_id))
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        if not session_record:
            raise ValueError(f"No active session key for account {account_id}")
        session_key = session_record["serialized_permission"]
        session_private_key = session_record.get("session_private_key", "")

        # Diagnostic: log whether session private key is present (never log the key itself)
        logger.info(
            "Session key retrieved for %s: has_private_key=%s, approval_length=%d",
            account_id,
            bool(session_private_key),
            len(session_key) if session_key else 0,
        )
        if not session_private_key:
            logger.warning(
                "No session_private_key found for account %s. "
                "This is a legacy session key — user must re-grant from dashboard.",
                account_id,
            )

        # Track which protocols are being fully exited (in current but not in target)
        full_exit_protocols = frozenset(
            pid for pid in current
            if pid not in target_allocations and current.get(pid, Decimal("0")) > _MOVE_DUST
        )

        # Build withdrawal/deposit instructions for the Node.js execution service
        _ERC4626_PROTOCOLS = frozenset(
            ("spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc", "silo_gami_usdc")
        )
        exec_withdrawals = []
        for protocol_id, amount_usd in withdrawals:
            entry: dict = {"protocol": protocol_id, "amountUSDC": float(amount_usd)}
            if protocol_id == "benqi":
                adapter = get_adapter(protocol_id)
                amount_wei = int(Decimal(str(amount_usd)) * Decimal("1e6"))
                qi_amount = await adapter.usdc_to_qi_tokens(amount_wei)
                entry["qiTokenAmount"] = str(qi_amount)
            elif protocol_id in _ERC4626_PROTOCOLS and protocol_id in full_exit_protocols:
                # Full exit from ERC-4626 vault: use redeem(shares) instead of
                # withdraw(assets) to avoid share-rounding revert.
                # ERC-4626 withdraw() rounds UP shares to burn, which can exceed
                # the user's balance by 1 share on a full exit.
                adapter = get_adapter(protocol_id)
                try:
                    share_balance = await adapter.get_shares(smart_account_address)
                    entry["amountUSDC"] = "MAX"
                    entry["shareBalance"] = str(int(share_balance))
                    logger.info(
                        "Full exit from %s: using redeem(shares=%s) instead of withdraw(assets)",
                        protocol_id, share_balance,
                    )
                except Exception as exc:
                    logger.warning(
                        "Failed to read share balance for %s/%s: %s — falling back to withdraw(assets)",
                        smart_account_address, protocol_id, exc,
                    )
            elif protocol_id == "folks" and protocol_id in full_exit_protocols:
                # Folks full exits are safer with explicit full-withdraw mode,
                # avoiding stale amount rounding from prior balance snapshots.
                entry["amountUSDC"] = "MAX"
                entry["fallbackAmountUSDC"] = float(amount_usd)
            exec_withdrawals.append(entry)

        exec_deposits: list[dict] = []
        for pid, amt in deposits:
            entry: dict = {"protocol": pid, "amountUSDC": float(amt)}
            if pid == "folks":
                entry["folksMode"] = "auto"
            exec_deposits.append(entry)

        tx_hash = await self._call_execution_service(
            serialized_permission=session_key,
            smart_account_address=smart_account_address,
            withdrawals=exec_withdrawals,
            deposits=exec_deposits,
            session_private_key=session_private_key,
            account_id=account_id,
        )

        # Step 4: Update allocations in DB
        await self._update_allocations_db(
            db, account_id, target_allocations,
        )

        return tx_hash

    # ── Partial withdrawal (no fee) ──────────────────────────────────────────

    async def execute_partial_withdrawal(
        self,
        account_id: str,
        smart_account_address: str,
        protocol_id: str,
        amount_usdc: float,
    ) -> str:
        """Withdraw a portion from a single protocol — no fee charged.

        Tracks cumulative_withdrawn in account_yield_tracking so the
        full-withdrawal profit calculation remains correct.
        """
        db = get_supabase()
        amount = Decimal(str(amount_usdc))

        session_key_record = get_active_session_key_record(db, UUID(account_id))
        if not session_key_record:
            raise ValueError(f"No active session key for account {account_id}")

        serialized_permission = session_key_record["serialized_permission"]
        session_private_key = session_key_record.get("session_private_key", "")
        if not session_private_key:
            raise ValueError(
                f"Active session key for {account_id} is missing private key material"
            )

        allowed_protocols = set(session_key_record.get("allowed_protocols") or [])
        if allowed_protocols and protocol_id not in allowed_protocols:
            raise ValueError(
                f"Session key for {account_id} does not allow protocol {protocol_id}"
            )

        # Build withdrawal instruction
        entry: dict = {"protocol": protocol_id, "amountUSDC": float(amount)}
        if protocol_id == "benqi":
            adapter = get_adapter(protocol_id)
            amount_wei = int(amount * Decimal("1e6"))
            qi_amount = await adapter.usdc_to_qi_tokens(amount_wei)
            entry["qiTokenAmount"] = str(qi_amount)

        tx_hash = await self._call_execution_service(
            serialized_permission=serialized_permission,
            smart_account_address=smart_account_address,
            withdrawals=[entry],
            deposits=[],
            session_private_key=session_private_key,
            account_id=account_id,
        )

        # Track the partial withdrawal for fee calculation
        record_partial_withdrawal(db, account_id, amount)

        # Update allocations in DB: reduce the protocol allocation
        current = await self._get_current_allocations(account_id, smart_account_address)
        current_amt = current.get(protocol_id, Decimal("0"))
        new_amt = max(current_amt - amount, Decimal("0"))
        if new_amt < Decimal("0.01"):
            # Remove the allocation entirely
            db.table("allocations").delete().eq(
                "account_id", account_id
            ).eq("protocol_id", protocol_id).execute()
        else:
            db.table("allocations").update(
                {"amount_usdc": str(new_amt.quantize(Decimal("0.000001")))}
            ).eq("account_id", account_id).eq("protocol_id", protocol_id).execute()

        logger.info(
            "Partial withdrawal of $%.2f from %s for %s: tx=%s",
            amount_usdc, protocol_id, smart_account_address, tx_hash,
        )
        return tx_hash

    # â”€â”€ Emergency withdrawal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def execute_emergency_withdrawal(
        self,
        account_id: str,
        smart_account_address: str,
    ) -> tuple[str, dict]:
        """
        Emergency: withdraw ALL positions across every protocol in a single tx.
        Fee transfer plumbing is preserved but currently disabled by config.
        Revokes session keys after execution.

        Returns (tx_hash, fee_breakdown).
        """
        db = get_supabase()
        current = await self._get_current_allocations(account_id, smart_account_address)

        exec_withdrawals = []
        _ERC4626_PROTOCOLS = frozenset(
            ("spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc", "silo_gami_usdc")
        )
        for protocol_id, amount_usd in current.items():
            if amount_usd < Decimal("0.01"):
                continue
            entry: dict = {"protocol": protocol_id, "amountUSDC": "MAX"}
            if protocol_id == "benqi":
                adapter = get_adapter(protocol_id)
                try:
                    qi_balance = await adapter.get_shares(smart_account_address)
                    entry["qiTokenAmount"] = str(int(qi_balance))
                except Exception as exc:
                    logger.warning(
                        "Failed to read Benqi qiToken balance for %s: %s — skipping protocol",
                        smart_account_address, exc,
                    )
                    continue
            elif protocol_id in _ERC4626_PROTOCOLS:
                # ERC-4626 redeem() requires exact share balance — read on-chain
                adapter = get_adapter(protocol_id)
                try:
                    share_balance = await adapter.get_shares(smart_account_address)
                    entry["shareBalance"] = str(int(share_balance))
                except Exception as exc:
                    logger.warning(
                        "Failed to read share balance for %s/%s: %s — skipping protocol",
                        smart_account_address, protocol_id, exc,
                    )
                    continue
            exec_withdrawals.append(entry)

        if not exec_withdrawals:
            raise ValueError("No positions to withdraw")

        session_key = get_active_session_key(db, UUID(account_id))
        if not session_key:
            raise ValueError(f"No active session key for account {account_id}")

        # Calculate withdrawal accounting values.
        current_value = sum(current.values())
        idle_usdc = await self._get_idle_usdc_balance(smart_account_address)
        total_value = current_value + idle_usdc

        from app.services.fee_calculator import (
            calculate_withdrawal_fee,
            get_yield_tracking,
            record_withdrawal_fee,
        )

        agent_fee_enabled = bool(self.settings.AGENT_FEE_ENABLED)
        yield_info = get_yield_tracking(db, account_id)
        deposited_total = Decimal(
            str(
                (yield_info or {}).get("cumulative_deposited")
                if yield_info and (yield_info.get("cumulative_deposited") is not None)
                else (yield_info or {}).get("total_deposited_usdc", total_value)
            )
        )
        withdrawn_total = Decimal(
            str(
                (yield_info or {}).get("cumulative_net_withdrawn")
                if yield_info and (yield_info.get("cumulative_net_withdrawn") is not None)
                else (yield_info or {}).get("total_withdrawn_usdc", "0")
            )
        )
        fee_breakdown = calculate_withdrawal_fee(
            current_value_usd=total_value,
            total_deposited_usdc=deposited_total,
            total_withdrawn_usdc=withdrawn_total,
        )
        if not agent_fee_enabled:
            fee_breakdown = {
                "profit_usd": fee_breakdown["profit_usd"],
                "fee_usd": Decimal("0"),
                "net_withdrawal_usd": total_value,
                "fee_pct": Decimal("0"),
            }

        # Include transfers in the atomic batch (Mark's approach:
        # withdraw from protocols + fee to treasury + remainder to user EOA in one UserOp)
        fee_transfer = None
        treasury = self.settings.TREASURY_ADDRESS
        if fee_breakdown["fee_usd"] > Decimal("0.01") and treasury:
            fee_transfer = {
                "to": treasury,
                "amountUSDC": float(fee_breakdown["fee_usd"]),
            }
            logger.info(
                "Including fee transfer of $%.2f to treasury %s for %s",
                float(fee_breakdown["fee_usd"]), treasury, smart_account_address,
            )

        # Build user transfer payload — send USDC to user's EOA.
        # Look up owner_address from accounts table so the execution service
        # doesn't need on-chain resolution (which fails on ZeroDev v5.x).
        user_transfer = None
        if fee_breakdown["net_withdrawal_usd"] > Decimal("0.01"):
            owner_row = (
                db.table("accounts")
                .select("owner_address")
                .eq("id", account_id)
                .limit(1)
                .execute()
            )
            owner_addr = owner_row.data[0]["owner_address"] if owner_row.data else None
            if not owner_addr:
                raise ValueError(f"No owner_address found for account {account_id}")
            user_transfer = {
                "to": owner_addr,
                "amountUSDC": float(fee_breakdown["net_withdrawal_usd"]),
            }

        tx_hash = await self._call_execution_service(
            serialized_permission=session_key,
            smart_account_address=smart_account_address,
            withdrawals=exec_withdrawals,
            deposits=[],
            account_id=account_id,
            fee_transfer=fee_transfer,
            user_transfer=user_transfer,
        )

        # Record fee in DB only when fee charging is enabled.
        if agent_fee_enabled and fee_breakdown["fee_usd"] > Decimal("0"):
            record_withdrawal_fee(
                db, account_id,
                withdrawn_usdc=total_value,
                fee_usdc=fee_breakdown["fee_usd"],
            )

        # Revoke session keys + mark account inactive
        revoke_session_key(db, UUID(account_id))
        db.table("accounts").update(
            {"is_active": False}
        ).eq("id", account_id).execute()

        # Clear allocations
        db.table("allocations").delete().eq(
            "account_id", account_id
        ).execute()

        logger.info(
            "Emergency withdrawal executed for %s: tx=%s fee=$%.2f",
            smart_account_address, tx_hash, float(fee_breakdown["fee_usd"]),
        )
        return tx_hash, fee_breakdown

    # â”€â”€ DB helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def _update_allocations_db(
        self,
        db,
        account_id: str,
        target_allocations: dict[str, Decimal],
    ) -> None:
        """Upsert allocation rows to reflect the new target state."""
        # Delete old rows and insert fresh ones
        db.table("allocations").delete().eq("account_id", account_id).execute()

        total = sum(target_allocations.values())
        rows = [
            {
                "account_id": account_id,
                "protocol_id": pid,
                "amount_usdc": str(amt.quantize(Decimal("0.000001"))),
                "allocation_pct": str((amt / total).quantize(Decimal("0.0001"))) if total else "0",
            }
            for pid, amt in target_allocations.items()
            if amt > Decimal("0.01")
        ]
        if rows:
            db.table("allocations").insert(rows).execute()

    async def _log(
        self,
        db,
        account_id: str,
        status: str,
        reason: str | None = None,
        proposed: dict | None = None,
        tx_hash: str | None = None,
        apr_improvement: Decimal | None = None,
    ) -> dict:
        row = {
            "account_id": account_id,
            "status": status,
            "skip_reason": reason,
            "proposed_allocations": (
                {k: str(v) for k, v in proposed.items()} if proposed else None
            ),
            "tx_hash": tx_hash,
            "apr_improvement": str(apr_improvement) if apr_improvement is not None else None,
        }
        try:
            db.table("rebalance_logs").insert(row).execute()
        except Exception as exc:
            logger.warning("Failed to log rebalance: %s", exc)
        logger.info(
            "Rebalance %s for %s: %s",
            status, account_id, reason or tx_hash or "OK",
        )
        return row
