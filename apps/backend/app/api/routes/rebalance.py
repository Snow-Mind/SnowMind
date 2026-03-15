"""Rebalance — trigger, status, and history endpoints.

All paths accept a smart-account **address** (not a UUID account_id) so the
frontend can use the address it already has from ZeroDev.
"""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.core.validators import validate_eth_address
from app.models.base import CamelModel
from app.models.rebalance_log import RebalanceLogResponse, RebalanceHistoryResponse
from app.services.execution.session_key import get_active_session_key
from app.services.optimizer.rebalancer import Rebalancer

logger = logging.getLogger("snowmind")

router = APIRouter()  # Auth applied per-endpoint


def _classify_reason(
    *,
    is_active: bool,
    has_session_key: bool,
    idle_usdc: Decimal,
    last_status: str | None,
    last_skip_reason: str | None,
) -> tuple[str, str]:
    """Return machine-readable reason code + human detail."""
    if not is_active:
        return ("ACCOUNT_INACTIVE", "Account is inactive")

    if not has_session_key:
        return ("NO_ACTIVE_SESSION_KEY", "No active session key")

    if last_status == "executed":
        return ("HEALTHY", "Latest rebalance executed")

    if last_status == "failed":
        detail = last_skip_reason or "Execution failed"
        if "validateUserOp" in detail or "AA23" in detail:
            return ("USEROP_VALIDATE_REVERT", detail)
        if "EnableNotApproved" in detail:
            return ("SESSION_KEY_NOT_APPROVED", detail)
        return ("EXECUTION_FAILED", detail)

    if last_status == "skipped":
        detail = last_skip_reason or "Skipped"
        if "No active session key" in detail:
            return ("NO_ACTIVE_SESSION_KEY", detail)
        if "No deposited balance" in detail:
            return ("NO_DEPOSITED_BALANCE", detail)
        if "No protocols permitted by active session key" in detail:
            return ("NO_PERMITTED_PROTOCOLS", detail)
        if "Session key invalid" in detail:
            return ("SESSION_KEY_INVALID", detail)
        if "Rebalance not worth it" in detail:
            return ("REBALANCE_NOT_WORTH_IT", detail)
        if "Last rebalance too recent" in detail:
            return ("MIN_INTERVAL_NOT_MET", detail)
        return ("SKIPPED", detail)

    if idle_usdc > Decimal("0.01"):
        return (
            "IDLE_FUNDS_PENDING_DEPLOYMENT",
            f"Idle USDC detected ({idle_usdc:.2f}) but no executed rebalance yet",
        )

    return ("UNKNOWN", "No explicit blocker detected")


# ── helpers ──────────────────────────────────────────────────────────────────

async def _lookup_account(db: Client, address: str) -> dict:
    """Resolve a checksummed address → account row, or raise 404."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, address, is_active")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    return acct.data[0]


# ── Response schemas ─────────────────────────────────────────────────────────

class RebalanceTriggerResponse(CamelModel):
    smart_account_address: str
    status: str
    detail: dict | None = None


# ── POST /{address}/trigger — manually trigger a rebalance check ─────────────

@router.post("/{address}/trigger", response_model=RebalanceTriggerResponse)
@limiter.limit("5/minute")
async def trigger_rebalance(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Manually trigger a rebalance check for one account."""
    account = await _lookup_account(db, address)

    if not account.get("is_active", True):
        raise HTTPException(status_code=400, detail="Account is inactive")

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()
    result = await rebalancer.check_and_rebalance(
        account_id=account["id"],
        smart_account_address=account["address"],
    )

    return RebalanceTriggerResponse(
        smart_account_address=account["address"],
        status=result.get("status", "unknown"),
        detail=result,
    )


# ── GET /{address}/status — latest rebalance log ────────────────────────────

