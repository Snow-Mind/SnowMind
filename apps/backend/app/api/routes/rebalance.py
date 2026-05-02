"""Rebalance — trigger, status, and history endpoints.

All paths accept a smart-account **address** (not a UUID account_id) so the
frontend can use the address it already has from ZeroDev.
"""

import logging
import asyncio
import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db, get_supabase
from app.core.limiter import limiter
from app.core.security import require_privy_auth, verify_account_ownership
from app.core.validators import validate_eth_address
from app.models.base import CamelModel
from app.models.rebalance_log import RebalanceLogResponse, RebalanceHistoryResponse
from app.services.execution.session_key import get_active_session_key
from app.services.optimizer.rebalancer import Rebalancer

logger = logging.getLogger("snowmind")

router = APIRouter()  # Auth applied per-endpoint

_VALID_REBALANCE_STATUSES = {"executed", "skipped", "failed", "halted", "pending"}


def _parse_alloc_amount(value: object) -> Decimal | None:
    """Parse numeric allocation values from legacy/string payloads."""
    try:
        if isinstance(value, Decimal):
            numeric = value
        elif isinstance(value, (int, float)):
            numeric = Decimal(str(value))
        elif isinstance(value, str):
            cleaned = value.replace(",", "").replace("$", "").strip()
            if not cleaned:
                return None
            numeric = Decimal(cleaned)
        else:
            return None
    except Exception:
        return None

    if numeric <= Decimal("0"):
        return None
    return numeric


def _normalize_alloc_map(payload: object) -> dict[str, Decimal]:
    if not isinstance(payload, dict):
        return {}

    normalized: dict[str, Decimal] = {}
    for protocol_id, raw_amount in payload.items():
        amount = _parse_alloc_amount(raw_amount)
        if amount is None:
            continue
        normalized[str(protocol_id)] = amount
    return normalized


def _dominant_protocol(allocations: dict[str, Decimal]) -> str | None:
    if not allocations:
        return None
    return max(allocations.items(), key=lambda item: item[1])[0]


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
        detail_l = detail.lower()
        if "permission_recovery_needed" in detail_l or "deadlock" in detail_l:
            return ("SESSION_KEY_INVALID", detail)
        if "user must re-grant" in detail_l or "must regrant" in detail_l:
            return ("SESSION_KEY_INVALID", detail)
        if "validateUserOp" in detail or "AA23" in detail:
            return ("USEROP_VALIDATE_REVERT", detail)
        if "EnableNotApproved" in detail:
            return ("SESSION_KEY_NOT_APPROVED", detail)
        return ("EXECUTION_FAILED", detail)

    if last_status == "skipped":
        detail = last_skip_reason or "Skipped"
        detail_l = detail.lower()
        if "permission_recovery_needed" in detail_l or "deadlock" in detail_l:
            return ("SESSION_KEY_INVALID", detail)
        if "stranded" in detail_l and "session key" in detail_l:
            return ("NO_PERMITTED_PROTOCOLS", detail)
        if "user must re-grant" in detail_l or "must regrant" in detail_l:
            return ("SESSION_KEY_INVALID", detail)
        if "No active session key" in detail:
            return ("NO_ACTIVE_SESSION_KEY", detail)
        if "No deposited balance" in detail:
            return ("NO_DEPOSITED_BALANCE", detail)
        if "No protocols permitted by active session key" in detail:
            return ("NO_PERMITTED_PROTOCOLS", detail)
        # Edge case: every market the user opted into failed deposit-safety
        # checks this cycle (utilization >90%, paused, etc). Funds sit idle
        # at 0% APY until at least one market becomes safe again.
        if "no_deposit_safe_protocols" in detail_l or "no protocol passed deposit safety" in detail_l:
            return ("NO_DEPOSIT_SAFE_PROTOCOLS", detail)
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

