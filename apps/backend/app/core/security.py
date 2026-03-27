"""Authentication, authorisation, and rate-limiting primitives."""

import hmac
import logging
import time
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import httpx
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


# ── Privy auth (user-facing endpoints) ──────────────────────

_privy_jwks_cache: dict | None = None
_privy_jwks_last_fetch: float = 0.0
_PRIVY_JWKS_CACHE_TTL = 3600  # 1 hour


async def _fetch_privy_jwks(app_id: str) -> dict:
    """Fetch and cache Privy's JWKS for token verification."""
    global _privy_jwks_cache, _privy_jwks_last_fetch

    now = time.time()
    if _privy_jwks_cache and (now - _privy_jwks_last_fetch) < _PRIVY_JWKS_CACHE_TTL:
        return _privy_jwks_cache

    url = f"https://auth.privy.io/api/v1/apps/{app_id}/.well-known/jwks.json"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
        _privy_jwks_cache = resp.json()
        _privy_jwks_last_fetch = now
        logger.info("Refreshed Privy JWKS cache")
        return _privy_jwks_cache


async def verify_privy_token(token: str) -> dict | None:
    """Verify a Privy-issued access token and return decoded claims.

    Returns None on any failure (invalid signature, expired, wrong audience).
    """
    s = get_settings()
    if not s.PRIVY_APP_ID:
        return None

    try:
        jwks = await _fetch_privy_jwks(s.PRIVY_APP_ID)
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["ES256"],
            audience=s.PRIVY_APP_ID,
            issuer="privy.io",
        )
        return payload
    except (JWTError, httpx.HTTPError) as exc:
        logger.debug("Privy token verification failed: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error verifying Privy token: %s", exc)
        return None


async def require_privy_auth(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> dict:
    """FastAPI dependency — verifies Privy auth token or API key fallback.

    Returns a claims dict with at minimum ``sub`` (Privy DID or "service").

    Priority:
      1. Privy Bearer token (per-user auth — recommended)
      2. API key (service-to-service / backward compat)
    """
    # 1. Try Privy token
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            payload = await verify_privy_token(token)
            if payload:
                return payload

    # 2. Fall back to shared API key
    if x_api_key and verify_api_key(x_api_key):
        return {"sub": "service", "type": "api_key"}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication",
    )


# ── Account ownership verification ──────────────────────────


def verify_account_ownership(
    auth_claims: dict,
    account: dict,
    *,
    db=None,
) -> None:
    """Verify the authenticated user owns the requested account.

    Compares the Privy DID (``auth_claims["sub"]``) against the account's
    stored ``privy_did``. If unknown (legacy account), backfills it on
    first authenticated access.

    Service-to-service calls (``sub == "service"``) bypass the check.

    Raises ``HTTPException(403)`` on mismatch.
    """
    caller_did = auth_claims.get("sub", "")
    if not caller_did:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication identity",
        )

    # Service-to-service (API key) calls are trusted
    if caller_did == "service":
        return

    stored_did = account.get("privy_did")

    if stored_did:
        # DID stored — strict match required
        if stored_did != caller_did:
            logger.warning(
                "Authorization denied: caller DID %s != account DID %s for account %s",
                caller_did, stored_did, account.get("address", "?"),
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not own this account",
            )
    else:
        # Legacy account: no DID stored yet — backfill on first access.
        # This is safe because (a) only the wallet owner can sign the
        # Privy challenge to obtain a JWT, and (b) we trust the first
        # authenticated request after migration.
        if db is not None:
            account_id = account.get("id", "")
            try:
                db.table("accounts").update(
                    {"privy_did": caller_did}
                ).eq("id", str(account_id)).execute()
                logger.info(
                    "Backfilled privy_did=%s for account %s",
                    caller_did, account.get("address", "?"),
                )
            except Exception as exc:
                logger.warning("Failed to backfill privy_did: %s", exc)


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
