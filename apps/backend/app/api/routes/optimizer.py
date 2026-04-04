"""Optimizer routes — rate display, dry-run preview, and execute."""

import logging
import time
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth, verify_account_ownership
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
_rates_cache: tuple[float, list[dict]] | None = None
_timeseries_cache: tuple[float, list[dict]] | None = None


# ── Response schemas ─────────────────────────────────────────────────────────

class ProtocolRateResponse(CamelModel):
    protocol_id: str
    name: str
    is_active: bool
    is_coming_soon: bool
    current_apy: Decimal
    tvl_usd: Decimal
    risk_score: Decimal
    utilization_rate: Decimal | None = None
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


class AverageApyResponse(CamelModel):
    """30-day average APY for a protocol."""
    protocol_id: str
    name: str
    avg_apy_30d: Decimal  # Average APY over last 30 days
    adjusted_apy_30d: Decimal  # 30-day APY adjusted for utilization and liquidity
    current_apy: Decimal  # Latest spot APY
    apy_change: Decimal  # Current - 30d avg (positive = better now)
    data_points: int  # Number of days with data
    utilization_rate: Decimal | None = None
    avg_tvl_usd_30d: Decimal | None = None
    is_active: bool


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

    # Max exposure = 100% — the 15% TVL cap is the binding constraint.
    # Risk tiers (conservative/moderate/aggressive) were never user-selectable
    # and always hardcoded to "moderate".  Removed to simplify.
    max_exposure = Decimal("1.00")
    reasoning.append(f"Max single-protocol exposure: {max_exposure} (TVL cap is binding)")

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
    protocol_utilizations = {pid: rate.utilization_rate for pid, rate in valid_rates.items()}
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl_by_protocol,
        protocol_utilizations=protocol_utilizations,
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

    Uses TWAP-smoothed APY when available for stable frontend display.
    Falls back to spot rate, then to last-known-good TWAP snapshot if
    live fetch failed (circuit breaker open, 429, RPC timeout, etc.).
    """
    global _rates_cache
    cache_ttl = max(0, int(get_settings().OPTIMIZER_RATES_CACHE_TTL_SECONDS))
    now_mono = time.monotonic()
    if cache_ttl > 0 and _rates_cache and _rates_cache[0] > now_mono:
        return [ProtocolRateResponse.model_validate(item) for item in _rates_cache[1]]

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

        # Prefer TWAP-smoothed APY over noisy spot rate for display
        display_apy = rate.apy if rate else Decimal("0")
        twap_apy = twap_buffer.get_twap_effective_apy(pid)
        if twap_apy is not None and twap_apy > Decimal("0"):
            display_apy = twap_apy

        # Cap displayed APY at sanity bound (25%) — never show inflated values
        # to users even if transient spike landed in the TWAP buffer.
        display_apy = min(display_apy, Decimal("0.25"))

        out.append(
            ProtocolRateResponse(
                protocol_id=pid,
                name=adapter.name,
                is_active=is_active,
                is_coming_soon=is_coming_soon,
                current_apy=display_apy,
                tvl_usd=rate.tvl_usd if rate else Decimal("0"),
                risk_score=Decimal(str(RISK_SCORES.get(pid, 5.0))),
                utilization_rate=rate.utilization_rate if rate else None,
                last_updated=rate.fetched_at if rate else time.time(),
            )
        )
    if cache_ttl > 0:
        _rates_cache = (
            time.monotonic() + cache_ttl,
            [item.model_dump() for item in out],
        )
    return out


# ── GET /rates/30day-avg — 30-day average APY for each protocol ────────────────

@router.get("/rates/30day-avg", response_model=list[AverageApyResponse])
@limiter.limit("60/minute")
async def get_30day_average_apy(request: Request, db: Client = Depends(get_db)):
    """Calculate 30-day average APY from daily_apy_snapshots.
    
    Useful for comparing with competitors like Aave/Spark who show historical
    APY trends. Helps users understand if rates are currently attractive or
    have been trending down.
    """
    from datetime import datetime, timedelta, timezone
    
    try:
        # Get live rates for current APY
        live_rates = await _rate_fetcher.fetch_all_rates()
        
        # Calculate 30 days ago
        thirty_days_ago = (
            datetime.now(timezone.utc) - timedelta(days=30)
        ).date().isoformat()
        
        # Fetch 30-day snapshot history
        snapshots = (
            db.table("daily_apy_snapshots")
            .select("protocol_id, apy, tvl_usd, date")
            .gte("date", thirty_days_ago)
            .order("protocol_id, date")
            .execute()
            .data
        )
        
        # Group by protocol for APY and TVL rolling windows
        protocol_apys: dict[str, list[Decimal]] = {}
        protocol_tvls: dict[str, list[Decimal]] = {}
        for snap in snapshots:
            pid = snap["protocol_id"]
            try:
                apy = Decimal(str(snap["apy"]))
                if pid not in protocol_apys:
                    protocol_apys[pid] = []
                protocol_apys[pid].append(apy)

                if snap.get("tvl_usd") is not None:
                    tvl = Decimal(str(snap["tvl_usd"]))
                    if pid not in protocol_tvls:
                        protocol_tvls[pid] = []
                    protocol_tvls[pid].append(tvl)
            except Exception as e:
                logger.warning("Invalid APY snapshot for %s: %s", pid, e)
        
        # Build response
        out: list[AverageApyResponse] = []
        for pid, adapter in ALL_ADAPTERS.items():
            apy_values = protocol_apys.get(pid, [])
            is_active = pid in ACTIVE_ADAPTERS
            live_rate = live_rates.get(pid)

            utilization_rate: Decimal | None = None
            if live_rate is not None and live_rate.utilization_rate is not None:
                try:
                    utilization_rate = Decimal(str(live_rate.utilization_rate))
                except Exception as exc:
                    logger.debug(
                        "Invalid utilization_rate for %s (%s): %s",
                        pid,
                        live_rate.utilization_rate,
                        exc,
                    )
                    utilization_rate = None

            # Utilization factor in [0.50, 1.00].
            # This softly down-weights low-utilization markets while avoiding
            # over-penalization of structurally lower-utilization venues.
            utilization_factor = Decimal("1.00")
            if utilization_rate is not None:
                util_clamped = min(max(utilization_rate, Decimal("0")), Decimal("1"))
                utilization_factor = Decimal("0.50") + (util_clamped * Decimal("0.50"))

            # Liquidity factor in [0.85, 1.00] based on 30d average TVL.
            # Full weight reaches around $50M TVL.
            avg_tvl_usd_30d: Decimal | None = None
            liquidity_factor = Decimal("1.00")
            tvl_values = protocol_tvls.get(pid, [])
            if tvl_values:
                avg_tvl_usd_30d = sum(tvl_values) / Decimal(len(tvl_values))
                tvl_ratio = min(avg_tvl_usd_30d / Decimal("50000000"), Decimal("1"))
                liquidity_factor = Decimal("0.85") + (tvl_ratio * Decimal("0.15"))
            
            if not apy_values:
                # No historical data — fallback to current APY
                current_apy = live_rate.apy if live_rate else Decimal("0")
                adjusted_apy_30d = current_apy * utilization_factor * liquidity_factor
                out.append(
                    AverageApyResponse(
                        protocol_id=pid,
                        name=adapter.name,
                        avg_apy_30d=current_apy,
                        adjusted_apy_30d=adjusted_apy_30d,
                        current_apy=current_apy,
                        apy_change=Decimal("0"),
                        data_points=0,
                        utilization_rate=utilization_rate,
                        avg_tvl_usd_30d=avg_tvl_usd_30d,
                        is_active=is_active,
                    )
                )
                continue
            
            # Calculate average
            avg_apy = sum(apy_values) / Decimal(len(apy_values))
            adjusted_apy_30d = avg_apy * utilization_factor * liquidity_factor
            
            # Get current APY
            current_apy = live_rate.apy if live_rate else apy_values[-1]  # Use latest snapshot if live fetch failed
            
            # Calculate change (positive = better now)
            apy_change = current_apy - avg_apy
            
            out.append(
                AverageApyResponse(
                    protocol_id=pid,
                    name=adapter.name,
                    avg_apy_30d=avg_apy,
                    adjusted_apy_30d=adjusted_apy_30d,
                    current_apy=current_apy,
                    apy_change=apy_change,
                    data_points=len(apy_values),
                    utilization_rate=utilization_rate,
                    avg_tvl_usd_30d=avg_tvl_usd_30d,
                    is_active=is_active,
                )
            )
        
        return out
    except Exception as e:
        logger.error("Failed to calculate 30-day average APY: %s", e)
        raise HTTPException(status_code=500, detail="Failed to calculate historical APY")


# ── GET /rates/timeseries — daily APY timeseries for chart display ────────────

class ApyTimeseriesPoint(CamelModel):
    """Single data point in the APY timeseries."""
    date: str
    snowmind_apy: Decimal
    aave_apy: Decimal


@router.options("/rates/timeseries")
async def options_apy_timeseries() -> Response:
    """Explicitly acknowledge preflight for chart polling clients."""
    return Response(status_code=200)


@router.options("/rates/timeseries/")
async def options_apy_timeseries_trailing_slash() -> Response:
    """Compatibility preflight handler for clients that append trailing slash."""
    return Response(status_code=200)


@router.get("/rates/timeseries", response_model=list[ApyTimeseriesPoint])
@limiter.limit("60/minute")
async def get_apy_timeseries(request: Request, db: Client = Depends(get_db)):
    """Return daily APY timeseries for SnowMind best route vs Aave benchmark.

    Used by the landing page growth chart. Public endpoint, no auth required.
    Returns up to 30 days of daily data points.
    """
    global _timeseries_cache
    cache_ttl = max(0, int(get_settings().APY_TIMESERIES_CACHE_TTL_SECONDS))
    now_mono = time.monotonic()
    if cache_ttl > 0 and _timeseries_cache and _timeseries_cache[0] > now_mono:
        return [ApyTimeseriesPoint.model_validate(item) for item in _timeseries_cache[1]]

    from datetime import datetime, timedelta, timezone

    try:
        thirty_days_ago = (
            datetime.now(timezone.utc) - timedelta(days=30)
        ).date().isoformat()

        snapshots = (
            db.table("daily_apy_snapshots")
            .select("protocol_id, apy, date")
            .gte("date", thirty_days_ago)
            .order("date")
            .execute()
            .data
        )

        if not snapshots:
            return []

        # Group by date, tracking best non-aave active protocol and aave
        by_date: dict[str, dict[str, Decimal]] = {}
        for snap in snapshots:
            d = snap["date"]
            pid = snap["protocol_id"]
            try:
                apy = Decimal(str(snap["apy"]))
            except Exception as exc:
                logger.debug(
                    "Skipping malformed APY snapshot in timeseries (date=%s, protocol=%s, apy=%s): %s",
                    d,
                    pid,
                    snap.get("apy"),
                    exc,
                )
                continue
            if d not in by_date:
                by_date[d] = {}
            by_date[d][pid] = apy

        # Build timeseries: SnowMind = best active protocol APY, Aave = aave_v3
        active_pids = set(ACTIVE_ADAPTERS.keys())
        out: list[ApyTimeseriesPoint] = []
        for date_str in sorted(by_date.keys()):
            day_rates = by_date[date_str]
            aave_apy = day_rates.get("aave_v3", Decimal("0"))

            # SnowMind picks the best active protocol on each day
            best_apy = Decimal("0")
            for pid, apy in day_rates.items():
                if pid in active_pids and apy > best_apy:
                    best_apy = apy

            out.append(
                ApyTimeseriesPoint(
                    date=date_str,
                    snowmind_apy=best_apy,
                    aave_apy=aave_apy,
                )
            )

        if cache_ttl > 0:
            _timeseries_cache = (
                time.monotonic() + cache_ttl,
                [item.model_dump() for item in out],
            )
        return out
    except Exception as e:
        logger.error("Failed to build APY timeseries: %s", e)
        raise HTTPException(status_code=500, detail="Failed to build timeseries")


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
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_account_ownership(_auth, acct.data[0], db=db)
    account_id = acct.data[0]["id"]

    # Max exposure = 100% — the 15% TVL cap is the binding constraint.
    max_exposure = Decimal("1.00")

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
    protocol_utilizations = {pid: rate.utilization_rate for pid, rate in valid_rates.items()}
    result = waterfall_allocate(
        inp=inp,
        tvl_by_protocol=tvl_by_protocol,
        protocol_utilizations=protocol_utilizations,
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
        _auth,
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
        _auth,
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
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    verify_account_ownership(_auth, acct.data[0], db=db)
    account_id = acct.data[0]["id"]

    # Build target_allocations dict from preview
    target_allocations: dict[str, Decimal] = {
        alloc.protocol_id: alloc.proposed_amount_usd
        for alloc in preview.proposed_allocations
        if alloc.proposed_amount_usd > Decimal("0.01")
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