@router.get("/{address}/status")
@limiter.limit("60/minute")
async def get_rebalance_status(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
):
    """Return the most recent rebalance result and overall status."""
    account = await _lookup_account(db, address)
    addr = account["address"]
    account_id = account["id"]
    is_active = bool(account.get("is_active", True))

    has_session_key = bool(get_active_session_key(db, account_id))

    idle_usdc = Decimal("0")
    try:
        rebalancer = Rebalancer()
        idle_usdc = await rebalancer._get_idle_usdc_balance(addr)
    except Exception as exc:
        logger.debug("Idle balance diagnostic failed for %s: %s", addr, exc)

    last = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not last.data:
        reason_code, reason_detail = _classify_reason(
            is_active=is_active,
            has_session_key=has_session_key,
            idle_usdc=idle_usdc,
            last_status=None,
            last_skip_reason=None,
        )
        return {
            "smartAccountAddress": addr,
            "lastRebalance": None,
            "status": "idle",
            "lastLog": None,
            "reasonCode": reason_code,
            "reasonDetail": reason_detail,
        }

    row = last.data[0]
    reason_code, reason_detail = _classify_reason(
        is_active=is_active,
        has_session_key=has_session_key,
        idle_usdc=idle_usdc,
        last_status=row.get("status"),
        last_skip_reason=row.get("skip_reason"),
    )
    return {
        "smartAccountAddress": addr,
        "lastRebalance": row.get("created_at"),
        "status": row.get("status"),
        "lastLog": row,
        "reasonCode": reason_code,
        "reasonDetail": reason_detail,
    }


# ── GET /{address}/history — paginated rebalance logs ───────────────────────

@router.get("/{address}/history", response_model=RebalanceHistoryResponse)
@limiter.limit("30/minute")
async def get_rebalance_history(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Return paginated rebalance history for one account."""
    account = await _lookup_account(db, address)
    addr = account["address"]
    account_id = account["id"]

    # Fetch count
    count_resp = (
        db.table("rebalance_logs")
        .select("id", count="exact")
        .eq("account_id", account_id)
        .execute()
    )
    total = count_resp.count or 0

    # Fetch page
    logs = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    return RebalanceHistoryResponse(
        logs=[RebalanceLogResponse(**row) for row in logs.data],
        total=total,
    )


# ── POST /{address}/withdraw-all — emergency withdraw from all protocols ────

@router.post("/{address}/withdraw-all")
@limiter.limit("3/minute")
async def withdraw_all(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Withdraw all funds from every active protocol back to the smart account.

    Calculates and deducts a 10% profit fee (on yield earned, not principal).
    Fee transfer to treasury is included atomically in the same UserOp batch.
    Returns the fee breakdown so the user can see exactly what was charged.
    """
    account = await _lookup_account(db, address)
    addr = account["address"]
    account_id = account["id"]

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()

    try:
        tx_hash, fee_breakdown = await rebalancer.execute_emergency_withdrawal(
            account_id=account_id,
            smart_account_address=addr,
        )

        return {
            "status": "executed",
            "txHash": tx_hash,
            "feeBreakdown": {
                "profitUsd": str(fee_breakdown["profit_usd"]),
                "feeUsd": str(fee_breakdown["fee_usd"]),
                "feePct": str(fee_breakdown["fee_pct"]),
                "netWithdrawalUsd": str(fee_breakdown["net_withdrawal_usd"]),
            },
        }
    except ValueError as exc:
        # "No positions to withdraw" or "No active session key"
        return {"status": "skipped", "txHash": None, "reason": str(exc)}


# ── GET /platform/capacity — remaining deposit capacity for guarded launch ──

@router.get("/platform/capacity")
@limiter.limit("60/minute")
async def get_platform_capacity(
    request: Request,
    db: Client = Depends(get_db),
):
    """Return the remaining platform deposit capacity for the guarded beta launch."""
    settings = get_settings()
    cap = Decimal(str(settings.MAX_TOTAL_PLATFORM_DEPOSIT_USD))

    alloc_rows = (
        db.table("allocations")
        .select("amount_usdc")
        .execute()
    )
    total_deployed = sum(
        Decimal(str(row["amount_usdc"])) for row in alloc_rows.data
    )

    remaining = max(cap - total_deployed, Decimal("0"))
    return {
        "maxCapUsd": str(cap),
        "totalDeployedUsd": str(total_deployed),
        "remainingCapacityUsd": str(remaining),
        "isCapReached": remaining <= Decimal("0"),
    }
