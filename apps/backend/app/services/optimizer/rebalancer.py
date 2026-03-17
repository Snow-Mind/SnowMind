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
from app.services.execution.session_key import (
    get_active_session_key,
    get_active_session_key_record,
    revoke_session_key,
)
from app.services.optimizer.milp_solver import (
    OptimizerInput,
    ProtocolInput,
    compute_weighted_apy,
    pick_best_protocol,
)
from app.services.optimizer.waterfall_allocator import waterfall_allocate
from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.optimizer.rate_validator import RateValidator, apply_max_move_cap
from app.services.fee_calculator import record_deposit, record_partial_withdrawal
from app.services.protocols import get_adapter
from app.services.protocols.base import get_shared_async_web3

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
            "aave_v3": self.settings.AAVE_V3_POOL,
            "benqi": self.settings.BENQI_POOL,
            "euler_v2": self.settings.EULER_VAULT,
        }
        if self.settings.SPARK_VAULT:
            self._protocol_addresses["spark"] = self.settings.SPARK_VAULT

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
          5. Run MILP solver
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
        spot_rates_raw = await self.rate_fetcher.fetch_active_rates()

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
                    tvl_usd=orig.tvl_usd,
                    utilization_rate=orig.utilization_rate,
                    fetched_at=orig.fetched_at,
                )

        if not twap_rates:
            return await self._log(db, account_id, "skipped",
                                   reason="No validated TWAP rates available")

        # 3. Build protocol inputs (risk scoring bypassed — protocols are pre-vetted whitelist)
        protocol_inputs: list[ProtocolInput] = []
        filtered_out: list[str] = []
        for pid, rate in twap_rates.items():
            if pid not in allowed_protocols:
                filtered_out.append(pid)
                continue
            protocol_inputs.append(
                ProtocolInput(
                    protocol_id=pid,
                    apy=rate.apy,
                    risk_score=Decimal("0"),
                )
            )

        if filtered_out:
            logger.info(
                "Session key for %s excludes protocols: %s",
                smart_account_address,
                ", ".join(sorted(filtered_out)),
            )

        if not protocol_inputs:
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

        # 5. Waterfall allocation: fill highest-APY protocols first, base layer as floor
        base_inp = OptimizerInput(
            total_amount_usd=total_usd,
            protocols=protocol_inputs,
            current_allocations=current,
            gas_cost_estimate_usd=Decimal(str(self.settings.GAS_COST_ESTIMATE_USD)),
        )

        tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in twap_rates.items()}

        logger.info(
            "Running waterfall allocator for %.2f USD across %d protocols",
            total_usd, len(protocol_inputs),
        )

        # If base layer is unavailable (circuit-breaker'd), fall back to pick_best_protocol
        base_available = any(
            p.protocol_id == self.settings.BASE_LAYER_PROTOCOL_ID
            for p in protocol_inputs
        )
        if base_available:
            result = waterfall_allocate(
                inp=base_inp,
                tvl_by_protocol=tvl_by_protocol,
                tvl_cap_pct=Decimal(str(self.settings.TVL_CAP_PCT)),
                max_exposure_pct=Decimal(str(self.settings.MAX_SINGLE_EXPOSURE_PCT)),
                base_beat_margin=Decimal(str(self.settings.BASE_BEAT_MARGIN)),
                base_layer_protocol_id=self.settings.BASE_LAYER_PROTOCOL_ID,
            )
        else:
            logger.warning("Base layer (%s) unavailable — falling back to pick_best_protocol",
                           self.settings.BASE_LAYER_PROTOCOL_ID)
            result = pick_best_protocol(base_inp)
        apy_by_protocol = {p.protocol_id: p.apy for p in protocol_inputs}
        ranked_protocols = [
            p.protocol_id
            for p in sorted(protocol_inputs, key=lambda p: p.apy, reverse=True)
        ]

        # 6. Check rebalance gate
        if not result.is_rebalance_needed:
            return await self._log(
                db, smart_account_address, "skipped",
                reason="Rebalance not worth it",
                proposed=result.allocations,
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
        if last.data:
            last_ts = datetime.fromisoformat(last.data[0]["created_at"])
            min_gap = timedelta(hours=self.settings.MIN_REBALANCE_INTERVAL_HOURS)
            if datetime.now(timezone.utc) - last_ts < min_gap:
                return await self._log(
                    db, smart_account_address, "skipped",
                    reason=f"Last rebalance too recent ({last_ts.isoformat()})",
                    proposed=result.allocations,
                )

        # 7b. Apply max move cap (30% of total per single rebalance)
        current_dec = current
        proposed_dec = result.allocations
        capped = apply_max_move_cap(current_dec, proposed_dec, total_usd)

        # 8. Execute
        try:
            tx_hash = await self.execute_rebalance(
                account_id=account_id,
                smart_account_address=smart_account_address,
                target_allocations=capped,
            )
        except ValueError as exc:
            # Non-retryable (e.g. invalid/revoked session key)
            logger.warning("Rebalance skipped for %s: %s", smart_account_address, exc)
            await self._log(db, account_id, "skipped",
                            reason=str(exc),
                            proposed=result.allocations)
            raise  # Let scheduler see ValueError as non-retryable
        except Exception as exc:
            logger.exception("Rebalance execution failed for %s", smart_account_address)

            # Initial deployment fallback: if top protocol fails, try next-best protocol
            # so idle USDC is still put to work.
            has_existing_positions = any(v > Decimal("1") for v in current.values())
            is_initial_deployment = (not has_existing_positions) and idle_usdc > Decimal("1")

            if is_initial_deployment and ranked_protocols:
                primary_protocol = max(result.allocations, key=result.allocations.get)
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
                    proposed=result.allocations,
                )

            return await self._log(db, account_id, "failed",
                                   reason=str(exc),
                                   proposed=result.allocations)

        if tx_hash is None:
            return await self._log(db, account_id, "skipped",
                                   reason="No concrete moves generated",
                                   proposed=result.allocations)

        # 9. Log success
        return await self._log(
            db, account_id, "executed",
            proposed=result.allocations,
            tx_hash=tx_hash,
            apr_improvement=result.expected_apy - compute_weighted_apy(
                current,
                apy_by_protocol,
            ),
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
                balance_wei = await adapter.get_user_balance(
                    smart_account_address, usdc,
                )
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
        payload = {
            "serializedPermission": serialized_permission,
            "smartAccountAddress": smart_account_address,
            "withdrawals": withdrawals,
            "deposits": deposits,
            "contracts": {
                "AAVE_POOL": self.settings.AAVE_V3_POOL,
                "BENQI_POOL": self.settings.BENQI_POOL,
                "EULER_VAULT": self.settings.EULER_VAULT,
                "SPARK_VAULT": self.settings.SPARK_VAULT,
                "USDC": self.settings.USDC_ADDRESS,
                "REGISTRY": self.settings.REGISTRY_CONTRACT_ADDRESS,
            },
        }
        if fee_transfer:
            payload["feeTransfer"] = fee_transfer
        if user_transfer:
            payload["userTransfer"] = user_transfer
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.settings.EXECUTION_SERVICE_URL}/execute-rebalance",
                json=payload,
                headers={"x-internal-key": self.settings.INTERNAL_SERVICE_KEY},
            )
            # Detect invalid session key errors and revoke so we don't retry forever
            if resp.status_code == 500:
                try:
                    body = resp.json()
                    err_msg = body.get("error", "")
                except Exception:
                    err_msg = resp.text
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
                    )
            resp.raise_for_status()
            result = resp.json()
            logger.info("Execution service returned: %s", result)
            return result["txHash"]

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
        for protocol_id, amount_usd in current.items():
            if amount_usd < Decimal("1"):
                continue
            entry: dict = {"protocol": protocol_id, "amountUSDC": "MAX"}
            if protocol_id == "benqi":
                adapter = get_adapter(protocol_id)
                qi_balance = await adapter.pool.functions.balanceOf(
                    self.w3.to_checksum_address(smart_account_address)
                ).call()
                entry["qiTokenAmount"] = str(qi_balance)
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

        # Resolve user's EOA address for the remaining USDC transfer
        acct = (
            db.table("accounts")
            .select("owner_address")
            .eq("id", account_id)
            .limit(1)
            .execute()
        )
        owner_eoa = acct.data[0]["owner_address"] if acct.data else None

        # Build user transfer payload (send remaining USDC to user's EOA)
        user_transfer = None
        if owner_eoa and fee_breakdown["net_withdrawal_usd"] > Decimal("0.01"):
            user_transfer = {
                "to": owner_eoa,
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
