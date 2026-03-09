"""Optimizer routes — rate display, dry-run preview, and execute."""

from __future__ import annotations

import logging
import time
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.core.validators import validate_eth_address
from app.models.base import CamelModel
from app.services.protocols import ALL_ADAPTERS, ACTIVE_ADAPTERS, RISK_SCORES
from app.services.optimizer.rate_fetcher import RateFetcher
from app.services.optimizer.milp_solver import (
    OptimizerInput,
    ProtocolInput,
    solve,
)
from app.services.optimizer.risk_scorer import RiskScorer

logger = logging.getLogger("snowmind")

router = APIRouter(dependencies=[Depends(require_privy_auth)])

_rate_fetcher = RateFetcher()
_risk_scorer = RiskScorer()


# ── Response schemas ─────────────────────────────────────────────────────────

class ProtocolRateResponse(CamelModel):
    protocol_id: str
    name: str
    is_active: bool
    is_coming_soon: bool
    current_apy: Decimal
    tvl_usd: Decimal
    risk_score: Decimal
    last_updated: float


class AllocationItem(CamelModel):
    protocol_id: str
    current_pct: Decimal
    proposed_pct: Decimal
    proposed_amount_usd: Decimal
    apy: Decimal = Decimal("0")


class OptimizerPreviewOutput(CamelModel):
    smart_account_address: str
    proposed_allocations: list[AllocationItem]
    expected_apy: Decimal
    current_apy: Decimal
    rebalance_needed: bool
    risk_score: Decimal
    solve_time_ms: float


class RunOptimizerRequest(BaseModel):
    account_address: str
    risk_tolerance: str = "moderate"  # conservative | moderate | aggressive


# ── GET /rates — live rates for all protocols (including coming-soon) ────────

@router.get("/rates", response_model=list[ProtocolRateResponse])
@limiter.limit("60/minute")
async def get_all_rates(request: Request):
    """Fetch live on-chain rates from every known protocol adapter."""
    rates = await _rate_fetcher.fetch_all_rates()

    out: list[ProtocolRateResponse] = []
    for pid, adapter in ALL_ADAPTERS.items():
        rate = rates.get(pid)
        is_active = pid in ACTIVE_ADAPTERS
        is_coming_soon = getattr(adapter, "is_active", True) is False

        out.append(
            ProtocolRateResponse(
                protocol_id=pid,
                name=adapter.name,
                is_active=is_active,
                is_coming_soon=is_coming_soon,
                current_apy=rate.apy if rate else Decimal("0"),
                tvl_usd=rate.tvl_usd if rate else Decimal("0"),
                risk_score=Decimal(str(RISK_SCORES.get(pid, 10.0))),
                last_updated=rate.fetched_at if rate else time.time(),
            )
        )
    return out


# ── POST /run — MILP dry-run with risk tolerance (frontend preview) ─────────

@router.post("/run", response_model=OptimizerPreviewOutput)
@limiter.limit("10/minute")
async def run_optimizer_preview(
    request: Request,
    req: RunOptimizerRequest,
    db: Client = Depends(get_db),
):
    """Run the MILP solver and return proposed allocations (no execution).

    Use this for the frontend "preview before authorising" flow.
    """
    settings = get_settings()
    address = validate_eth_address(req.account_address)

    # Validate account exists
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

    # Map risk tolerance to lambda
    risk_aversion_map = {
        "conservative": Decimal("0.8"),
        "moderate": Decimal("0.5"),
        "aggressive": Decimal("0.2"),
    }
    risk_aversion = risk_aversion_map.get(req.risk_tolerance, Decimal("0.5"))

    # Fetch + validate rates
    rates = await _rate_fetcher.fetch_active_rates()
    if not rates:
        raise HTTPException(status_code=503, detail="No protocol rates available")
    valid_rates = {
        pid: r for pid, r in rates.items() if _rate_fetcher.validate_rate(r)
    }
    if not valid_rates:
        raise HTTPException(status_code=503, detail="All rates failed validation")

    # Current allocations from DB
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

    if total_usd <= 0:
        raise HTTPException(status_code=400, detail="No deposited balance")

    # Build protocol inputs with risk scores
    protocol_inputs: list[ProtocolInput] = []
    for pid, rate in valid_rates.items():
        risk = _risk_scorer.compute_risk_score(
            pid,
            utilization_rate=(
                float(rate.utilization_rate)
                if rate.utilization_rate is not None
                else None
            ),
            protocol_apy=rate.apy,
        )
        protocol_inputs.append(
            ProtocolInput(protocol_id=pid, apy=rate.apy, risk_score=risk)
        )

    # Run MILP solver
    inp = OptimizerInput(
        total_amount_usd=total_usd,
        protocols=protocol_inputs,
        current_allocations=current,
        risk_aversion=risk_aversion,
    )
    result = solve(inp)

    # Build response items
    proposed: list[AllocationItem] = []
    for pid, amount_usd in result.allocations.items():
        rate = valid_rates.get(pid)
        proposed.append(
            AllocationItem(
                protocol_id=pid,
                current_pct=current.get(pid, Decimal("0")) / total_usd if total_usd else Decimal("0"),
                proposed_pct=amount_usd / total_usd if total_usd else Decimal("0"),
                proposed_amount_usd=amount_usd,
                apy=rate.apy if rate else Decimal("0"),
            )
        )

    # Current APY
    current_apy = Decimal("0")
    if total_usd:
        for pid, amt in current.items():
            rate = valid_rates.get(pid)
            if rate:
                current_apy += rate.apy * (amt / total_usd)

    return OptimizerPreviewOutput(
        smart_account_address=address,
        proposed_allocations=proposed,
        expected_apy=result.expected_apy,
        current_apy=current_apy,
        rebalance_needed=result.is_rebalance_needed,
        risk_score=result.risk_score,
        solve_time_ms=result.solve_time_ms,
    )


# ── POST /{address}/execute — run optimiser AND submit on-chain ──────────────

# ── POST /{address}/preview — convenience alias (address in path) ────────────

@router.post("/{address}/preview", response_model=OptimizerPreviewOutput)
@limiter.limit("10/minute")
async def preview_by_address(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    risk_tolerance: str = "moderate",
):
    """Same as /run but accepts the address as a path segment."""
    return await run_optimizer_preview(
        request,
        RunOptimizerRequest(account_address=address, risk_tolerance=risk_tolerance),
        db,
    )


@router.post("/{address}/execute")
@limiter.limit("5/minute")
async def run_and_execute(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
):
    """Run MILP solver then execute the rebalance via UserOp (internal only)."""
    address = validate_eth_address(address)
    preview = await run_optimizer_preview(
        request,
        RunOptimizerRequest(account_address=address),
        db,
    )

    if not preview.rebalance_needed:
        return {
            "status": "skipped",
            "reason": "No material allocation change needed",
            "preview": preview,
        }

    # Look up account_id for the address
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

    # Build target_allocations dict from preview
    target_allocations: dict[str, Decimal] = {
        alloc.protocol_id: alloc.proposed_amount_usd
        for alloc in preview.proposed_allocations
        if alloc.proposed_amount_usd > Decimal("1")
    }

    if not target_allocations:
        return {"status": "skipped", "reason": "No concrete moves generated"}

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()
    tx_hash = await rebalancer.execute_rebalance(
        account_id=account_id,
        smart_account_address=address,
        target_allocations=target_allocations,
    )

    if tx_hash is None:
        return {"status": "skipped", "reason": "No concrete moves generated"}

    return {
        "status": "executed",
        "tx_hash": tx_hash,
        "preview": preview,
    }
