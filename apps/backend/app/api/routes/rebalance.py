"""Rebalance — trigger, status, and history endpoints.

All paths accept a smart-account **address** (not a UUID account_id) so the
frontend can use the address it already has from ZeroDev.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from supabase import Client

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_api_key
from app.core.validators import validate_eth_address
from app.models.base import CamelModel
from app.models.rebalance_log import RebalanceLogResponse, RebalanceHistoryResponse

logger = logging.getLogger("snowmind")

router = APIRouter(dependencies=[Depends(require_api_key)])


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

    last = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not last.data:
        return {
            "smartAccountAddress": addr,
            "lastRebalance": None,
            "status": "idle",
            "lastLog": None,
        }

    row = last.data[0]
    return {
        "smartAccountAddress": addr,
        "lastRebalance": row.get("created_at"),
        "status": row.get("status"),
        "lastLog": row,
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
):
    """Withdraw all funds from every active protocol back to the smart account."""
    account = await _lookup_account(db, address)
    addr = account["address"]
    account_id = account["id"]

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()
    tx_hash = await rebalancer.execute_rebalance(
        account_id=account_id,
        smart_account_address=addr,
        target_allocations={},  # empty = withdraw everything
    )

    return {"status": "executed", "txHash": tx_hash}
