"""Cost-aware rebalance orchestrator â€” full pipeline from rates to on-chain execution.

Transaction ordering: withdrawals FIRST, then deposits (ensure funds are available).
"""

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import httpx
from web3 import Web3

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.execution.executor import ExecutionService
from app.services.execution.session_key import (
    get_active_session_key,
    get_active_session_key_record,
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
from app.services.fee_calculator import record_deposit, record_partial_withdrawal
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

    async def _get_idle_usdc_balance(self, smart_account_address: str) -> Decimal:
        """Read the on-chain USDC balance sitting idle in the smart account."""
        try:
            usdc_contract = self.w3.eth.contract(
                address=self.w3.to_checksum_address(self.settings.USDC_ADDRESS),
                abi=ERC20_BALANCE_ABI,
            )
            balance_wei = await usdc_contract.functions.balanceOf(
                self.w3.to_checksum_address(smart_account_address)
            ).call()
            return Decimal(str(balance_wei)) / Decimal("1000000")
        except Exception as exc:
            logger.warning("Failed to read idle USDC for %s: %s", smart_account_address, exc)
            return Decimal("0")

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
                adapter = get_adapter(pid)
                if adapter is None:
                    continue
                balance_wei = await adapter.get_balance(smart_account_address)
                balance_usd = Decimal(str(balance_wei)) / Decimal("1000000")
                if balance_usd > Decimal("0.50"):
                    discovered[pid] = balance_usd
            except Exception as exc:
                logger.debug("On-chain balance check for %s/%s failed: %s", smart_account_address, pid, exc)
        return discovered

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
          7. Check time since last rebalance (> 6 h)
          8. If all conditions met â†’ execute
          9. Log result regardless
         10. Return log dict
        """
        db = get_supabase()

        # 0. Early session-key check — skip expensive pipeline if no key
        session_key_record = get_active_session_key_record(db, UUID(account_id))
        if not session_key_record:
            logger.debug("No active session key for %s — skipping", account_id)
            return await self._log(db, account_id, "skipped",
                                   reason="No active session key")

        allowed_protocols = set(session_key_record["allowed_protocols"])

        # 1. Fetch live spot rates
        spot_rates_raw = await self.rate_fetcher.fetch_all_rates()

        if not spot_rates_raw:
            return await self._log(db, account_id, "skipped",
                                   reason="No spot rates available")

        # 2. Validate with TWAP + DefiLlama + velocity check
        spot_rates = {pid: rate.apy for pid, rate in spot_rates_raw.items()}
        validated_rates = await self.rate_validator.validate_all(spot_rates)
        if validated_rates is None:
            return await self._log(db, account_id, "skipped",
                                   reason="Rate validation failed (sanity/velocity/DefiLlama)")

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

        # 4. Get current allocations from DB + on-chain idle USDC
        alloc_rows = (
            db.table("allocations")
            .select("protocol_id, amount_usdc")
            .eq("account_id", account_id)
            .execute()
        )
        current: dict[str, Decimal] = {}
        total_usd = Decimal("0")
        for row in alloc_rows.data:
            amt = Decimal(str(row["amount_usdc"]))
            current[row["protocol_id"]] = amt
            total_usd += amt

        # 4a. On-chain balance discovery — if allocations table is empty,
        # scan all enabled protocols for existing positions. This handles
        # the case where the frontend deployed funds directly but the
        # allocation was never recorded in the DB.
        if not current:
            discovered = await self._discover_onchain_balances(
                smart_account_address, set(allowed_rates.keys()),
            )
            if discovered:
                logger.info(
                    "Discovered on-chain positions for %s (not in DB): %s",
                    smart_account_address,
                    {pid: f"${float(amt):.2f}" for pid, amt in discovered.items()},
                )
                # Sync discovered positions to DB
                for pid, amt in discovered.items():
                    try:
                        db.table("allocations").upsert(
                            {
                                "account_id": account_id,
                                "protocol_id": pid,
                                "amount_usdc": str(amt.quantize(Decimal("0.000001"))),
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

        # 4b. Guarded launch — enforce platform-wide deposit cap
        has_existing_positions = any(v > Decimal("1") for v in current.values())
        if not has_existing_positions and idle_usdc > Decimal("1"):
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

            # Record the deposit for fee tracking (initial deployment)
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
            return Decimal(str(self.settings.TVL_CAP_PCT)) * tvl

        # ── 5b. Check health of CURRENT positions ONLY ──────────────
        health_results: dict[str, HealthCheckResult] = {}
        unhealthy_positions: list[str] = []

        for pid, position_amt in current.items():
            if position_amt < Decimal("1"):
                continue
            if pid not in allowed_rates:
                # Session key no longer covers this protocol → forced exit
                logger.warning(
                    "FORCED EXIT: position $%.2f in %s but protocol not in "
                    "allowed rates — forcing withdrawal",
                    float(position_amt), pid,
                )
                unhealthy_positions.append(pid)
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
            if remaining_to_allocate <= Decimal("0"):
                break  # Enough healthy capacity found
            if pid in health_results:
                continue  # Already checked (current position)

            # Health-check this ONE candidate (targeted, not blanket)
            hr = await _check_one(pid, Decimal("0"))
            health_results[pid] = hr

            if hr.is_deposit_safe:
                remaining_to_allocate -= min(
                    remaining_to_allocate, _estimate_capacity(pid)
                )
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
            if hr.flag == RebalanceFlag.EMERGENCY_EXIT:
                global_flag = RebalanceFlag.EMERGENCY_EXIT
                break
            if hr.flag == RebalanceFlag.FORCED_REBALANCE:
                global_flag = RebalanceFlag.FORCED_REBALANCE

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

        allocation_result = compute_allocation(
            health_results=health_results,
            twap_apys=apy_by_protocol,
            protocol_tvls=tvl_by_protocol,
            total_balance=total_usd,
            user_preferences={
                pid: UserPreference(protocol_id=pid, enabled=True, max_pct=None)
                for pid in allowed_rates
            },
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
        has_existing_protocol_positions = any(v > Decimal("1") for v in current.values())
        is_initial_deployment = not has_existing_protocol_positions and idle_usdc > Decimal("0.01")

        if global_flag == RebalanceFlag.NONE and not is_initial_deployment and apy_improvement < Decimal(str(self.settings.BEAT_MARGIN)):
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
        if last.data and global_flag == RebalanceFlag.NONE:
            last_ts = datetime.fromisoformat(last.data[0]["created_at"])
            min_gap = timedelta(hours=self.settings.MIN_REBALANCE_INTERVAL_HOURS)
            if datetime.now(timezone.utc) - last_ts < min_gap:
                return await self._log(
                    db, account_id, "skipped",
                    reason=f"Last rebalance too recent ({last_ts.isoformat()})",
                    proposed=result_allocations,
                )

        # 8. Delta check — skip if total movement is below $1 (bypassed by FORCED/EMERGENCY)
        all_protocols = set(current.keys()) | set(result_allocations.keys())
        total_movement = sum(
            abs(result_allocations.get(pid, Decimal("0")) - current.get(pid, Decimal("0")))
            for pid in all_protocols
        ) / Decimal("2")
        if global_flag == RebalanceFlag.NONE and total_movement < Decimal("1"):
            return await self._log(
                db,
                account_id,
                "skipped",
                reason="Total movement below $1",
                proposed=result_allocations,
            )

        # 8b. Profitability gate — skip if daily gain does not cover gas + fees
        #     Bypass for initial deployments: idle USDC at 0% → any protocol is
        #     better than idle regardless of deposit size. Gas is paymaster-sponsored.
        #     (is_initial_deployment computed above at step 6)
        if global_flag == RebalanceFlag.NONE and total_usd > 0 and not is_initial_deployment:
            daily_gain = apy_improvement * total_usd / Decimal("365")
            gas_cost = Decimal(str(self.settings.GAS_COST_ESTIMATE_USD))
            if daily_gain < gas_cost:
                return await self._log(
                    db,
                    account_id,
                    "skipped",
                    reason=f"Profitability gate: daily gain ${float(daily_gain):.4f} < gas ${float(gas_cost):.4f}",
                    proposed=result_allocations,
                )

        # 9. Execute
        try:
            tx_hash = await self.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account_address,
                target_allocations=result_allocations,
            )
        except ValueError as exc:
            # Non-retryable (e.g. invalid/revoked session key)
            logger.warning("Rebalance skipped for %s: %s", smart_account_address, exc)
            await self._log(db, account_id, "skipped",
                            reason=str(exc),
                            proposed=result_allocations)
            raise  # Let scheduler see ValueError as non-retryable
        except Exception as exc:
            logger.exception("Rebalance execution failed for %s", smart_account_address)

            # Initial deployment fallback: if top protocol fails, try next-best protocol
            # so idle USDC is still put to work.
            has_existing_positions = any(v > Decimal("1") for v in current.values())
            is_initial_deployment = (not has_existing_positions) and idle_usdc > Decimal("1")

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
                        tx_hash = await self.execute_rebalance(
                            account_id=account_id,
                            smart_account_address=smart_account_address,
                            target_allocations=fallback_target,
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
                if abs(balance_usd - current[pid]) > Decimal("1"):
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
                fee_transfer=fee_transfer,
                user_transfer=user_transfer,
            )
            logger.info("Execution service returned: %s", result)
            return result["txHash"]
        except httpx.HTTPStatusError as exc:
            # Detect invalid session key errors and revoke so we don't retry forever.
            err_msg = ""
            if exc.response is not None:
                try:
                    err_msg = exc.response.json().get("error", "")
                except Exception:
                    err_msg = exc.response.text

            if (
                "serializedSessionKey" in err_msg
                or "No signer" in err_msg
                or "Session key/account mismatch" in err_msg
                or "EnableNotApproved" in err_msg
                or "validateUserOp" in err_msg
            ):
                logger.warning(
                    "Invalid session key for %s — revoking",
                    smart_account_address,
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

        for protocol_id, target_usd in target_allocations.items():
            current_usd = current.get(protocol_id, Decimal("0"))
            delta = target_usd - current_usd
            if delta < Decimal("-1"):
                withdrawals.append((protocol_id, abs(delta)))
            elif delta > Decimal("1"):
                deposits.append((protocol_id, delta))

        # Check for protocols being fully exited (in current but not in target)
        for protocol_id, current_usd in current.items():
            if protocol_id not in target_allocations and current_usd > Decimal("1"):
                withdrawals.append((protocol_id, current_usd))

        if not withdrawals and not deposits:
            return None

        # Step 3: Get session key and call execution service
        session_key = get_active_session_key(db, UUID(account_id))
        if not session_key:
            raise ValueError(f"No active session key for account {account_id}")

        # Build withdrawal/deposit instructions for the Node.js execution service
        exec_withdrawals = []
        for protocol_id, amount_usd in withdrawals:
            entry: dict = {"protocol": protocol_id, "amountUSDC": float(amount_usd)}
            if protocol_id == "benqi":
                adapter = get_adapter(protocol_id)
                amount_wei = int(Decimal(str(amount_usd)) * Decimal("1e6"))
                qi_amount = await adapter.usdc_to_qi_tokens(amount_wei)
                entry["qiTokenAmount"] = str(qi_amount)
            exec_withdrawals.append(entry)

        exec_deposits = [
            {"protocol": pid, "amountUSDC": float(amt)}
            for pid, amt in deposits
        ]

        tx_hash = await self._call_execution_service(
            serialized_permission=session_key,
            smart_account_address=smart_account_address,
            withdrawals=exec_withdrawals,
            deposits=exec_deposits,
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

        session_key = get_active_session_key(db, UUID(account_id))
        if not session_key:
            raise ValueError(f"No active session key for account {account_id}")

        # Build withdrawal instruction
        entry: dict = {"protocol": protocol_id, "amountUSDC": float(amount)}
        if protocol_id == "benqi":
            adapter = get_adapter(protocol_id)
            amount_wei = int(amount * Decimal("1e6"))
            qi_amount = await adapter.usdc_to_qi_tokens(amount_wei)
            entry["qiTokenAmount"] = str(qi_amount)

        tx_hash = await self._call_execution_service(
            serialized_permission=session_key,
            smart_account_address=smart_account_address,
            withdrawals=[entry],
            deposits=[],
            account_id=account_id,
        )

        # Track the partial withdrawal for fee calculation
        record_partial_withdrawal(db, account_id, amount)

        # Update allocations in DB: reduce the protocol allocation
        current = await self._get_current_allocations(account_id, smart_account_address)
        current_amt = current.get(protocol_id, Decimal("0"))
        new_amt = max(current_amt - amount, Decimal("0"))
        if new_amt < Decimal("1"):
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
        Includes 10% profit fee transfer to treasury in the same atomic batch.
        Revokes session keys after execution.

        Returns (tx_hash, fee_breakdown).
        """
        db = get_supabase()
        current = await self._get_current_allocations(account_id, smart_account_address)

        exec_withdrawals = []
        _ERC4626_PROTOCOLS = frozenset(("spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"))
        for protocol_id, amount_usd in current.items():
            if amount_usd < Decimal("1"):
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

        # Calculate 10% profit fee
        current_value = sum(current.values())
        idle_usdc = await self._get_idle_usdc_balance(smart_account_address)
        total_value = current_value + idle_usdc

        from app.services.fee_calculator import (
            calculate_withdrawal_fee,
            get_yield_tracking,
            record_withdrawal_fee,
        )

        yield_info = get_yield_tracking(db, account_id)
        fee_breakdown = calculate_withdrawal_fee(
            current_value_usd=total_value,
            total_deposited_usdc=Decimal(str(yield_info["total_deposited_usdc"])) if yield_info else total_value,
            total_withdrawn_usdc=Decimal(str(yield_info["total_withdrawn_usdc"])) if yield_info else Decimal("0"),
        )

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

        # Build user transfer payload (receiver resolved on-chain by execution service).
        user_transfer = None
        if fee_breakdown["net_withdrawal_usd"] > Decimal("0.01"):
            user_transfer = {
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

        # Record fee in DB
        if fee_breakdown["fee_usd"] > Decimal("0"):
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
            if amt > Decimal("1")
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
