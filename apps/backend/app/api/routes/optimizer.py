"""Optimizer routes — rate display, dry-run preview, and execute."""

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
from app.services.optimizer.rate_fetcher import RateFetcher, twap_buffer
from app.services.optimizer.milp_solver import (
    OptimizerInput,
    ProtocolInput,
)
from app.services.optimizer.waterfall_allocator import waterfall_allocate
from app.services.optimizer.risk_scorer import RiskScorer

logger = logging.getLogger("snowmind")

router = APIRouter()  # Auth applied per-endpoint

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


class SimulateRequest(BaseModel):
    """Request body for the /simulate dry-run endpoint."""
    total_usdc: Decimal
    risk_tolerance: str = "moderate"
    forced_protocol_rates: dict[str, Decimal] | None = None


class SimulateResponse(CamelModel):
    """Detailed simulation output — no auth, no execution, no DB writes."""
    dry_run: bool = True
    total_usdc: Decimal
    risk_tolerance: str
    proposed_allocations: list[AllocationItem]
    expected_apy: Decimal
    risk_score: Decimal
    rebalance_needed: bool
    solve_time_ms: float
    protocol_rates: list[ProtocolRateResponse]
    reasoning: list[str]


# ── POST /simulate — zero-cost dry-run (no auth, no execution, no DB) ────────

@router.post("/simulate", response_model=SimulateResponse)
@limiter.limit("30/minute")
async def simulate_optimization(request: Request, req: SimulateRequest):
    """Run the full optimizer pipeline as a dry-run.

    - Does NOT decrypt any session key
    - Does NOT build or submit any UserOperation
    - Does NOT write to database
    - Does NOT require authentication
    - Returns EXACTLY what the live rebalancer would decide and why
    - Reads LIVE on-chain APYs from the actual protocols
    """
    settings = get_settings()
    reasoning: list[str] = []

    if req.total_usdc <= Decimal("0"):
        raise HTTPException(status_code=400, detail="total_usdc must be positive")
    if req.total_usdc > Decimal("10000000"):
        raise HTTPException(
            status_code=400,
            detail="total_usdc exceeds simulation cap ($10M)",
        )

    reasoning.append(f"Simulating ${req.total_usdc} USDC allocation")

    # Map risk tolerance to max exposure
    exposure_map = {
        "conservative": Decimal("0.40"),
        "moderate": Decimal("0.60"),
        "aggressive": Decimal("1.00"),
    }
    max_exposure = exposure_map.get(req.risk_tolerance, Decimal("0.60"))
    reasoning.append(f"Risk tolerance: {req.risk_tolerance} → max_exposure={max_exposure}")

    # Fetch live rates
    rates = await _rate_fetcher.fetch_active_rates()
    if not rates:
        raise HTTPException(status_code=503, detail="No protocol rates available")

    # Apply forced rates if provided (for testing)
    if req.forced_protocol_rates:
        for pid, forced_apy in req.forced_protocol_rates.items():
            if pid in rates:
                rates[pid] = rates[pid]._replace(apy=forced_apy, effective_apy=forced_apy)
                reasoning.append(f"Override: {pid} APY forced to {forced_apy}")

    valid_rates = {
        pid: r for pid, r in rates.items() if _rate_fetcher.validate_rate(r)
    }
    if not valid_rates:
        raise HTTPException(status_code=503, detail="All rates failed validation")

    # Build protocol inputs
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
        reasoning.append(
            f"{pid}: APY={rate.apy:.4%}, TVL=${rate.tvl_usd:,.0f}, risk={risk:.1f}"
        )

    # Run waterfall allocator (no current allocations = fresh deployment)
    inp = OptimizerInput(
        total_amount_usd=req.total_usdc,
        protocols=protocol_inputs,
        current_allocations={},
        gas_cost_estimate_usd=Decimal(str(settings.GAS_COST_ESTIMATE_USD)),
    )
    tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in valid_rates.items()}
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl_by_protocol,
        tvl_cap_pct=Decimal(str(settings.TVL_CAP_PCT)),
        max_exposure_pct=max_exposure,
        base_beat_margin=Decimal(str(settings.BEAT_MARGIN)),
        base_layer_protocol_id=settings.BASE_LAYER_PROTOCOL_ID,
    )

    # Build protocol rate response
    rate_responses: list[ProtocolRateResponse] = []
    for pid, rate in valid_rates.items():
        rate_responses.append(
            ProtocolRateResponse(
                protocol_id=pid,
                name=ACTIVE_ADAPTERS.get(pid, ALL_ADAPTERS.get(pid)).name
                if pid in ACTIVE_ADAPTERS or pid in ALL_ADAPTERS
                else pid,
                is_active=pid in ACTIVE_ADAPTERS,
                is_coming_soon=False,
                current_apy=rate.apy,
                tvl_usd=rate.tvl_usd,
                risk_score=Decimal(str(RISK_SCORES.get(pid, 5.0))),
                last_updated=rate.fetched_at,
            )
        )

    # Build allocation response
    proposed: list[AllocationItem] = []
    for pid, amount_usd in result.allocations.items():
        rate = valid_rates.get(pid)
        pct = amount_usd / req.total_usdc if req.total_usdc else Decimal("0")
        proposed.append(
            AllocationItem(
                protocol_id=pid,
                current_pct=Decimal("0"),
                proposed_pct=pct,
                proposed_amount_usd=amount_usd,
                apy=rate.apy if rate else Decimal("0"),
            )
        )
        reasoning.append(
            f"Allocate ${amount_usd:,.2f} ({pct:.1%}) → {pid}"
        )

    reasoning.append(f"Expected blended APY: {result.expected_apy:.4%}")
    reasoning.append(
        f"Rebalance needed: {result.is_rebalance_needed} "
        f"(solve time: {result.solve_time_ms:.1f}ms)"
    )

    return SimulateResponse(
        dry_run=True,
        total_usdc=req.total_usdc,
        risk_tolerance=req.risk_tolerance,
        proposed_allocations=proposed,
        expected_apy=result.expected_apy,
        risk_score=result.risk_score,
        rebalance_needed=result.is_rebalance_needed,
        solve_time_ms=result.solve_time_ms,
        protocol_rates=rate_responses,
        reasoning=reasoning,
    )


