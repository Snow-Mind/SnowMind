import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app.core.database import get_db
from app.core.limiter import limiter
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
async def health_detailed(request: Request):
    """Comprehensive system health for ops monitoring."""
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
        "scheduler": scheduler_info,
        "protocols": protocols_info,
    }