async def _lookup_account(
    db: Client,
    address: str,
    auth_claims: dict | None = None,
) -> dict:
    """Resolve a checksummed address → account row, or raise 404."""
    import asyncio
    from postgrest.exceptions import APIError

    address = validate_eth_address(address)
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            acct = (
                db.table("accounts")
                .select("id, address, is_active, owner_address, privy_did")
                .eq("address", address)
                .limit(1)
                .execute()
            )
            if not acct.data:
                raise HTTPException(status_code=404, detail="Account not found")
            account = acct.data[0]
            if auth_claims is not None:
                verify_account_ownership(auth_claims, account, db=db)
            return account
        except HTTPException:
            raise
        except APIError as exc:
            last_err = exc
            if exc.code == "502" or "502" in str(exc):
                logger.warning("Supabase 502 on _lookup_account (attempt %d/3): %s", attempt + 1, exc)
                if attempt < 2:
                    await asyncio.sleep(1 * (attempt + 1))
                    continue
            raise HTTPException(status_code=502, detail="Database temporarily unavailable")
        except Exception as exc:
            last_err = exc
            logger.error("Unexpected error in _lookup_account: %s", exc)
            raise HTTPException(status_code=500, detail="Internal error")
    raise HTTPException(status_code=502, detail=f"Database unavailable after retries: {last_err}")


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
    account = await _lookup_account(db, address, _auth)

    if not account.get("is_active", True):
        return RebalanceTriggerResponse(
            smart_account_address=account["address"],
            status="skipped",
            detail={"skip_reason": "Account is inactive"},
        )

    from app.services.optimizer.rebalancer import Rebalancer

    rebalancer = Rebalancer()
    try:
        result = await rebalancer.check_and_rebalance(
            account_id=account["id"],
            smart_account_address=account["address"],
        )
    except ValueError as exc:
        detail = str(exc)
        detail_l = detail.lower()
        # Treat transient/session-key gate failures as normal skipped states
        # so frontend state machines do not enter false error branches.
        if (
            "no active session key" in detail_l
            or "cannot be decrypted" in detail_l
            or "must re-grant" in detail_l
            or "must regrant" in detail_l
        ):
            logger.info(
                "Manual rebalance trigger skipped for %s: %s",
                account["address"],
                detail,
            )
            return RebalanceTriggerResponse(
                smart_account_address=account["address"],
                status="skipped",
                detail={"skip_reason": detail},
            )

        logger.warning(
            "Manual rebalance trigger returned ValueError for %s: %s",
            account["address"],
            detail,
        )
        return RebalanceTriggerResponse(
            smart_account_address=account["address"],
            status="failed",
            detail={"skip_reason": detail},
        )
    except Exception as exc:
        logger.exception("Manual rebalance trigger failed for %s: %s", account["address"], exc)
        raise HTTPException(status_code=500, detail="Failed to run rebalance") from exc

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
    _auth: dict = Depends(require_privy_auth),
):
    """Return the most recent rebalance result and overall status."""
    try:
        account = await _lookup_account(db, address, _auth)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        # Account not yet registered — return idle stub
        addr = validate_eth_address(address)
        return {
            "smartAccountAddress": addr,
            "lastRebalance": None,
            "status": "idle",
            "lastLog": None,
            "reasonCode": "NOT_REGISTERED",
            "reasonDetail": "Account not yet registered. Complete onboarding to get started.",
        }
    addr = account["address"]
    account_id = account["id"]
    is_active = bool(account.get("is_active", True))

    has_session_key = bool(get_active_session_key(db, account_id))

    idle_usdc = Decimal("0")
    if is_active and has_session_key:
        try:
            rebalancer = Rebalancer()
            idle_usdc = await asyncio.wait_for(
                rebalancer._get_idle_usdc_balance(addr),
                timeout=3.0,
            )
        except TimeoutError:
            logger.info("Idle balance diagnostic timed out for %s", addr)
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
    _auth: dict = Depends(require_privy_auth),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    transactions_only: bool = Query(default=False, alias="transactionsOnly"),
):
    """Return paginated rebalance history for one account."""
    try:
        account = await _lookup_account(db, address, _auth)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        # Account not yet registered — return empty history
        return RebalanceHistoryResponse(logs=[], total=0)
    addr = account["address"]
    account_id = account["id"]

    count_query = (
        db.table("rebalance_logs")
        .select("id", count="exact")
        .eq("account_id", account_id)
    )
    if transactions_only:
        # Transaction view should include only on-chain executed operations.
        count_query = count_query.eq("status", "executed")

    # Fetch count
    count_resp = count_query.execute()
    total = count_resp.count or 0

    logs_query = (
        db.table("rebalance_logs")
        .select("*")
        .eq("account_id", account_id)
    )
    if transactions_only:
        logs_query = logs_query.eq("status", "executed")

    # Fetch page
    logs = (
        logs_query
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    sanitized_logs: list[RebalanceLogResponse] = []
    for row in logs.data or []:
        if not isinstance(row, dict):
            continue

        normalized = dict(row)

        raw_status = str(normalized.get("status") or "").strip().lower()
        if raw_status not in _VALID_REBALANCE_STATUSES:
            normalized["status"] = "failed"
            if not normalized.get("skip_reason"):
                normalized["skip_reason"] = (
                    f"Legacy rebalance status '{raw_status or 'unknown'}'"
                )

        amount_moved = normalized.get("amount_moved")
        if amount_moved is not None and not isinstance(amount_moved, str):
            normalized["amount_moved"] = str(amount_moved)

        for alloc_field in ("proposed_allocations", "executed_allocations"):
            alloc_value = normalized.get(alloc_field)
            if isinstance(alloc_value, str):
                try:
                    decoded = json.loads(alloc_value)
                    normalized[alloc_field] = decoded if isinstance(decoded, dict) else None
                except Exception:
                    normalized[alloc_field] = None
            elif alloc_value is not None and not isinstance(alloc_value, dict):
                normalized[alloc_field] = None

        proposed_allocations = _normalize_alloc_map(normalized.get("proposed_allocations"))
        executed_allocations = _normalize_alloc_map(normalized.get("executed_allocations"))
        if not executed_allocations and proposed_allocations:
            executed_allocations = dict(proposed_allocations)

        if proposed_allocations:
            normalized["proposed_allocations"] = {
                pid: str(amount.quantize(Decimal("0.000001")))
                for pid, amount in proposed_allocations.items()
            }
        elif normalized.get("proposed_allocations") is not None:
            normalized["proposed_allocations"] = None

        if executed_allocations:
            normalized["executed_allocations"] = {
                pid: str(amount.quantize(Decimal("0.000001")))
                for pid, amount in executed_allocations.items()
            }
        elif normalized.get("executed_allocations") is not None:
            normalized["executed_allocations"] = None

        if raw_status == "executed":
            parsed_amount_moved = _parse_alloc_amount(normalized.get("amount_moved"))
            if parsed_amount_moved is None:
                alloc_total = sum(executed_allocations.values())
                if alloc_total > Decimal("0"):
                    normalized["amount_moved"] = str(alloc_total.quantize(Decimal("0.000001")))

            if not normalized.get("from_protocol") and executed_allocations:
                normalized["from_protocol"] = "rebalance"

            if not normalized.get("to_protocol"):
                dominant = _dominant_protocol(executed_allocations)
                if dominant:
                    normalized["to_protocol"] = dominant

        for numeric_field in ("apr_improvement", "gas_cost_usd"):
            numeric_value = normalized.get(numeric_field)
            if numeric_value is None:
                continue
            try:
                normalized[numeric_field] = float(numeric_value)
            except (TypeError, ValueError):
                normalized[numeric_field] = None

        try:
            sanitized_logs.append(RebalanceLogResponse(**normalized))
        except Exception as exc:
            logger.warning(
                "Skipping malformed rebalance log row for account %s (id=%s): %s",
                account_id,
                row.get("id"),
                exc,
            )

    return RebalanceHistoryResponse(
        logs=sanitized_logs,
        total=total,
    )


# ── POST /{address}/partial-withdraw — partial withdrawal, no fee ────────────

class PartialWithdrawRequest(CamelModel):
    amount_usdc: str  # String to avoid float — parsed as Decimal downstream
    protocol_id: str


@router.post("/{address}/partial-withdraw")
@limiter.limit("5/minute")
async def partial_withdraw(
    request: Request,
    address: str,
    body: PartialWithdrawRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Legacy endpoint retained for backward compatibility.

    Security policy: partial withdrawals must go through the new
    signature-protected `/api/v1/withdrawals/*` flow so fee, treasury, and
    accounting behavior remains consistent across all withdrawal paths.
    """
    # Keep ownership/auth checks in place before returning a migration error.
    await _lookup_account(db, address, _auth)
    raise HTTPException(
        status_code=410,
        detail=(
            "Legacy partial-withdraw endpoint is deprecated. "
            "Use /api/v1/withdrawals/preview and /api/v1/withdrawals/execute."
        ),
    )


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


# ── POST /dry-run — full pipeline dry-run (no auth, no execution) ────────────

class DryRunRequest(BaseModel):
    """Simulate a rebalance decision for a hypothetical or real account.

    - If account_address is provided: reads real on-chain balances and DB allocations.
    - If omitted: uses total_usdc as a fresh deployment (no current positions).
    - Never executes anything. Never writes to DB.
    """
    account_address: str | None = None
    total_usdc: Decimal | None = None
    current_allocations: dict[str, Decimal] | None = None


class DryRunAllocationItem(CamelModel):
    protocol_id: str
    current_usd: Decimal
    proposed_usd: Decimal
    delta_usd: Decimal


class DryRunResponse(CamelModel):
    dry_run: bool = True
    total_usdc: Decimal
    idle_usdc: Decimal
    current_allocations: dict[str, Decimal]
    proposed_allocations: list[DryRunAllocationItem]
    current_weighted_apy: Decimal
    proposed_weighted_apy: Decimal
    apy_improvement: Decimal
    rebalance_needed: bool
    skip_reason: str | None = None
    health_checks: dict[str, dict]
    protocol_rates: dict[str, dict]
    reasoning: list[str]


@router.post("/dry-run", response_model=DryRunResponse)
@limiter.limit("20/minute")
async def dry_run_rebalance(request: Request, body: DryRunRequest):
    """Full 19-step rebalancer pipeline as a dry-run.

    - Reads LIVE on-chain APYs from actual protocols
    - Runs health checks (adapter.get_health() for each protocol)
    - Runs the allocator algorithm
    - Computes deltas, beat-margin gate, profitability gate
    - Returns exactly what the live rebalancer would decide and WHY
    - Does NOT execute anything. Does NOT write to DB. No auth required.
    """
    settings = get_settings()
    reasoning: list[str] = []

    # Resolve total balance and current allocations
    current: dict[str, Decimal] = {}
    idle_usdc = Decimal("0")
    total_usd = Decimal("0")

    if body.account_address:
        # Real account: read on-chain balances
        addr = validate_eth_address(body.account_address)
        reasoning.append(f"Reading on-chain state for {addr}")

        rebalancer = Rebalancer()
        idle_usdc = await rebalancer._get_idle_usdc_balance(addr)
        reasoning.append(f"Idle USDC in smart account: ${float(idle_usdc):.2f}")

        # Read DB allocations if account exists
        db = get_supabase()
        acct = (
            db.table("accounts")
            .select("id")
            .eq("address", addr)
            .limit(1)
            .execute()
        )
        if acct.data:
            alloc_rows = (
                db.table("allocations")
                .select("protocol_id, amount_usdc")
                .eq("account_id", acct.data[0]["id"])
                .execute()
            )
            for row in alloc_rows.data:
                amt = Decimal(str(row["amount_usdc"]))
                current[row["protocol_id"]] = amt
                total_usd += amt
            reasoning.append(f"DB allocations: {dict(current)}")

        total_usd += idle_usdc
    elif body.total_usdc:
        total_usd = body.total_usdc
        idle_usdc = body.total_usdc
        if body.current_allocations:
            current = {k: v for k, v in body.current_allocations.items()}
            total_usd = sum(current.values(), Decimal("0")) + idle_usdc
        reasoning.append(f"Simulated balance: ${float(total_usd):.2f}")
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either account_address or total_usdc",
        )

    if total_usd <= 0:
        raise HTTPException(status_code=400, detail="Total balance is zero")

    # Fetch live rates
    from app.services.optimizer.rate_fetcher import RateFetcher
    from app.services.protocols import ALL_ADAPTERS
    from app.services.protocols.base import ProtocolHealth, ProtocolStatus
    from app.services.optimizer.health_checker import check_protocol_health, HealthCheckResult, RebalanceFlag
    from app.services.optimizer.allocator import (
        compute_allocation,
        compute_weighted_apy as compute_alloc_weighted_apy,
        UserPreference,
    )

    rate_fetcher = RateFetcher()

    spot_rates = await rate_fetcher.fetch_all_rates()
    if not spot_rates:
        raise HTTPException(status_code=503, detail="No protocol rates available")

    # Build rate info for response
    rate_info: dict[str, dict] = {}
    for pid, rate in spot_rates.items():
        rate_info[pid] = {
            "apy": str(rate.apy),
            "apyPct": f"{float(rate.apy) * 100:.2f}%",
            "tvlUsd": str(rate.tvl_usd),
            "utilizationRate": str(rate.utilization_rate) if rate.utilization_rate else None,
        }
        reasoning.append(
            f"{pid}: APY={float(rate.apy) * 100:.2f}%, TVL=${float(rate.tvl_usd):,.0f}"
        )

    apy_by_protocol = {pid: rate.apy for pid, rate in spot_rates.items()}
    tvl_by_protocol = {pid: rate.tvl_usd for pid, rate in spot_rates.items()}

    # Health checks for all protocols
    health_results: dict[str, HealthCheckResult] = {}
    health_info: dict[str, dict] = {}
    protocol_utilizations: dict[str, Decimal | None] = {}

    for pid in spot_rates:
        try:
            adapter = ALL_ADAPTERS.get(pid)
            if adapter:
                proto_health = await adapter.get_health()
            else:
                proto_health = ProtocolHealth(
                    protocol_id=pid,
                    status=ProtocolStatus.HEALTHY,
                    is_deposit_safe=True,
                    is_withdrawal_safe=True,
                )
        except Exception as exc:
            reasoning.append(f"Health check RPC failed for {pid}: {exc}")
            proto_health = ProtocolHealth(
                protocol_id=pid,
                status=ProtocolStatus.HEALTHY,
                is_deposit_safe=True,
                is_withdrawal_safe=True,
            )

        protocol_utilizations[pid] = proto_health.utilization

        hr = await check_protocol_health(
            protocol_id=pid,
            protocol_health=proto_health,
            current_apy=apy_by_protocol.get(pid, Decimal("0")),
            twap_apy=apy_by_protocol.get(pid, Decimal("0")),
            previous_apy=None,
            yesterday_avg_apy=None,
            daily_snapshots_7d=None,
            current_position=current.get(pid, Decimal("0")),
            protocol_tvl=tvl_by_protocol.get(pid, Decimal("0")),
            circuit_breaker_failures=0,
        )
        health_results[pid] = hr
        health_info[pid] = {
            "isHealthy": hr.is_healthy,
            "isDepositSafe": hr.is_deposit_safe,
            "flag": hr.flag.value if hasattr(hr.flag, "value") else str(hr.flag),
            "exclusionReasons": hr.exclusion_reasons,
        }
        if not hr.is_deposit_safe:
            reasoning.append(f"{pid}: EXCLUDED — {'; '.join(hr.exclusion_reasons)}")
        else:
            reasoning.append(f"{pid}: HEALTHY (deposit safe)")

    # Run allocator
    allocation_result = compute_allocation(
        health_results=health_results,
        twap_apys=apy_by_protocol,
        protocol_tvls=tvl_by_protocol,
        total_balance=total_usd,
        protocol_utilizations=protocol_utilizations,
        user_preferences={
            pid: UserPreference(protocol_id=pid, enabled=True, max_pct=None)
            for pid in spot_rates
        },
    )
    result_allocations = allocation_result.allocations

    # Compute weighted APYs
    new_weighted_apy = allocation_result.weighted_apy
    current_weighted_apy = compute_alloc_weighted_apy(
        allocations=current,
        total_balance=total_usd,
        twap_apys=apy_by_protocol,
    )
    apy_improvement = new_weighted_apy - current_weighted_apy

    # Determine if rebalance is needed
    rebalance_needed = True
    skip_reason: str | None = None

    # Beat margin gate
    if apy_improvement < Decimal(str(settings.BEAT_MARGIN)):
        rebalance_needed = False
        skip_reason = f"APY improvement ({float(apy_improvement) * 100:.4f}%) below beat margin ({float(settings.BEAT_MARGIN) * 100:.2f}%)"
        reasoning.append(f"SKIP: {skip_reason}")

    # Movement threshold
    all_protocols = set(current.keys()) | set(result_allocations.keys())
    total_movement = sum(
        abs(result_allocations.get(pid, Decimal("0")) - current.get(pid, Decimal("0")))
        for pid in all_protocols
    ) / Decimal("2")
    if rebalance_needed and total_movement < Decimal("0.01"):
        rebalance_needed = False
        skip_reason = f"Total movement below $0.01 (${float(total_movement):.2f})"
        reasoning.append(f"SKIP: {skip_reason}")

    # Profitability gate
    if rebalance_needed and total_usd > 0:
        daily_gain = apy_improvement * total_usd / Decimal("365")
        gas_cost = Decimal(str(settings.GAS_COST_ESTIMATE_USD))
        if daily_gain < gas_cost:
            rebalance_needed = False
            skip_reason = f"Profitability gate: daily gain ${float(daily_gain):.4f} < gas ${float(gas_cost):.4f}"
            reasoning.append(f"SKIP: {skip_reason}")

    # Build delta items
    proposed_items: list[DryRunAllocationItem] = []
    for pid in sorted(all_protocols | set(result_allocations.keys())):
        cur = current.get(pid, Decimal("0"))
        prop = result_allocations.get(pid, Decimal("0"))
        if cur > 0 or prop > 0:
            proposed_items.append(DryRunAllocationItem(
                protocol_id=pid,
                current_usd=cur,
                proposed_usd=prop,
                delta_usd=prop - cur,
            ))

    if rebalance_needed:
        reasoning.append(
            f"REBALANCE NEEDED: move ${float(total_movement):.2f}, "
            f"APY {float(current_weighted_apy) * 100:.2f}% → {float(new_weighted_apy) * 100:.2f}%"
        )
    else:
        reasoning.append("NO REBALANCE: " + (skip_reason or "allocation unchanged"))

    return DryRunResponse(
        dry_run=True,
        total_usdc=total_usd,
        idle_usdc=idle_usdc,
        current_allocations=current,
        proposed_allocations=proposed_items,
        current_weighted_apy=current_weighted_apy,
        proposed_weighted_apy=new_weighted_apy,
        apy_improvement=apy_improvement,
        rebalance_needed=rebalance_needed,
        skip_reason=skip_reason,
        health_checks=health_info,
        protocol_rates=rate_info,
        reasoning=reasoning,
    )
