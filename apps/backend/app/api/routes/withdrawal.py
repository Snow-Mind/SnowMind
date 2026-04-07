"""
Withdrawal API routes — partial and full withdrawal flows.

Implements atomic UserOp construction for withdrawals. Agent fee plumbing is
kept in place but currently disabled behind configuration.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import require_privy_auth, verify_account_ownership
from app.core.validators import validate_eth_address
from app.services.fee_calculator import (
    FeeCalculation,
    calculate_agent_fee,
    get_yield_tracking,
    record_withdrawal,
)
from app.services.execution.session_key import get_active_session_key, get_active_session_key_record, revoke_session_key
from app.services.execution.executor import ExecutionService
from app.services.protocols import ACTIVE_ADAPTERS, get_adapter
from app.services.protocols.base import get_shared_async_web3

logger = logging.getLogger("snowmind.api.withdrawal")

router = APIRouter()

# Minimum requestable withdrawal: 1 micro-USDC
_MIN_WITHDRAWAL_REQUEST_USDC = Decimal("0.000001")
# Treat tiny remainder as full withdrawal to avoid stranded dust state
_FULL_WITHDRAWAL_DUST_USDC = Decimal("0.01")
# Maximum withdrawal: $10M (sanity guard)
_MAX_WITHDRAWAL_USDC = Decimal("10000000")
_WITHDRAW_SIGNATURE_TTL_SECONDS = 300

_ERC20_BALANCE_OF_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]


# ── Request / Response Models ────────────────────────────────────────────────

class WithdrawalPreviewRequest(BaseModel):
    """Request body for withdrawal fee preview."""
    smart_account_address: str = Field(..., alias="smartAccountAddress")
    withdraw_amount: str = Field(..., alias="withdrawAmount", description="USDC amount to withdraw (6 decimal string)")
    is_full_withdrawal: bool = Field(False, alias="isFullWithdrawal")
    model_config = {"populate_by_name": True}

    @field_validator("withdraw_amount")
    @classmethod
    def validate_withdraw_amount(cls, v: str) -> str:
        try:
            amt = Decimal(v)
        except Exception:
            raise ValueError("withdraw_amount must be a valid decimal string")
        if amt < _MIN_WITHDRAWAL_REQUEST_USDC:
            raise ValueError(f"withdraw_amount below minimum (${_MIN_WITHDRAWAL_REQUEST_USDC})")
        if amt > _MAX_WITHDRAWAL_USDC:
            raise ValueError(f"withdraw_amount exceeds maximum (${_MAX_WITHDRAWAL_USDC})")
        # Validate USDC precision (max 6 decimal places)
        if amt != amt.quantize(Decimal("0.000001")):
            raise ValueError("withdraw_amount exceeds USDC precision (max 6 decimals)")
        return v


class WithdrawalPreviewResponse(BaseModel):
    """Fee breakdown before user confirms withdrawal."""
    withdraw_amount: str = Field(..., alias="withdrawAmount")
    current_balance: str = Field(..., alias="currentBalance")
    net_principal: str = Field(..., alias="netPrincipal")
    accrued_profit: str = Field(..., alias="accruedProfit")
    attributable_profit: str = Field(..., alias="attributableProfit")
    agent_fee: str = Field(..., alias="agentFee")
    user_receives: str = Field(..., alias="userReceives")
    fee_rate: str = Field(..., alias="feeRate")
    fee_exempt: bool = Field(..., alias="feeExempt")
    model_config = {"populate_by_name": True}


class WithdrawalExecuteRequest(BaseModel):
    """Request body to execute a withdrawal."""
    smart_account_address: str = Field(..., alias="smartAccountAddress")
    withdraw_amount: str = Field(..., alias="withdrawAmount")
    is_full_withdrawal: bool = Field(False, alias="isFullWithdrawal")
    owner_signature: str | None = Field(None, alias="ownerSignature")
    signature_message: str | None = Field(None, alias="signatureMessage")
    signature_timestamp: int | None = Field(None, alias="signatureTimestamp")
    model_config = {"populate_by_name": True}

    @field_validator("withdraw_amount")
    @classmethod
    def validate_withdraw_amount(cls, v: str) -> str:
        try:
            amt = Decimal(v)
        except Exception:
            raise ValueError("withdraw_amount must be a valid decimal string")
        if amt < _MIN_WITHDRAWAL_REQUEST_USDC:
            raise ValueError(f"withdraw_amount below minimum (${_MIN_WITHDRAWAL_REQUEST_USDC})")
        if amt > _MAX_WITHDRAWAL_USDC:
            raise ValueError(f"withdraw_amount exceeds maximum (${_MAX_WITHDRAWAL_USDC})")
        # Validate USDC precision (max 6 decimal places)
        if amt != amt.quantize(Decimal("0.000001")):
            raise ValueError("withdraw_amount exceeds USDC precision (max 6 decimals)")
        return v


class WithdrawalExecuteResponse(BaseModel):
    """Response after withdrawal is submitted."""
    status: str
    tx_hash: str | None = Field(None, alias="txHash")
    agent_fee: str = Field(..., alias="agentFee")
    user_receives: str = Field(..., alias="userReceives")
    account_deactivated: bool = Field(..., alias="accountDeactivated")
    message: str
    model_config = {"populate_by_name": True}


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_account(db: Client, address: str) -> dict:
    """Fetch account record by smart account address."""
    result = (
        db.table("accounts")
        .select("*")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Account not found")
    return result.data[0]


async def _get_on_chain_balance(smart_account: str) -> Decimal:
    """
    Read total on-chain balance across all protocols.

    Uses protocol adapters for accurate balance reading.
    """
    total_raw = 0
    failed_protocols: list[str] = []

    for pid, adapter in ACTIVE_ADAPTERS.items():
        try:
            balance = await adapter.get_balance(smart_account)
            total_raw += int(balance)
        except Exception as exc:
            failed_protocols.append(pid)
            logger.warning(
                "Failed to read %s balance for %s: %s",
                pid,
                smart_account,
                exc,
            )

    # Include idle USDC held directly in the smart account so full-withdrawal
    # previews/executions represent the actual amount user can receive.
    try:
        settings = get_settings()
        w3 = get_shared_async_web3()
        usdc = w3.eth.contract(
            address=w3.to_checksum_address(settings.USDC_ADDRESS),
            abi=_ERC20_BALANCE_OF_ABI,
        )
        idle_raw = await usdc.functions.balanceOf(
            w3.to_checksum_address(smart_account)
        ).call()
        total_raw += int(idle_raw)
    except Exception as exc:
        logger.warning("Failed to read idle USDC balance for %s: %s", smart_account, exc)
        raise HTTPException(
            status_code=503,
            detail="Unable to read idle USDC balance. Please retry shortly.",
        )

    # Fail safe: do not compute fees from partial balances.
    if failed_protocols:
        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to read balances for all active protocols "
                f"({', '.join(sorted(failed_protocols))}). Please retry shortly."
            ),
        )

    return Decimal(str(total_raw)) / Decimal("1e6")


def _compute_fee(
    withdraw_amount_usdc: Decimal,
    current_balance_usdc: Decimal,
    account: dict,
    yield_tracking: dict | None,
) -> FeeCalculation:
    """Compute withdrawal quote using yield tracking data.

    Fee code remains available for future re-enable, but current policy freezes
    fee charging (``AGENT_FEE_ENABLED=False``) so users receive full amount.
    """
    # Net principal = cumulative_deposited - cumulative_net_withdrawn
    if yield_tracking:
        cumulative_deposited = Decimal(str(yield_tracking.get("cumulative_deposited", "0")))
        cumulative_withdrawn = Decimal(str(yield_tracking.get("cumulative_net_withdrawn", "0")))
        net_principal = cumulative_deposited - cumulative_withdrawn
    else:
        # No tracking record — assume all is principal (no profit, no fee)
        net_principal = current_balance_usdc

    settings = get_settings()
    fee_exempt = account.get("fee_exempt", False) or (not settings.AGENT_FEE_ENABLED)

    return calculate_agent_fee(
        withdraw_amount=withdraw_amount_usdc,
        current_balance=current_balance_usdc,
        net_principal=net_principal,
        fee_exempt=fee_exempt,
        fee_rate=Decimal("0") if not settings.AGENT_FEE_ENABLED else None,
    )


def _resolve_withdrawal_intent(
    requested_amount_usdc: Decimal,
    current_balance_usdc: Decimal,
    requested_full_withdrawal: bool,
) -> tuple[Decimal, bool]:
    """Normalize withdrawal intent and infer full-withdrawal for dust remainders.

    If the user leaves at most dust behind, treat it as a full withdrawal so the
    account lifecycle (session-key revocation and deactivation) stays consistent.
    """
    if requested_full_withdrawal:
        return current_balance_usdc, True

    # Frontend snapshots can be stale by a few micros; normalize to full
    # withdrawal when the user request is at/above current balance.
    if requested_amount_usdc >= current_balance_usdc:
        return current_balance_usdc, True

    remaining = current_balance_usdc - requested_amount_usdc
    if remaining <= _FULL_WITHDRAWAL_DUST_USDC:
        return current_balance_usdc, True

    return requested_amount_usdc, False


def _to_raw_usdc(amount_usdc: Decimal) -> int:
    """Convert 6-decimal USDC amount to integer raw units exactly."""
    normalized = amount_usdc.quantize(Decimal("0.000001"))
    return int((normalized * Decimal("1e6")).to_integral_exact())


def _ensure_withdrawal_quote_within_onchain_balance(
    fee_calc: FeeCalculation,
    current_balance_usdc: Decimal,
    account: dict,
    yield_tracking: dict | None,
) -> FeeCalculation:
    """Ensure quoted fee + user transfer do not exceed current on-chain balance.

    Decimal math is exact, but micro-unit quantization can still produce tiny
    edge drifts in rare cases. Recompute once using the on-chain max if needed.
    """
    onchain_balance_raw = _to_raw_usdc(current_balance_usdc)
    normalized = fee_calc

    for attempt in range(2):
        user_raw = _to_raw_usdc(normalized.user_receives)
        fee_raw = _to_raw_usdc(normalized.agent_fee)

        if user_raw <= 0:
            raise HTTPException(
                status_code=400,
                detail="Net withdrawal amount rounds to zero after fees",
            )

        total_out_raw = user_raw + fee_raw
        if total_out_raw <= onchain_balance_raw:
            return normalized

        if attempt == 0:
            logger.warning(
                "Withdrawal quote exceeded on-chain balance for %s by %s microUSDC; recomputing",
                account.get("address", "unknown"),
                total_out_raw - onchain_balance_raw,
            )
            max_withdrawable = Decimal(onchain_balance_raw) / Decimal("1e6")
            normalized = _compute_fee(
                withdraw_amount_usdc=max_withdrawable,
                current_balance_usdc=current_balance_usdc,
                account=account,
                yield_tracking=yield_tracking,
            )
            continue

        raise HTTPException(
            status_code=503,
            detail="Unable to build a safe withdrawal quote from on-chain balance. Please retry.",
        )

    return normalized


def _build_withdrawal_authorization_message(
    *,
    smart_account_address: str,
    owner_address: str,
    withdraw_amount_raw: int,
    is_full_withdrawal: bool,
    signature_timestamp: int,
) -> str:
    return "\n".join([
        "SnowMind Withdrawal Authorization",
        f"Smart Account: {smart_account_address.lower()}",
        f"Owner: {owner_address.lower()}",
        f"Withdraw Amount (microUSDC): {withdraw_amount_raw}",
        f"Full Withdrawal: {'true' if is_full_withdrawal else 'false'}",
        "Chain ID: 43114",
        f"Timestamp: {signature_timestamp}",
    ])


def _verify_withdrawal_authorization(req: WithdrawalExecuteRequest, account: dict) -> None:
    """Require a fresh owner wallet signature before executing a withdrawal."""
    owner_address_raw = str(account.get("owner_address") or "").strip()
    if not owner_address_raw:
        raise HTTPException(status_code=400, detail="Account owner address missing")

    owner_signature = (req.owner_signature or "").strip()
    signature_message = (req.signature_message or "").strip()
    signature_timestamp = req.signature_timestamp

    if not owner_signature or not signature_message or signature_timestamp is None:
        raise HTTPException(
            status_code=400,
            detail="Withdrawal authorization signature is required",
        )

    now_ts = int(datetime.now(timezone.utc).timestamp())
    if abs(now_ts - int(signature_timestamp)) > _WITHDRAW_SIGNATURE_TTL_SECONDS:
        raise HTTPException(
            status_code=401,
            detail="Withdrawal authorization expired. Please sign again.",
        )

    withdraw_amount_raw = int((Decimal(req.withdraw_amount) * Decimal("1e6")))
    expected_message = _build_withdrawal_authorization_message(
        smart_account_address=req.smart_account_address,
        owner_address=owner_address_raw,
        withdraw_amount_raw=withdraw_amount_raw,
        is_full_withdrawal=req.is_full_withdrawal,
        signature_timestamp=int(signature_timestamp),
    )

    if signature_message != expected_message:
        raise HTTPException(status_code=400, detail="Withdrawal authorization payload mismatch")

    try:
        recovered = Account.recover_message(
            encode_defunct(text=expected_message),
            signature=owner_signature,
        )
    except Exception as exc:
        logger.warning("Invalid withdrawal signature for %s: %s", req.smart_account_address, exc)
        raise HTTPException(status_code=400, detail="Invalid withdrawal signature")

    if recovered.lower() != owner_address_raw.lower():
        raise HTTPException(
            status_code=403,
            detail="Withdrawal signature does not match account owner",
        )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/preview", response_model=WithdrawalPreviewResponse)
async def preview_withdrawal(
    request: Request,
    req: WithdrawalPreviewRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """
    Preview withdrawal fees without executing.

    Returns the fee breakdown so the user can confirm before proceeding.
    Shows "Agent fee: Free (beta)" for fee-exempt accounts.
    """
    address = validate_eth_address(req.smart_account_address)
    account = await _get_account(db, address)
    verify_account_ownership(_auth, account, db=db)

    # Read on-chain balance
    current_balance = await _get_on_chain_balance(address)
    if current_balance <= Decimal("0"):
        raise HTTPException(
            status_code=400,
            detail="No balance to withdraw",
        )

    # Determine withdrawal amount
    requested_withdraw_amount = Decimal(req.withdraw_amount)
    withdraw_amount, effective_full_withdrawal = _resolve_withdrawal_intent(
        requested_withdraw_amount,
        current_balance,
        req.is_full_withdrawal,
    )

    if withdraw_amount > current_balance:
        raise HTTPException(
            status_code=400,
            detail=f"Withdrawal amount ({withdraw_amount}) exceeds balance ({current_balance})",
        )

    # Compute fee
    yield_tracking = get_yield_tracking(db, account["id"])
    fee_calc = _compute_fee(withdraw_amount, current_balance, account, yield_tracking)
    fee_calc = _ensure_withdrawal_quote_within_onchain_balance(
        fee_calc,
        current_balance,
        account,
        yield_tracking,
    )

    return WithdrawalPreviewResponse(
        withdrawAmount=str(fee_calc.withdraw_amount),
        currentBalance=str(fee_calc.current_balance),
        netPrincipal=str(fee_calc.net_principal),
        accruedProfit=str(fee_calc.accrued_profit),
        attributableProfit=str(fee_calc.attributable_profit),
        agentFee=str(fee_calc.agent_fee),
        userReceives=str(fee_calc.user_receives),
        feeRate=str(fee_calc.fee_rate),
        feeExempt=fee_calc.fee_exempt,
    )


@router.post("/execute", response_model=WithdrawalExecuteResponse)
async def execute_withdrawal(
    request: Request,
    req: WithdrawalExecuteRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """
    Execute a withdrawal (partial or full).

    Builds an atomic UserOperation that:
      1. Withdraws from all protocols
      2. Transfers agent fee to treasury (if any)
      3. Sweeps remaining USDC to user's EOA (MaxUint256)

    All calls are batched in one UserOp — if any fails, all revert.
    """
    settings = get_settings()
    address = validate_eth_address(req.smart_account_address)
    account = await _get_account(db, address)
    verify_account_ownership(_auth, account, db=db)
    _verify_withdrawal_authorization(req, account)

    # ── Treasury address guard ──────────────────────────────────────────
    # Fee collection is currently disabled; keep this guard for when fees are
    # re-enabled so misconfiguration cannot silently route funds incorrectly.
    if settings.AGENT_FEE_ENABLED:
        if not settings.TREASURY_ADDRESS or settings.TREASURY_ADDRESS == "0x" + "0" * 40:
            raise HTTPException(
                status_code=500,
                detail="Treasury address not configured — withdrawals disabled",
            )

    # ── Concurrent withdrawal lock ──────────────────────────────────────
    # Prevent double-submit: one in-flight withdrawal per account at a time.
    lock_key = f"withdrawal_lock:{account['id']}"
    try:
        lock_result = (
            db.table("rebalance_logs")
            .select("id, status")
            .eq("account_id", account["id"])
            .eq("from_protocol", "withdrawal")
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if lock_result.data:
            raise HTTPException(
                status_code=409,
                detail="A withdrawal is already in progress for this account. Please wait.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Lock check failed for %s: %s — proceeding", address, exc)

    # Read on-chain balance
    current_balance = await _get_on_chain_balance(address)
    if current_balance <= Decimal("0"):
        raise HTTPException(status_code=400, detail="No balance to withdraw")

    # Determine withdrawal amount
    requested_withdraw_amount = Decimal(req.withdraw_amount)
    withdraw_amount, effective_full_withdrawal = _resolve_withdrawal_intent(
        requested_withdraw_amount,
        current_balance,
        req.is_full_withdrawal,
    )

    if withdraw_amount > current_balance:
        raise HTTPException(
            status_code=400,
            detail="Withdrawal amount exceeds balance",
        )

    # Compute fee
    yield_tracking = get_yield_tracking(db, account["id"])
    fee_calc = _compute_fee(withdraw_amount, current_balance, account, yield_tracking)
    fee_calc = _ensure_withdrawal_quote_within_onchain_balance(
        fee_calc,
        current_balance,
        account,
        yield_tracking,
    )

    # Build and submit withdrawal UserOp via Execution Service
    try:
        session_record = get_active_session_key_record(db, UUID(account["id"]))
        if not session_record:
            raise HTTPException(
                status_code=400,
                detail="No active session key for account",
            )
        session_key = session_record["serialized_permission"]
        session_private_key = session_record.get("session_private_key", "")

        benqi_qi_balance = 0
        spark_share_balance = 0
        euler_share_balance = 0
        aave_atoken_balance = 0
        try:
            aave_adapter = get_adapter("aave_v3")
            aave_atoken_balance = int(await aave_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Aave aToken balance for %s: %s", address, exc)
        try:
            benqi_adapter = get_adapter("benqi")
            benqi_qi_balance = int(await benqi_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Benqi share balance for %s: %s", address, exc)
        try:
            spark_adapter = get_adapter("spark")
            spark_share_balance = int(await spark_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Spark share balance for %s: %s", address, exc)
        try:
            euler_adapter = get_adapter("euler_v2")
            euler_share_balance = int(await euler_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Euler share balance for %s: %s", address, exc)

        silo_savusd_share_balance = 0
        silo_susdp_share_balance = 0
        silo_gami_share_balance = 0
        folks_share_balance = 0
        try:
            silo_savusd_adapter = get_adapter("silo_savusd_usdc")
            silo_savusd_share_balance = int(await silo_savusd_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Silo savUSD share balance for %s: %s", address, exc)
        try:
            silo_susdp_adapter = get_adapter("silo_susdp_usdc")
            silo_susdp_share_balance = int(await silo_susdp_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Silo sUSDp share balance for %s: %s", address, exc)
        try:
            silo_gami_adapter = get_adapter("silo_gami_usdc")
            silo_gami_share_balance = int(await silo_gami_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Silo Gami share balance for %s: %s", address, exc)
        try:
            folks_adapter = get_adapter("folks")
            folks_share_balance = int(await folks_adapter.get_shares(address))
        except Exception as exc:
            logger.warning("Failed to read Folks share balance for %s: %s", address, exc)

        agent_fee_raw = _to_raw_usdc(fee_calc.agent_fee) if settings.AGENT_FEE_ENABLED else 0
        # Always use quantized fee-calculator output to avoid micro truncation drift.
        net_to_user = fee_calc.user_receives
        withdraw_raw = _to_raw_usdc(net_to_user)

        if withdraw_raw + agent_fee_raw > _to_raw_usdc(current_balance):
            raise HTTPException(
                status_code=503,
                detail="Computed withdrawal exceeds on-chain balance. Please retry.",
            )

        payload = {
            "serializedPermission": session_key,
            "sessionPrivateKey": session_private_key,
            "smartAccountAddress": address,
            "ownerAddress": account.get("owner_address", ""),
            "withdrawAmount": str(withdraw_raw),
            "agentFeeAmount": str(agent_fee_raw),
            "isFullWithdrawal": effective_full_withdrawal,
            "contracts": {
                "AAVE_POOL": settings.AAVE_V3_POOL,
                "BENQI_POOL": settings.BENQI_QIUSDC,
                "SPARK_VAULT": settings.SPARK_SPUSDC,
                "EULER_VAULT": settings.EULER_VAULT,
                "SILO_SAVUSD_VAULT": settings.SILO_SAVUSD_VAULT,
                "SILO_SUSDP_VAULT": settings.SILO_SUSDP_VAULT,
                "SILO_GAMI_USDC_VAULT": settings.SILO_GAMI_USDC_VAULT,
                "FOLKS_SPOKE_COMMON": settings.FOLKS_SPOKE_COMMON,
                "FOLKS_SPOKE_USDC": settings.FOLKS_SPOKE_USDC,
                "FOLKS_ACCOUNT_MANAGER": settings.FOLKS_ACCOUNT_MANAGER,
                "FOLKS_LOAN_MANAGER": settings.FOLKS_LOAN_MANAGER,
                "FOLKS_USDC_HUB_POOL": settings.FOLKS_USDC_HUB_POOL,
                "FOLKS_HUB_CHAIN_ID": settings.FOLKS_HUB_CHAIN_ID,
                "FOLKS_USDC_POOL_ID": settings.FOLKS_USDC_POOL_ID,
                "FOLKS_USDC_LOAN_TYPE_ID": settings.FOLKS_USDC_LOAN_TYPE_ID,
                "FOLKS_ACCOUNT_NONCE": settings.FOLKS_ACCOUNT_NONCE,
                "FOLKS_LOAN_NONCE": settings.FOLKS_LOAN_NONCE,
                "USDC": settings.USDC_ADDRESS,
                "TREASURY": settings.TREASURY_ADDRESS,
            },
            "balances": {
                "aaveATokenBalance": str(aave_atoken_balance),
                "benqiQiTokenBalance": str(benqi_qi_balance),
                "sparkShareBalance": str(spark_share_balance),
                "eulerShareBalance": str(euler_share_balance),
                "siloSavusdShareBalance": str(silo_savusd_share_balance),
                "siloSusdpShareBalance": str(silo_susdp_share_balance),
                "siloGamiShareBalance": str(silo_gami_share_balance),
                "folksShareBalance": str(folks_share_balance),
            },
        }

        execution = ExecutionService()
        try:
            result = await execution.execute_withdrawal(payload)
        except Exception as exc:
            err_msg = str(exc)
            # Only revoke on definitively invalid session key errors.
            # "validateUserOp" removed — too broad, catches transient failures.
            # "EnableNotApproved" removed — caused by paymaster config issue,
            # NOT a definitively invalid session key.
            if (
                "serializedSessionKey" in err_msg
                or "No signer" in err_msg
                or "Session key/account mismatch" in err_msg
            ):
                revoke_session_key(db, UUID(account["id"]))
                raise HTTPException(
                    status_code=400,
                    detail="Session key invalid and has been revoked. Please re-authorize.",
                )
            logger.error(
                "Execution service returned an error for withdrawal: %s",
                err_msg,
            )
            raise HTTPException(
                status_code=502,
                detail="Withdrawal execution failed — please try again",
            )

        tx_hash = result.get("txHash")

        # Record withdrawal in yield tracking
        record_withdrawal(db, account["id"], fee_calc)

        # Log the withdrawal
        db.table("rebalance_logs").insert({
            "account_id": account["id"],
            "status": "executed",
            "skip_reason": None,
            "from_protocol": "withdrawal",
            "to_protocol": "user_eoa",
            "amount_moved": str(withdraw_amount),
            "tx_hash": tx_hash,
            "apr_improvement": None,
        }).execute()

        # If full withdrawal, deactivate account and clear live allocations.
        # Keep historical rows (yield tracking, rebalance logs, session-key
        # history) so lifetime metrics remain consistent.
        if effective_full_withdrawal:
            # Revoke session key first (best-effort)
            try:
                revoke_session_key(db, UUID(account["id"]))
            except Exception as exc:
                logger.warning("Session key revocation during full withdrawal failed: %s", exc)

            # Clear live allocations now that funds have been withdrawn.
            db.table("allocations").delete().eq("account_id", account["id"]).execute()

            db.table("accounts").update({
                "is_active": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", account["id"]).execute()

            logger.info(
                "Full withdrawal complete for %s. Account deactivated and history preserved.",
                address,
            )

        return WithdrawalExecuteResponse(
            status="executed",
            txHash=tx_hash,
            agentFee=str(fee_calc.agent_fee),
            userReceives=str(fee_calc.user_receives),
            accountDeactivated=effective_full_withdrawal,
            message=(
                "Full withdrawal complete. Account deactivated."
                if effective_full_withdrawal
                else f"Partial withdrawal of ${fee_calc.user_receives} complete."
            ),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Withdrawal failed for %s: %s", address, exc)
        raise HTTPException(
            status_code=500,
            detail="An error occurred during withdrawal. Your funds are safe.",
        )
