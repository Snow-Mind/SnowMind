"""Authentication, authorisation, and rate-limiting primitives."""

from __future__ import annotations

import hmac
import logging
import time
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException, Request, status
from jose import JWTError, jwt

from app.core.config import get_settings

logger = logging.getLogger("snowmind")


# ── API-key auth ────────────────────────────────────────────


def verify_api_key(api_key: str) -> bool:
    """Constant-time comparison against the configured backend API key."""
    expected = get_settings().BACKEND_API_KEY
    if not expected:
        return False
    return hmac.compare_digest(api_key, expected)


async def require_api_key(
    x_api_key: str = Header(..., alias="X-API-Key"),
) -> str:
    """FastAPI dependency — raises 401 if the key is missing or wrong."""
    if not verify_api_key(x_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    return x_api_key


# ── JWT auth ────────────────────────────────────────────────

_JWT_EXPIRY_HOURS = 24


def create_jwt(payload: dict) -> str:
    """Create a signed JWT with a 24-hour expiry."""
    s = get_settings()
    to_encode = payload.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(hours=_JWT_EXPIRY_HOURS)
    to_encode["iat"] = datetime.now(timezone.utc)
    return jwt.encode(to_encode, s.JWT_SECRET, algorithm=s.JWT_ALGORITHM)


def verify_jwt(token: str) -> dict | None:
    """Return the decoded payload, or ``None`` on invalid / expired tokens."""
    s = get_settings()
    try:
        return jwt.decode(token, s.JWT_SECRET, algorithms=[s.JWT_ALGORITHM])
    except JWTError:
        return None


async def require_jwt(
    authorization: str = Header(...),
) -> dict:
    """FastAPI dependency — parses ``Bearer <token>`` header."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header",
        )
    payload = verify_jwt(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    return payload


# ── In-memory sliding-window rate limiter ────────────────────


class RateLimiter:
    """Thread-safe sliding-window rate limiter (per-identifier).

    Post-MVP: replace with Redis for horizontal scaling.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._requests: dict[str, list[float]] = defaultdict(list)

    def is_allowed(
        self,
        identifier: str,
        max_requests: int,
        window_seconds: int,
    ) -> bool:
        """Return True if *identifier* may proceed.

        Prunes timestamps outside the sliding window and checks count.
        """
        now = time.time()
        cutoff = now - window_seconds

        with self._lock:
            timestamps = self._requests[identifier]
            # Prune expired entries
            self._requests[identifier] = timestamps = [
                t for t in timestamps if t > cutoff
            ]
            if len(timestamps) >= max_requests:
                return False
            timestamps.append(now)
            return True


# Module-level singleton
rate_limiter = RateLimiter()

# Limits from spec
_IP_MAX_PER_MINUTE = 100
_KEY_MAX_PER_HOUR = 1000


async def rate_limit_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
    """FastAPI middleware enforcing per-IP and per-API-key rate limits."""
    client_ip = request.client.host if request.client else "unknown"

    # Per-IP: 100 req / 60 s
    if not rate_limiter.is_allowed(f"ip:{client_ip}", _IP_MAX_PER_MINUTE, 60):
        logger.warning("Rate limit hit — IP %s", client_ip)
        return _rate_limit_response()

    # Per-API-key: 1000 req / 3600 s (only when key is present)
    api_key = request.headers.get("x-api-key")
    if api_key and not rate_limiter.is_allowed(
        f"key:{api_key}", _KEY_MAX_PER_HOUR, 3600
    ):
        logger.warning("Rate limit hit — API key (IP %s)", client_ip)
        return _rate_limit_response()

    return await call_next(request)


def _rate_limit_response():
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"error_code": "RATE_LIMITED", "detail": "Too many requests — please slow down"},
    )
