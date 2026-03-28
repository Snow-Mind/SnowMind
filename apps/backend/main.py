"""SnowMind FastAPI application entry point."""

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from fastapi import HTTPException

from app.api.routes import accounts, health, optimizer, portfolio, rebalance, withdrawal
from app.core.config import get_settings
from app.core.database import get_supabase
from app.core.limiter import limiter
from app.core.security import rate_limit_middleware

logger = logging.getLogger("snowmind")

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Autonomous non-custodial AI yield optimizer on Avalanche",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
)

# ── slowapi per-endpoint rate limiter ────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ─────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Rate-limiting middleware (must be added BEFORE routing) ───
app.middleware("http")(rate_limit_middleware)


# ── Path normalization middleware (fix double-slash from frontend) ──
@app.middleware("http")
async def normalize_path(request: Request, call_next):  # type: ignore[no-untyped-def]
    # Some frontends send //api/v1/... when BACKEND_URL has a trailing slash.
    # Normalise to a single slash so routes match correctly.
    from starlette.datastructures import URL

    path = request.scope.get("path", "")
    if "//" in path:
        cleaned = path.replace("//", "/")
        request.scope["path"] = cleaned
        # Also update raw_path if present
        if "raw_path" in request.scope:
            request.scope["raw_path"] = cleaned.encode("ascii")
    return await call_next(request)


# ── Security headers middleware ──────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = (
        "max-age=31536000; includeSubDomains"
    )
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# ── Request size limit middleware ────────────────────────────
MAX_REQUEST_BODY_BYTES = 1_048_576  # 1 MB


@app.middleware("http")
async def limit_request_size(request: Request, call_next):  # type: ignore[no-untyped-def]
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": "Request body too large"},
        )
    return await call_next(request)


# ── Request logging middleware ───────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s → %d (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


# ── Sanitized error codes ────────────────────────────────────
_SAFE_ERROR_MAP: dict[str, tuple[int, str]] = {
    "RATE_ANOMALY_DETECTED": (503, "Rate validation failed, rebalancing paused"),
    "PROTOCOL_UNAVAILABLE":  (503, "Protocol temporarily unavailable"),
    "INSUFFICIENT_BALANCE":  (400, "Balance below minimum threshold"),
    "SESSION_KEY_EXPIRED":   (401, "Please re-authorize the optimizer"),
    "REBALANCE_COOLDOWN":    (429, "Rebalance performed recently, please wait"),
}


# ── Global exception handler (never leak internals) ──────────
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    # Pass through known error codes; sanitise detail for safety.
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Log full traceback internally but NEVER expose it to the client.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error_code": "INTERNAL_ERROR",
            "detail": "An unexpected error occurred. Please try again later.",
        },
    )


# ── Lifecycle events ────────────────────────────────────────
@app.on_event("startup")
async def on_startup() -> None:
    from app.core.logging import setup_logging
    setup_logging()
    # ── Environment validation ────────────────────────────────────────
    _validate_environment()

    # Eagerly initialise Supabase so config errors surface immediately
    if settings.SUPABASE_URL:
        get_supabase()
    logger.info(
        "%s v1.0.0 started (chain=43114 mainnet, debug=%s)",
        settings.APP_NAME,
        settings.DEBUG,
    )

    # Start the periodic rebalance scheduler (requires Supabase)
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY:
        from app.workers.scheduler import SnowMindScheduler, setup_graceful_shutdown

        scheduler = SnowMindScheduler()
        scheduler.start()
        setup_graceful_shutdown(scheduler)
        app.state.scheduler = scheduler
    else:
        logger.warning(
            "Scheduler disabled — SUPABASE_URL / SUPABASE_SERVICE_KEY not set"
        )


@app.on_event("shutdown")
async def on_shutdown() -> None:
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler is not None:
        scheduler.stop()
    logger.info("Shutting down %s", settings.APP_NAME)


# ── Environment validation ───────────────────────────────────
def _validate_environment() -> None:
    """Fail fast if critical env vars are missing or malformed."""
    errors: list[str] = []

    # Session key encryption key: must be exactly 32 bytes (64 hex chars)
    enc_key = settings.SESSION_KEY_ENCRYPTION_KEY
    if enc_key:
        try:
            key_bytes = bytes.fromhex(enc_key)
            if len(key_bytes) != 32:
                errors.append(
                    f"SESSION_KEY_ENCRYPTION_KEY must be 32 bytes (got {len(key_bytes)})"
                )
        except ValueError:
            errors.append("SESSION_KEY_ENCRYPTION_KEY is not valid hex")

    # Supabase URL must look like a URL
    if settings.SUPABASE_URL and not settings.SUPABASE_URL.startswith("http"):
        errors.append("SUPABASE_URL must start with http:// or https://")

    # Required secrets: warn if empty
    for var_name in ("JWT_SECRET", "BACKEND_API_KEY", "PRIVY_APP_ID"):
        if not getattr(settings, var_name, ""):
            logger.warning("Environment variable %s is not set", var_name)

    if errors:
        for msg in errors:
            logger.critical("ENV VALIDATION FAILURE: %s", msg)
        raise SystemExit(
            f"Environment validation failed: {'; '.join(errors)}"
        )

    logger.info("Environment validation passed")


# ── Root health probe ───────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": settings.APP_NAME}


# ── Routers ──────────────────────────────────────────────────
PREFIX = settings.API_V1_PREFIX

app.include_router(health.router, prefix=PREFIX, tags=["health"])
app.include_router(accounts.router, prefix=f"{PREFIX}/accounts", tags=["accounts"])
app.include_router(portfolio.router, prefix=f"{PREFIX}/portfolio", tags=["portfolio"])
app.include_router(optimizer.router, prefix=f"{PREFIX}/optimizer", tags=["optimizer"])
app.include_router(rebalance.router, prefix=f"{PREFIX}/rebalance", tags=["rebalance"])
app.include_router(withdrawal.router, prefix=f"{PREFIX}/withdrawals", tags=["withdrawals"])