# ── GET /rates — live rates for all protocols (including coming-soon) ────────

@router.get("/rates", response_model=list[ProtocolRateResponse])
@limiter.limit("60/minute")
async def get_all_rates(request: Request):
    """Fetch live on-chain rates from every known protocol adapter.

    Falls back to TWAP-cached data for protocols whose live fetch failed
    (circuit breaker open, 429, RPC timeout, etc.).  This prevents the
    frontend from showing 0% APY / $0 TVL when Infura is rate-limited.
    """
    rates = await _rate_fetcher.fetch_all_rates()

    out: list[ProtocolRateResponse] = []
    for pid, adapter in ALL_ADAPTERS.items():
        rate = rates.get(pid)
        is_active = pid in ACTIVE_ADAPTERS
        is_coming_soon = getattr(adapter, "is_active", True) is False

        # If live fetch failed, fall back to last-known-good TWAP snapshot
        if rate is None:
            cached = twap_buffer.get_latest(pid)
            if cached is not None:
                out.append(
                    ProtocolRateResponse(
                        protocol_id=pid,
                        name=adapter.name,
                        is_active=is_active,
                        is_coming_soon=is_coming_soon,
                        current_apy=cached.effective_apy,
                        tvl_usd=cached.tvl_usd,
                        risk_score=Decimal(str(RISK_SCORES.get(pid, 5.0))),
                        last_updated=cached.fetched_at,
                    )
                )
                continue

        out.append(
            ProtocolRateResponse(
                protocol_id=pid,
                name=adapter.name,
                is_active=is_active,
                is_coming_soon=is_coming_soon,
                current_apy=rate.apy if rate else Decimal("0"),
                tvl_usd=rate.tvl_usd if rate else Decimal("0"),
                risk_score=Decimal(str(RISK_SCORES.get(pid, 5.0))),
                last_updated=rate.fetched_at if rate else time.time(),
            )
        )
    return out


# ── POST /run — waterfall dry-run with risk tolerance (frontend preview) ──────

@router.post("/run", response_model=OptimizerPreviewOutput)
@limiter.limit("10/minute")
async def run_optimizer_preview(
    request: Request,
    req: RunOptimizerRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Run the waterfall allocator and return proposed allocations (no execution).

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

    # Map risk tolerance to max exposure for waterfall allocator
    exposure_map = {
        "conservative": Decimal("0.40"),  # diversified
        "moderate": Decimal("0.60"),      # balanced
        "aggressive": Decimal("1.00"),    # max yield
    }
    max_exposure = exposure_map.get(req.risk_tolerance, Decimal("0.60"))

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

    # Run waterfall allocator
    inp = OptimizerInput(
        total_amount_usd=total_usd,
        protocols=protocol_inputs,
        current_allocations=current,
        gas_cost_estimate_usd=Decimal(str(settings.GAS_COST_ESTIMATE_USD)),
    )
    tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in valid_rates.items()}
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl_by_protocol,
        tvl_cap_pct=Decimal(str(settings.TVL_CAP_PCT)),
        max_exposure_pct=max_exposure,
        base_beat_margin=Decimal(str(settings.BEAT_MARGIN)),
        base_layer_protocol_id=settings.BASE_LAYER_PROTOCOL_ID,
    )

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
    _auth: dict = Depends(require_privy_auth),
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
    _auth: dict = Depends(require_privy_auth),
):
    """Run waterfall allocator then execute the rebalance via UserOp (internal only)."""
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
