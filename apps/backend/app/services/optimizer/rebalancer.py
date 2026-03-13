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
    revoke_session_key,
)
from app.services.optimizer.milp_solver import (
    DIVERSIFICATION_CONFIGS,
    SPLIT_THRESHOLD,
    OptimizerInput,
    ProtocolInput,
    compute_delta,
    compute_weighted_apy,
    pick_best_protocol,
    solve,
)
from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.optimizer.rate_validator import RateValidator, apply_max_move_cap
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

REGISTRY_ABI = [
    {
        "name": "logRebalance",
        "type": "function",
        "inputs": [
            {"name": "fromProtocol", "type": "address"},
            {"name": "toProtocol", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
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
        session_key = get_active_session_key(db, UUID(account_id))
        if not session_key:
            logger.debug("No active session key for %s — skipping", account_id)
            return await self._log(db, account_id, "skipped",
                                   reason="No active session key")

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
        for pid, rate in twap_rates.items():
            protocol_inputs.append(
                ProtocolInput(
                    protocol_id=pid,
                    apy=rate.apy,
                    risk_score=Decimal("0"),
                )
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

        # 5. Two-tier routing: simple mode for small deposits, MILP for large
        base_inp = OptimizerInput(
            total_amount_usd=total_usd,
            protocols=protocol_inputs,
            current_allocations=current,
        )

        if total_usd < SPLIT_THRESHOLD:
            # Simple mode — always single best protocol under $10 K
            logger.info(
                "Simple mode (%.2f < %.2f): picking best protocol",
                total_usd, float(SPLIT_THRESHOLD),
            )
            result = pick_best_protocol(base_inp)
        else:
            # MILP mode — read user's diversification preference from DB
            pref_row = (
                db.table("accounts")
                .select("diversification_preference")
                .eq("id", account_id)
                .execute()
            )
            pref = (
                (pref_row.data[0].get("diversification_preference") or "balanced")
                if pref_row.data
                else "balanced"
            )
            config = DIVERSIFICATION_CONFIGS.get(pref, DIVERSIFICATION_CONFIGS["balanced"])
            logger.info(
                "MILP mode (%.2f >= %.2f): pref=%s, max_protocols=%d",
                total_usd, float(SPLIT_THRESHOLD), pref, config["max_protocols"],
            )
            # Apply per-protocol allocation cap from diversification config
            for p in base_inp.protocols:
                p.max_allocation_pct = config["max_allocation_pct"]

            if config["max_protocols"] == 1:
                result = pick_best_protocol(base_inp)
            else:
                base_inp.max_protocols = config["max_protocols"]
                base_inp.min_protocols = min(2, len(base_inp.protocols))
                result = solve(base_inp)

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
                {p.protocol_id: p.apy for p in protocol_inputs},
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
    ) -> str:
        """Call the Node.js execution service to execute via ZeroDev."""
        payload = {
            "serializedPermission": serialized_permission,
            "smartAccountAddress": smart_account_address,
            "withdrawals": withdrawals,
            "deposits": deposits,
            "contracts": {
                "AAVE_POOL": self.settings.AAVE_V3_POOL,
                "BENQI_POOL": self.settings.BENQI_POOL,
                "USDC": self.settings.USDC_ADDRESS,
                "REGISTRY": self.settings.REGISTRY_CONTRACT_ADDRESS,
            },
        }
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
                if "serializedSessionKey" in err_msg or "No signer" in err_msg:
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

    # â”€â”€ Emergency withdrawal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async def execute_emergency_withdrawal(
        self,
        account_id: str,
        smart_account_address: str,
    ) -> str:
        """
        Emergency: withdraw ALL positions across every protocol in a single tx.
        Revokes session keys after execution.

        - Backend path: revoke + withdraw all in one tx if possible.
        - Frontend path: user can do this directly via their EOA (MetaMask).
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

        tx_hash = await self._call_execution_service(
            serialized_permission=session_key,
            smart_account_address=smart_account_address,
            withdrawals=exec_withdrawals,
            deposits=[],
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
            "Emergency withdrawal executed for %s: tx=%s",
            smart_account_address, tx_hash,
        )
        return tx_hash

    # â”€â”€ Registry log encoding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _encode_registry_log(
        self,
        from_protocol_address: str,
        to_protocol_address: str,
        amount_wei: int,
    ) -> dict:
        """Encode a logRebalance call for the SnowMindRegistry contract."""
        registry = Web3().eth.contract(abi=REGISTRY_ABI)
        log_calldata = registry.encode_abi(
            "logRebalance",
            args=[
                Web3.to_checksum_address(from_protocol_address),
                Web3.to_checksum_address(to_protocol_address),
                amount_wei,
            ],
        )
        return {
            "to": self.settings.REGISTRY_CONTRACT_ADDRESS,
            "data": log_calldata,
            "value": 0,
        }

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
