"""Portfolio state and rebalance history endpoints."""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from supabase import Client

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.core.validators import validate_eth_address
from app.models.allocation import AllocationResponse, PortfolioResponse
from app.models.rebalance_log import RebalanceHistoryResponse, RebalanceLogResponse

logger = logging.getLogger("snowmind")

router = APIRouter(dependencies=[Depends(require_privy_auth)])

# Protocol display names
_NAMES = {"benqi": "Benqi", "aave_v3": "Aave V3", "euler_v2": "Euler V2"}


# ── GET /portfolio/{address} ──────────────────────────────

@router.get("/{address}", response_model=PortfolioResponse)
@limiter.limit("60/minute")
async def get_portfolio(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
):
    """Return current portfolio state for a smart account."""
    address = validate_eth_address(address)
    # Find account
    acct = (
        db.table("accounts")
        .select("id")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    account_id = acct.data[0]["id"]

    # Fetch allocations
    allocs = (
        db.table("allocations")
        .select("protocol_id, amount_usdc, allocation_pct, apy_at_allocation")
        .eq("account_id", account_id)
        .execute()
    )

    allocations: list[AllocationResponse] = []
    total_deposited = Decimal(0)
    for row in allocs.data or []:
        amt = Decimal(str(row["amount_usdc"]))
        total_deposited += amt
        allocations.append(
            AllocationResponse(
                protocol_id=row["protocol_id"],
                name=_NAMES.get(row["protocol_id"], row["protocol_id"]),
                amount_usdc=amt,
                allocation_pct=Decimal(str(row["allocation_pct"])),
                current_apy=Decimal(str(row["apy_at_allocation"] or 0)),
            )
        )

    # Last rebalance timestamp
    last_rb = (
        db.table("rebalance_logs")
        .select("created_at")
        .eq("account_id", account_id)
        .eq("status", "executed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    last_ts = last_rb.data[0]["created_at"] if last_rb.data else None

    return PortfolioResponse(
        total_deposited_usd=total_deposited,
        total_yield_usd=Decimal(0),  # TODO: compute from on-chain deltas
        allocations=allocations,
        last_rebalance_at=last_ts,
    )


# ── GET /portfolio/{address}/history ─────────────────────

@router.get("/{address}/history", response_model=RebalanceHistoryResponse)
@limiter.limit("30/minute")
async def get_rebalance_history(
    request: Request,
    address: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Client = Depends(get_db),
):
    """Paginated rebalance log history."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    account_id = acct.data[0]["id"]

    # Total count
    count_result = (
        db.table("rebalance_logs")
        .select("id", count="exact")
        .eq("account_id", account_id)
        .execute()
    )
    total = count_result.count if count_result.count is not None else 0

    # Page
    rows = (
        db.table("rebalance_logs")
        .select("id, status, proposed_allocations, executed_allocations, apr_improvement, gas_cost_usd, tx_hash, created_at")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    logs = [
        RebalanceLogResponse(
            id=r["id"],
            status=r["status"],
            proposed_allocations=r.get("proposed_allocations"),
            executed_allocations=r.get("executed_allocations"),
            apr_improvement=r.get("apr_improvement"),
            gas_cost_usd=r.get("gas_cost_usd"),
            tx_hash=r.get("tx_hash"),
            created_at=r["created_at"],
        )
        for r in (rows.data or [])
    ]

    return RebalanceHistoryResponse(logs=logs, total=total)
