"""Rebalance — trigger, status, and history endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from supabase import Client

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_api_key
from app.models.rebalance_log import RebalanceLogResponse, RebalanceHistoryResponse

logger = logging.getLogger("snowmind")

router = APIRouter(dependencies=[Depends(require_api_key)])


# ── Response schemas ─────────────────────────────────────────────────────────

class RebalanceTriggerResponse(BaseModel):
    account_id: str
    status: str
    detail: dict | None = None


# ── POST /{account_id}/trigger — manually trigger a rebalance check ──────────

@router.post("/{account_id}/trigger", response_model=RebalanceTriggerResponse)
@limiter.limit("5/minute")
async def trigger_rebalance(
    request: Request,
    account_id: str,
    db: Client = Depends(get_db),
):
    """Manually trigger a rebalance check for one account (internal only)."""
    # Look up account
    acct = (
        db.table("accounts")
        .select("id, address, is_active")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    account = acct.data[0]
    if not account.get("is_active", True):
        raise HTTPException(status_code=400, detail="Account is inactive")

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()
    result = await rebalancer.check_and_rebalance(
        account_id=account_id,
        smart_account_address=account["address"],
    )

    return RebalanceTriggerResponse(
        account_id=account_id,
        status=result.get("status", "unknown"),
        detail=result,
    )


# ── GET /{account_id}/status — latest rebalance log ─────────────────────────

@router.get("/{account_id}/status")
@limiter.limit("60/minute")
async def get_rebalance_status(
    request: Request,
    account_id: str,
    db: Client = Depends(get_db),
):
    """Return the most recent rebalance result and overall status."""
    acct = (
        db.table("accounts")
        .select("id, address")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    address = acct.data[0]["address"]

    last = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_address", address.lower())
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not last.data:
        return {
            "account_id": account_id,
            "smart_account_address": address,
            "last_rebalance": None,
            "status": "idle",
            "last_log": None,
        }

    row = last.data[0]
    return {
        "account_id": account_id,
        "smart_account_address": address,
        "last_rebalance": row.get("created_at"),
        "status": row.get("status"),
        "last_log": row,
    }


# ── GET /{account_id}/history — paginated rebalance logs ────────────────────

@router.get("/{account_id}/history", response_model=RebalanceHistoryResponse)
@limiter.limit("30/minute")
async def get_rebalance_history(
    request: Request,
    account_id: str,
    db: Client = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Return paginated rebalance history for one account."""
    acct = (
        db.table("accounts")
        .select("id, address")
        .eq("id", account_id)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    address = acct.data[0]["address"]

    # Fetch count
    count_resp = (
        db.table("rebalance_logs")
        .select("id", count="exact")
        .eq("account_address", address.lower())
        .execute()
    )
    total = count_resp.count or 0

    # Fetch page
    logs = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_address", address.lower())
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    return RebalanceHistoryResponse(
        logs=[RebalanceLogResponse(**row) for row in logs.data],
        total=total,
    )
