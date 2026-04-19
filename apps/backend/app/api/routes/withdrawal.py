"""
Withdrawal API routes — partial and full withdrawal flows.

Implements atomic UserOp construction for withdrawals. Agent fee plumbing is
kept in place but currently disabled behind configuration.
"""

import logging
import asyncio
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
from app.services.execution.executor import (
    ExecutionService,
    UserOpExecutionFailedError,
    UserOpReceiptUnavailableError,
)
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
_WITHDRAW_SIGNATURE_MAX_FUTURE_SKEW_SECONDS = 30
_WITHDRAWABLE_ERC4626_PROTOCOLS = {
    "spark",
    "euler_v2",
    "silo_savusd_usdc",
    "silo_susdp_usdc",
}

_ERC20_BALANCE_OF_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]

_ERC4626_WITHDRAWABLE_ABI = [
    {
        "name": "maxRedeem",
        "type": "function",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "previewRedeem",
        "type": "function",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "convertToAssets",
        "type": "function",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

_BENQI_LIQUIDITY_ABI = [
    {
        "name": "getCash",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "exchangeRateStored",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
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
    settings = get_settings()
    w3 = get_shared_async_web3()

    total_raw = 0
    failed_protocols: list[str] = []

    for pid, adapter in ACTIVE_ADAPTERS.items():
        try:
            if pid in _WITHDRAWABLE_ERC4626_PROTOCOLS:
                shares = int(await adapter.get_shares(smart_account))
                if shares <= 0:
                    balance = 0
                else:
                    vault_address = _erc4626_vault_address(pid, settings)
                    if not vault_address:
                        raise RuntimeError(f"Missing vault address for {pid}")
                    balance = await _read_erc4626_withdrawable_raw(
                        w3,
                        vault_address=vault_address,
                        owner_address=smart_account,
                        shares=shares,
                        protocol_id=pid,
                    )
            else:
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


async def _get_total_position_balance(smart_account: str) -> tuple[Decimal, bool]:
    """
    Read total on-chain position value without withdrawability caps.

    This is used only after a full-withdrawal attempt to decide whether the
    account can be safely deactivated. If any balance read fails, the check is
    treated as incomplete and the account remains active as a safety default.
    """
    settings = get_settings()
    w3 = get_shared_async_web3()

    total_raw = 0
    balance_check_complete = True

    for pid, adapter in ACTIVE_ADAPTERS.items():
        try:
            balance = await adapter.get_balance(smart_account)
            total_raw += int(balance)
        except Exception as exc:
            balance_check_complete = False
            logger.warning(
                "Failed to read full %s balance for %s during deactivation guard: %s",
                pid,
                smart_account,
                exc,
            )

    try:
        usdc = w3.eth.contract(
            address=w3.to_checksum_address(settings.USDC_ADDRESS),
            abi=_ERC20_BALANCE_OF_ABI,
        )
        idle_raw = await usdc.functions.balanceOf(
            w3.to_checksum_address(smart_account)
        ).call()
        total_raw += int(idle_raw)
    except Exception as exc:
        balance_check_complete = False
        logger.warning(
            "Failed to read idle USDC balance for %s during deactivation guard: %s",
            smart_account,
            exc,
        )

    total_usdc = Decimal(str(total_raw)) / Decimal("1e6")
    return total_usdc, balance_check_complete


def _erc4626_vault_address(protocol_id: str, settings) -> str | None:
    if protocol_id == "spark":
        return settings.SPARK_SPUSDC
    if protocol_id == "euler_v2":
        return settings.EULER_VAULT
    if protocol_id == "silo_savusd_usdc":
        return settings.SILO_SAVUSD_VAULT
    if protocol_id == "silo_susdp_usdc":
        return settings.SILO_SUSDP_VAULT
    return None


def _conservative_erc4626_assets(convert_to_assets_raw: int, preview_redeem_raw: int | None) -> int:
    """Pick the safer redeem estimate to prevent over-transfers on withdrawal."""
    if preview_redeem_raw is None:
        return int(convert_to_assets_raw)
    return int(min(int(convert_to_assets_raw), int(preview_redeem_raw)))


def _conservative_erc4626_shares(shares_raw: int, max_redeem_raw: int | None) -> int:
    """Limit redeem shares to what the vault currently allows to redeem."""
    if max_redeem_raw is None:
        return int(shares_raw)
    return int(min(int(shares_raw), int(max_redeem_raw)))


async def _read_erc4626_withdrawable_raw(
    w3,
    *,
    vault_address: str,
    owner_address: str,
    shares: int,
    protocol_id: str,
) -> int:
    vault = w3.eth.contract(
        address=w3.to_checksum_address(vault_address),
        abi=_ERC4626_WITHDRAWABLE_ABI,
    )

    redeemable_shares = await _read_erc4626_redeemable_shares(
        w3,
        vault_address=vault_address,
        owner_address=owner_address,
        shares=shares,
        protocol_id=protocol_id,
    )
    if redeemable_shares <= 0:
        return 0

    convert_raw = int(await vault.functions.convertToAssets(redeemable_shares).call())

    preview_raw: int | None = None
    try:
        preview_raw = int(await vault.functions.previewRedeem(redeemable_shares).call())
    except Exception as exc:
        logger.debug("previewRedeem unavailable for %s: %s", protocol_id, exc)

    conservative_raw = _conservative_erc4626_assets(convert_raw, preview_raw)
    if preview_raw is not None and conservative_raw < convert_raw:
        logger.info(
            "Using previewRedeem for %s withdrawal quote (convert=%s preview=%s)",
            protocol_id,
            convert_raw,
            preview_raw,
        )
    return conservative_raw


async def _read_erc4626_redeemable_shares(
    w3,
    *,
    vault_address: str,
    owner_address: str,
    shares: int,
    protocol_id: str,
) -> int:
    if shares <= 0:
        return 0

    vault = w3.eth.contract(
        address=w3.to_checksum_address(vault_address),
        abi=_ERC4626_WITHDRAWABLE_ABI,
    )

    max_redeem_raw: int | None = None
    try:
        max_redeem_raw = int(
            await vault.functions.maxRedeem(
                w3.to_checksum_address(owner_address)
            ).call()
        )
    except Exception as exc:
        logger.debug("maxRedeem unavailable for %s: %s", protocol_id, exc)

    redeemable_shares = _conservative_erc4626_shares(shares, max_redeem_raw)
    if max_redeem_raw is not None and redeemable_shares < shares:
        logger.warning(
            "Capping %s redeem shares from %s to %s due maxRedeem liquidity",
            protocol_id,
            shares,
            redeemable_shares,
        )

    return redeemable_shares


def _cap_benqi_redeemable_shares(
    *,
    user_qi_shares: int,
    cash_raw: int,
    exchange_rate_raw: int,
) -> int:
    if user_qi_shares <= 0:
        return 0
    if exchange_rate_raw <= 0:
        return 0

    max_redeemable_qi = (int(cash_raw) * (10**18)) // int(exchange_rate_raw)
    return int(min(int(user_qi_shares), max(int(max_redeemable_qi), 0)))


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


def _can_deactivate_after_full_withdrawal(
    *,
    post_withdraw_total_usdc: Decimal,
    balance_check_complete: bool,
) -> bool:
    """Return True only when post-withdraw balance check proves account is empty."""
    return balance_check_complete and post_withdraw_total_usdc <= _FULL_WITHDRAWAL_DUST_USDC


def _to_raw_usdc(amount_usdc: Decimal) -> int:
    """Convert 6-decimal USDC amount to integer raw units exactly."""
    normalized = amount_usdc.quantize(Decimal("0.000001"))
    return int((normalized * Decimal("1e6")).to_integral_exact())


def _truncate_skip_reason(reason: str, max_len: int = 240) -> str:
    """Keep DB log reasons compact and predictable for UI rendering."""
    normalized = " ".join(str(reason).split())
    return normalized[:max_len]


def _mark_withdrawal_log_executed(
    db: Client,
    log_id: str,
    *,
    amount_moved: Decimal,
    tx_hash: str | None,
) -> None:
    db.table("rebalance_logs").update({
        "status": "executed",
        "skip_reason": None,
        "amount_moved": str(amount_moved.quantize(Decimal("0.000001"))),
        "tx_hash": tx_hash,
    }).eq("id", log_id).execute()


def _mark_withdrawal_log_failed(db: Client, log_id: str, reason: str) -> None:
    db.table("rebalance_logs").update({
        "status": "failed",
        "skip_reason": _truncate_skip_reason(reason),
        "tx_hash": None,
    }).eq("id", log_id).execute()


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
    signature_ts = int(signature_timestamp)
    if signature_ts > now_ts + _WITHDRAW_SIGNATURE_MAX_FUTURE_SKEW_SECONDS:
        raise HTTPException(
            status_code=401,
            detail="Withdrawal authorization timestamp is too far in the future.",
        )
    if (now_ts - signature_ts) > _WITHDRAW_SIGNATURE_TTL_SECONDS:
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
    zero_address = "0x" + "0" * 40
    treasury_for_payload = zero_address
    if settings.AGENT_FEE_ENABLED:
        treasury_candidate = str(settings.TREASURY_ADDRESS or "").strip()
        if not treasury_candidate or treasury_candidate.lower() == zero_address:
            raise HTTPException(
                status_code=500,
                detail="Treasury address not configured — withdrawals disabled",
            )
        try:
            treasury_for_payload = validate_eth_address(treasury_candidate)
        except ValueError as exc:
            raise HTTPException(
                status_code=500,
                detail="Treasury address is invalid — withdrawals disabled",
            ) from exc

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

    # Insert pending withdrawal row BEFORE execution so UI/DB never records an
    # unconfirmed withdrawal as completed, and concurrent submits are blocked.
    pending_log_id: str | None = None
    pending_amount = Decimal(req.withdraw_amount).quantize(Decimal("0.000001"))
    try:
        existing_pending = (
            db.table("rebalance_logs")
            .select("id")
            .eq("account_id", account["id"])
            .eq("from_protocol", "withdrawal")
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if existing_pending.data:
            raise HTTPException(
                status_code=409,
                detail="A withdrawal is already in progress for this account. Please wait.",
            )

        pending_insert = db.table("rebalance_logs").insert({
            "account_id": account["id"],
            "status": "pending",
            "skip_reason": None,
            "from_protocol": "withdrawal",
            "to_protocol": "user_eoa",
            "amount_moved": str(pending_amount),
            "tx_hash": None,
            "apr_improvement": None,
        }).execute()

        if pending_insert.data:
            pending_log_id = str(pending_insert.data[0].get("id") or "").strip() or None

        if not pending_log_id:
            pending_lookup = (
                db.table("rebalance_logs")
                .select("id")
                .eq("account_id", account["id"])
                .eq("from_protocol", "withdrawal")
                .eq("status", "pending")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if pending_lookup.data:
                pending_log_id = str(pending_lookup.data[0].get("id") or "").strip() or None

        if not pending_log_id:
            raise HTTPException(
                status_code=503,
                detail="Unable to acquire withdrawal lock. Please retry shortly.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        err_msg = str(exc).lower()
        if (
            "uq_rebalance_logs_pending_withdrawal" in err_msg
            or "duplicate key value violates unique constraint" in err_msg
        ):
            raise HTTPException(
                status_code=409,
                detail="A withdrawal is already in progress for this account. Please wait.",
            )
        logger.error("Failed to create pending withdrawal lock for %s: %s", address, exc)
        raise HTTPException(
            status_code=503,
            detail="Unable to acquire withdrawal lock. Please retry shortly.",
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
        w3 = get_shared_async_web3()

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
            if benqi_qi_balance > 0:
                benqi_pool = w3.eth.contract(
                    address=w3.to_checksum_address(settings.BENQI_QIUSDC),
                    abi=_BENQI_LIQUIDITY_ABI,
                )
                cash_raw, exchange_rate_raw = await asyncio.gather(
                    benqi_pool.functions.getCash().call(),
                    benqi_pool.functions.exchangeRateStored().call(),
                )
                capped_benqi_qi = _cap_benqi_redeemable_shares(
                    user_qi_shares=benqi_qi_balance,
                    cash_raw=int(cash_raw),
                    exchange_rate_raw=int(exchange_rate_raw),
                )
                if capped_benqi_qi < benqi_qi_balance:
                    logger.warning(
                        "Capping Benqi redeem shares from %s to %s due pool cash liquidity",
                        benqi_qi_balance,
                        capped_benqi_qi,
                    )
                benqi_qi_balance = capped_benqi_qi
        except Exception as exc:
            logger.warning("Failed to read Benqi share balance for %s: %s", address, exc)
        try:
            spark_adapter = get_adapter("spark")
            spark_share_balance = int(await spark_adapter.get_shares(address))
            if spark_share_balance > 0 and settings.SPARK_SPUSDC:
                spark_share_balance = await _read_erc4626_redeemable_shares(
                    w3,
                    vault_address=settings.SPARK_SPUSDC,
                    owner_address=address,
                    shares=spark_share_balance,
                    protocol_id="spark",
                )
        except Exception as exc:
            logger.warning("Failed to read Spark share balance for %s: %s", address, exc)
        try:
            euler_adapter = get_adapter("euler_v2")
            euler_share_balance = int(await euler_adapter.get_shares(address))
            if euler_share_balance > 0 and settings.EULER_VAULT:
                euler_share_balance = await _read_erc4626_redeemable_shares(
                    w3,
                    vault_address=settings.EULER_VAULT,
                    owner_address=address,
                    shares=euler_share_balance,
                    protocol_id="euler_v2",
                )
        except Exception as exc:
            logger.warning("Failed to read Euler share balance for %s: %s", address, exc)

        silo_savusd_share_balance = 0
        silo_susdp_share_balance = 0
        try:
            silo_savusd_adapter = get_adapter("silo_savusd_usdc")
            silo_savusd_share_balance = int(await silo_savusd_adapter.get_shares(address))
            if silo_savusd_share_balance > 0 and settings.SILO_SAVUSD_VAULT:
                silo_savusd_share_balance = await _read_erc4626_redeemable_shares(
                    w3,
                    vault_address=settings.SILO_SAVUSD_VAULT,
                    owner_address=address,
                    shares=silo_savusd_share_balance,
                    protocol_id="silo_savusd_usdc",
                )
        except Exception as exc:
            logger.warning("Failed to read Silo savUSD share balance for %s: %s", address, exc)
        try:
            silo_susdp_adapter = get_adapter("silo_susdp_usdc")
            silo_susdp_share_balance = int(await silo_susdp_adapter.get_shares(address))
            if silo_susdp_share_balance > 0 and settings.SILO_SUSDP_VAULT:
                silo_susdp_share_balance = await _read_erc4626_redeemable_shares(
                    w3,
                    vault_address=settings.SILO_SUSDP_VAULT,
                    owner_address=address,
                    shares=silo_susdp_share_balance,
                    protocol_id="silo_susdp_usdc",
                )
        except Exception as exc:
            logger.warning("Failed to read Silo sUSDp share balance for %s: %s", address, exc)

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
                "USDC": settings.USDC_ADDRESS,
                "TREASURY": treasury_for_payload,
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
        except UserOpExecutionFailedError as exc:
            logger.error(
                "Withdrawal UserOperation failed on-chain for %s: %s",
                address,
                exc,
            )
            raise HTTPException(
                status_code=502,
                detail="Withdrawal failed on-chain and reverted. Funds remain in your account positions.",
            )
        except UserOpReceiptUnavailableError as exc:
            logger.error(
                "Withdrawal confirmation unavailable for %s: %s",
                address,
                exc,
            )
            raise HTTPException(
                status_code=503,
                detail="Withdrawal submission could not be confirmed yet. Please retry shortly.",
            )
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

        # Transition pending -> executed atomically for this request.
        _mark_withdrawal_log_executed(
            db,
            pending_log_id,
            amount_moved=withdraw_amount,
            tx_hash=tx_hash,
        )

        account_deactivated = False
        message = f"Partial withdrawal of ${fee_calc.user_receives} complete."

        # A full-withdrawal request can still leave residual protocol positions
        # when vault liquidity is temporarily constrained. Deactivate only when
        # post-withdraw total on-chain position value is effectively zero.
        if effective_full_withdrawal:
            post_withdraw_total, balance_check_complete = await _get_total_position_balance(address)
            can_deactivate = _can_deactivate_after_full_withdrawal(
                post_withdraw_total_usdc=post_withdraw_total,
                balance_check_complete=balance_check_complete,
            )

            if can_deactivate:
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
                account_deactivated = True
                message = "Full withdrawal complete. Account deactivated."
            else:
                if not balance_check_complete:
                    logger.warning(
                        "Skipping account deactivation for %s after full-withdrawal request because post-withdraw balance check was incomplete",
                        address,
                    )
                else:
                    logger.warning(
                        "Skipping account deactivation for %s after full-withdrawal request; residual position remains: $%.6f",
                        address,
                        float(post_withdraw_total),
                    )
                message = (
                    "Withdrawal executed for currently redeemable funds. "
                    "Some protocol positions remain and account stays active."
                )

        return WithdrawalExecuteResponse(
            status="executed",
            txHash=tx_hash,
            agentFee=str(fee_calc.agent_fee),
            userReceives=str(fee_calc.user_receives),
            accountDeactivated=account_deactivated,
            message=message,
        )

    except HTTPException as exc:
        if pending_log_id:
            try:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                _mark_withdrawal_log_failed(db, pending_log_id, detail)
            except Exception as mark_exc:
                logger.error(
                    "Failed to mark pending withdrawal log as failed for %s (log=%s): %s",
                    address,
                    pending_log_id,
                    mark_exc,
                )
        raise
    except Exception as exc:
        if pending_log_id:
            try:
                _mark_withdrawal_log_failed(db, pending_log_id, str(exc))
            except Exception as mark_exc:
                logger.error(
                    "Failed to mark pending withdrawal log as failed for %s (log=%s): %s",
                    address,
                    pending_log_id,
                    mark_exc,
                )
        logger.error("Withdrawal failed for %s: %s", address, exc)
        raise HTTPException(
            status_code=500,
            detail="An error occurred during withdrawal. Your funds are safe.",
        )
