"""Portfolio state and rebalance history endpoints."""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.validators import validate_eth_address
from app.models.allocation import AllocationResponse, PortfolioResponse
from app.services.protocols import get_adapter, ACTIVE_ADAPTERS
from app.services.protocols.base import get_shared_async_web3
from app.models.rebalance_log import RebalanceHistoryResponse, RebalanceLogResponse

logger = logging.getLogger("snowmind")

router = APIRouter()  # All portfolio reads are public

# Protocol display names
_NAMES = {"benqi": "Benqi", "aave_v3": "Aave V3", "euler_v2": "Euler V2"}

# ERC-20 balanceOf ABI
_ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]


async def _get_idle_usdc(address: str) -> Decimal:
    """Read the on-chain USDC balance sitting idle in the smart account."""
    try:
        settings = get_settings()
        w3 = get_shared_async_web3()
        usdc = w3.eth.contract(
            address=w3.to_checksum_address(settings.USDC_ADDRESS),
            abi=_ERC20_ABI,
        )
        balance_wei = await usdc.functions.balanceOf(
            w3.to_checksum_address(address)
        ).call()
        return Decimal(str(balance_wei)) / Decimal("1000000")
    except Exception as exc:
        logger.warning("Failed to read idle USDC for %s: %s", address, exc)
        return Decimal("0")


async def _get_protocol_balance(address: str, protocol_id: str) -> Decimal:
    """Read on-chain underlying balance for a protocol."""
    try:
        settings = get_settings()
        adapter = get_adapter(protocol_id)
        balance_wei = await adapter.get_user_balance(address, settings.USDC_ADDRESS)
        return Decimal(str(balance_wei)) / Decimal("1000000")
    except Exception as exc:
        logger.warning("On-chain balance read failed for %s/%s: %s", protocol_id, address, exc)
        return Decimal("0")


async def _get_protocol_apy(protocol_id: str) -> Decimal:
    """Get current live APY for a protocol."""
    try:
        adapter = get_adapter(protocol_id)
        rate = await adapter.get_rate()
        return rate.apy
    except Exception:
        return Decimal("0")


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
    db_protocol_ids: set[str] = set()
    for row in allocs.data or []:
        amt = Decimal(str(row["amount_usdc"]))
        total_deposited += amt
        db_protocol_ids.add(row["protocol_id"])
        allocations.append(
            AllocationResponse(
                protocol_id=row["protocol_id"],
                name=_NAMES.get(row["protocol_id"], row["protocol_id"]),
                amount_usdc=amt,
                allocation_pct=Decimal(str(row["allocation_pct"])),
                current_apy=Decimal(str(row["apy_at_allocation"] or 0)),
            )
        )

    # Check on-chain protocol balances for active protocols not in DB
    for pid in ACTIVE_ADAPTERS:
        onchain_balance = await _get_protocol_balance(address, pid)
        if onchain_balance > Decimal("0.01"):
            existing = next((a for a in allocations if a.protocol_id == pid), None)
            if existing:
                # Prefer on-chain balance if significantly different from DB
                if abs(onchain_balance - existing.amount_usdc) > Decimal("0.5"):
                    total_deposited -= existing.amount_usdc
                    existing.amount_usdc = onchain_balance
                    total_deposited += onchain_balance
            else:
                # Protocol balance found on-chain but not in DB (direct deposit)
                live_apy = await _get_protocol_apy(pid)
                allocations.append(
                    AllocationResponse(
                        protocol_id=pid,
                        name=_NAMES.get(pid, pid),
                        amount_usdc=onchain_balance,
                        allocation_pct=Decimal("0"),
                        current_apy=live_apy,
                    )
                )
                total_deposited += onchain_balance

    # Fetch live APY for all protocol allocations (overwrite stale DB values)
    for alloc in allocations:
        if alloc.protocol_id in ACTIVE_ADAPTERS:
            live_apy = await _get_protocol_apy(alloc.protocol_id)
            if live_apy > Decimal("0"):
                alloc.current_apy = live_apy

    # Read on-chain idle USDC balance (not yet deployed to any protocol)
    idle_usdc = await _get_idle_usdc(address)
    if idle_usdc > Decimal("0.01"):
        total_deposited += idle_usdc
        allocations.append(
            AllocationResponse(
                protocol_id="idle",
                name="Idle USDC (Wallet)",
                amount_usdc=idle_usdc,
                allocation_pct=Decimal("0"),
                current_apy=Decimal("0"),
            )
        )

    # Recalculate allocation_pct for all entries
    if total_deposited > 0:
        for alloc in allocations:
            alloc.allocation_pct = alloc.amount_usdc / total_deposited

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
