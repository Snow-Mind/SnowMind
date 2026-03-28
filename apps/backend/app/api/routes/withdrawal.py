"""
Withdrawal API routes — partial and full withdrawal flows.

Implements the fee calculation and atomic UserOp construction for withdrawals.
Agent fee (10% of profit) is charged proportionally on EVERY withdrawal.
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

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
from app.services.protocols import get_adapter

logger = logging.getLogger("snowmind.api.withdrawal")

router = APIRouter()

# Minimum withdrawal: 0.01 USDC (below this is dust)
_MIN_WITHDRAWAL_USDC = Decimal("0.01")
# Maximum withdrawal: $10M (sanity guard)
_MAX_WITHDRAWAL_USDC = Decimal("10000000")


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
        if amt < _MIN_WITHDRAWAL_USDC:
            raise ValueError(f"withdraw_amount below dust threshold (${_MIN_WITHDRAWAL_USDC})")
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
    model_config = {"populate_by_name": True}

    @field_validator("withdraw_amount")
    @classmethod
    def validate_withdraw_amount(cls, v: str) -> str:
        try:
            amt = Decimal(v)
        except Exception:
            raise ValueError("withdraw_amount must be a valid decimal string")
        if amt < _MIN_WITHDRAWAL_USDC:
            raise ValueError(f"withdraw_amount below dust threshold (${_MIN_WITHDRAWAL_USDC})")
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
    from app.services.protocols import ALL_ADAPTERS

    total = 0
    for pid, adapter in ALL_ADAPTERS.items():
        try:
            balance = await adapter.get_balance(smart_account)
            total += balance
        except Exception as exc:
            logger.warning(
                "Failed to read %s balance for %s: %s",
                pid,
                smart_account,
                exc,
            )
    return Decimal(str(total)) / Decimal("1e6")  # Convert to USDC (6 decimals → human)


def _compute_fee(
    withdraw_amount_usdc: Decimal,
    current_balance_usdc: Decimal,
    account: dict,
    yield_tracking: dict | None,
) -> FeeCalculation:
    """Compute agent fee for a withdrawal using the yield tracking data."""
    # Net principal = cumulative_deposited - cumulative_net_withdrawn
    if yield_tracking:
        cumulative_deposited = Decimal(str(yield_tracking.get("cumulative_deposited", "0")))
        cumulative_withdrawn = Decimal(str(yield_tracking.get("cumulative_net_withdrawn", "0")))
        net_principal = cumulative_deposited - cumulative_withdrawn
    else:
        # No tracking record — assume all is principal (no profit, no fee)
        net_principal = current_balance_usdc

    fee_exempt = account.get("fee_exempt", False)

    return calculate_agent_fee(
        withdraw_amount=withdraw_amount_usdc,
        current_balance=current_balance_usdc,
        net_principal=net_principal,
        fee_exempt=fee_exempt,
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

    if requested_amount_usdc > current_balance_usdc:
        return requested_amount_usdc, False

    remaining = current_balance_usdc - requested_amount_usdc
    if remaining <= _MIN_WITHDRAWAL_USDC:
        return current_balance_usdc, True

    return requested_amount_usdc, False


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

    # ── Treasury address guard ──────────────────────────────────────────
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

        agent_fee_raw = int(fee_calc.agent_fee * Decimal("1e6"))  # Convert to 6-decimal raw
        # withdrawAmount is what the user receives = requested amount minus fee
        net_to_user = withdraw_amount - fee_calc.agent_fee
        withdraw_raw = int(net_to_user * Decimal("1e6"))

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
            "apy_improvement": None,
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
