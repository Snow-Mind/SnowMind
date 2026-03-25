import logging
from datetime import datetime, timezone
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, Request

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_api_key
from app.services.protocols import ACTIVE_ADAPTERS
from app.services.protocols.circuit_breaker import protocol_circuit_breaker

logger = logging.getLogger("snowmind")

router = APIRouter()


@router.get("/health")
@limiter.limit("60/minute")
async def health_check(request: Request):
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "1.0.0",
    }


@router.get("/health/detailed")
async def health_detailed(request: Request, _key: str = Depends(require_api_key)):
    """Comprehensive system health for ops monitoring."""
    settings = get_settings()
    now = datetime.now(timezone.utc).isoformat()

    # ── Database ─────────────────────────────────────────────────────────────
    db_status = "ok"
    active_accounts = 0
    try:
        db = get_db()
        result = db.table("accounts").select("id", count="exact").eq("is_active", True).execute()
        active_accounts = result.count or 0
    except Exception as exc:
        db_status = f"error: {exc}"
        logger.warning("Health check — DB error: %s", exc)

    # ── Execution service ────────────────────────────────────────────────────
    exec_status = "unknown"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.EXECUTION_SERVICE_URL}/health")
            if resp.status_code == 200:
                exec_status = "ok"
            else:
                exec_status = f"unhealthy (status={resp.status_code})"
    except Exception as exc:
        exec_status = f"unreachable: {exc}"
        logger.warning("Health check — execution service unreachable: %s", exc)

    # ── Scheduler ────────────────────────────────────────────────────────────
    scheduler_info: dict = {"running": False}
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is not None:
        scheduler_info = {
            "running": scheduler.running,
            "last_run": scheduler.last_run.isoformat() if scheduler.last_run else None,
            "next_run": scheduler.next_run.isoformat() if scheduler.next_run else None,
            "last_run_stats": scheduler.last_run_stats,
        }

    # ── Protocol circuit breakers ────────────────────────────────────────────
    cb_states = protocol_circuit_breaker.get_all_states()
    protocols_info = {}
    for pid in ACTIVE_ADAPTERS:
        state_str = cb_states.get(pid, "closed")
        protocols_info[pid] = {
            "circuit_breaker": state_str,
        }

    return {
        "status": "ok",
        "timestamp": now,
        "version": "1.0.0",
        "database": db_status,
        "active_accounts": active_accounts,
        "execution_service": exec_status,
        "scheduler": scheduler_info,
        "protocols": protocols_info,
    }


@router.get("/platform/tvl")
@limiter.limit("60/minute")
async def platform_tvl(request: Request):
    """Total value locked across all SnowMind accounts.

    Public endpoint — used on the landing page. Sums amount_usdc across
    all active allocations (excluding idle) from the allocations table.
    """
    try:
        db = get_db()
        rows = (
            db.table("allocations")
            .select("amount_usdc")
            .neq("protocol_id", "idle")
            .execute()
            .data
        )
        total = sum(Decimal(str(r["amount_usdc"])) for r in rows if r.get("amount_usdc"))
        return {
            "tvl_usd": str(total),
            "accounts_with_deposits": len([r for r in rows if Decimal(str(r.get("amount_usdc", "0"))) > 0]),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning("Platform TVL query failed: %s", e)
        return {
            "tvl_usd": "0",
            "accounts_with_deposits": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


@router.get("/platform/stats")
@limiter.limit("60/minute")
async def platform_stats(request: Request):
    """Platform-wide analytics: total users, deposits, TVL, rebalances."""
    try:
        db = get_db()

        # Total registered accounts
        accounts = db.table("accounts").select("id, created_at").execute()
        total_users = len(accounts.data) if accounts.data else 0

        # Accounts with active session keys (active users)
        now_z = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        active_keys = (
            db.table("session_keys")
            .select("account_id")
            .eq("is_active", True)
            .gte("expires_at", now_z)
            .execute()
        )
        active_users = len(set(r["account_id"] for r in active_keys.data)) if active_keys.data else 0

        # Deposit tracking from account_yield_tracking
        yield_rows = (
            db.table("account_yield_tracking")
            .select("account_id, cumulative_deposited")
            .execute()
        )
        accounts_with_deposits = 0
        total_deposited = Decimal("0")
        if yield_rows.data:
            for row in yield_rows.data:
                amt = Decimal(str(row.get("cumulative_deposited", "0")))
                if amt > Decimal("0"):
                    accounts_with_deposits += 1
                    total_deposited += amt

        # Current TVL (on-chain allocations)
        alloc_rows = (
            db.table("allocations")
            .select("amount_usdc")
            .neq("protocol_id", "idle")
            .execute()
        )
        current_tvl = sum(
            Decimal(str(r["amount_usdc"]))
            for r in (alloc_rows.data or [])
            if r.get("amount_usdc")
        )

        # Rebalance stats
        executed = (
            db.table("rebalance_logs")
            .select("id", count="exact")
            .eq("status", "executed")
            .execute()
        )
        total_rebalances = executed.count if executed.count is not None else 0

        return {
            "total_users": total_users,
            "active_users": active_users,
            "accounts_with_deposits": accounts_with_deposits,
            "total_deposited_usd": str(total_deposited),
            "current_tvl_usd": str(current_tvl),
            "total_rebalances_executed": total_rebalances,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        logger.warning("Platform stats query failed: %s", e)
        return {
            "total_users": 0,
            "active_users": 0,
            "accounts_with_deposits": 0,
            "total_deposited_usd": "0",
            "current_tvl_usd": "0",
            "total_rebalances_executed": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
