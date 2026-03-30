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
        issuers = ("privy.io", "https://auth.privy.io")
        last_err: Exception | None = None

        for issuer in issuers:
            try:
                payload = jwt.decode(
                    token,
                    jwks,
                    algorithms=["ES256"],
                    audience=s.PRIVY_APP_ID,
                    issuer=issuer,
                )
                return payload
            except JWTError as exc:
                last_err = exc
                continue

        if last_err is not None:
            try:
                claims = jwt.get_unverified_claims(token)
                logger.warning(
                    "Privy token rejected (iss=%s aud=%s expected_aud=%s): %s",
                    claims.get("iss"),
                    claims.get("aud"),
                    s.PRIVY_APP_ID,
                    last_err,
                )
            except Exception:
                logger.debug("Privy token rejected; unable to decode unverified claims")
        return None
    except (JWTError, httpx.HTTPError) as exc:
        logger.debug("Privy token verification failed: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error verifying Privy token: %s", exc)
        return None


async def require_privy_auth(
    authorization: str | None = Header(None),
) -> dict:
    """FastAPI dependency for user-facing routes (Privy token only).

    Returns Privy claims with at minimum ``sub`` (Privy DID).
    """
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            payload = await verify_privy_token(token)
            if payload:
                return payload

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication",
    )


async def require_service_auth(
    x_api_key: str | None = Header(None, alias="X-API-Key"),
) -> dict:
    """FastAPI dependency for service-to-service routes (API key only)."""
    if not x_api_key or not verify_api_key(x_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
    return {"sub": "service", "type": "api_key"}


def _normalize_eth_address(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    if candidate.startswith("0x") and len(candidate) == 42:
        return candidate
    return None


def _extract_wallet_addresses(auth_claims: dict) -> set[str]:
    """Extract wallet addresses from common Privy claim shapes."""
    wallets: set[str] = set()

    for key in ("wallet_address", "walletAddress", "address"):
        normalized = _normalize_eth_address(auth_claims.get(key))
        if normalized:
            wallets.add(normalized)

    for list_key in ("linked_accounts", "linkedAccounts", "accounts"):
        entries = auth_claims.get(list_key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            entry_type = str(entry.get("type", "")).lower()
            if entry_type and "wallet" not in entry_type and entry_type not in {"eoa", "ethereum"}:
                continue

            normalized = _normalize_eth_address(
                entry.get("address")
                or entry.get("wallet_address")
                or entry.get("walletAddress")
            )
            if normalized:
                wallets.add(normalized)

    return wallets


def assert_owner_matches_claims(auth_claims: dict, owner_address: str) -> None:
    """Ensure the authenticated token contains the account owner wallet."""
    normalized_owner = _normalize_eth_address(owner_address)
    if not normalized_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account owner metadata is invalid",
        )

    wallets = _extract_wallet_addresses(auth_claims)
    if not wallets:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated token missing wallet identity",
        )

    if normalized_owner not in wallets:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated wallet does not match account owner",
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

    Raises ``HTTPException(403)`` on mismatch.
    """
    caller_did = auth_claims.get("sub", "")
    if not caller_did:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication identity",
        )

    stored_did = account.get("privy_did")
    owner_address = account.get("owner_address", "")

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

        # If wallet claims are present, enforce owner-wallet match.
        # Some valid Privy access tokens can omit linked wallet claims; for
        # DID-matched accounts, we allow those tokens to proceed.
        wallets = _extract_wallet_addresses(auth_claims)
        if wallets:
            normalized_owner = _normalize_eth_address(owner_address)
            if not normalized_owner:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account owner metadata is invalid",
                )
            if normalized_owner not in wallets:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Authenticated wallet does not match account owner",
                )
        else:
            logger.debug(
                "Privy token for DID %s has no wallet claims; using DID ownership for account %s",
                caller_did,
                account.get("address", "?"),
            )
        return

    # Legacy accounts with no stored DID must still prove wallet ownership.
    assert_owner_matches_claims(auth_claims, owner_address)

    # Legacy account with missing DID: backfill only after owner-wallet check.
    if not stored_did and db is not None:
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
