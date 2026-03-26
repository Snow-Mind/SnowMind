"""Account registration, lookup, and session-key management."""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.core.validators import validate_eth_address
from app.models.account import (
    AccountDetailResponse,
    AccountResponse,
    DiversificationPref,
    SessionKeyStatusResponse,
)
from app.services.execution.session_key import (
    revoke_session_key,
    store_session_key,
)


logger = logging.getLogger("snowmind")

router = APIRouter()  # Auth applied per-endpoint


# ── Request body ───────────────────────────────────────────

class RegisterAccountRequest(BaseModel):
    # Accept BOTH camelCase (frontend) and snake_case (direct callers)
    address: str | None = Field(None, alias="smartAccountAddress", description="Smart-account address")
    owner_address: str | None = Field(None, alias="ownerAddress", description="EOA owner")

    # Also allow snake_case direct fields
    smart_account_address: str | None = None

    model_config = {"populate_by_name": True}

    def resolved_address(self) -> str:
        return self.address or self.smart_account_address or ""

    def resolved_owner(self) -> str:
        return self.owner_address or ""

    session_key_data: dict | None = Field(
        None,
        alias="sessionKeyData",
        description="Optional session-key blob to encrypt & store",
    )

    initial_allocation: dict | None = Field(
        None,
        alias="initialAllocation",
        description="Optional {protocolId: amountUsdc} from frontend initial deployment",
    )


# ── POST /accounts  AND  /accounts/register ───────────────

async def _do_register(
    req: RegisterAccountRequest,
    db: Client,
) -> AccountResponse:
    """Shared implementation for both registration endpoints."""
    address = validate_eth_address(req.resolved_address())
    owner_address = validate_eth_address(req.resolved_owner())

    # Guard: prevent overwriting an existing account's owner
    existing = (
        db.table("accounts")
        .select("owner_address")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if existing.data:
        existing_owner = existing.data[0].get("owner_address", "").lower()
        if existing_owner and existing_owner != owner_address.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already registered with a different owner",
            )

    # Upsert: if account already exists, just return it
    result = (
        db.table("accounts")
        .upsert(
            {
                "address": address,
                "owner_address": owner_address,
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="address",
        )
        .execute()
    )
    account = result.data[0]
    logger.info("Account registered/updated: %s", address)

    # Record initial allocation FIRST (idempotent, must not be blocked by
    # a session-key storage failure).
    if req.initial_allocation:
        from decimal import Decimal
        for protocol_id, amount_str in req.initial_allocation.items():
            try:
                amount = Decimal(str(amount_str))
                if amount > Decimal("0.01"):
                    db.table("allocations").upsert(
                        {
                            "account_id": account["id"],
                            "protocol_id": protocol_id,
                            "amount_usdc": str(amount.quantize(Decimal("0.000001"))),
                        },
                        on_conflict="account_id,protocol_id",
                    ).execute()
                    logger.info("Initial allocation: %s/%s = $%s", address, protocol_id, amount)
            except Exception as exc:
                logger.warning("Failed to record allocation %s/%s: %s", address, protocol_id, exc)

    # Store session key (may fail on KMS/encryption — non-fatal for account
    # creation since the user can re-grant from the dashboard).
    # force=True because re-running onboarding means the user explicitly wants
    # the new session key to replace any old one (the old one's enable signature
    # may be invalid after a signing fix deployment).
    session_key_stored = False
    if req.session_key_data:
        try:
            store_session_key(db, account["id"], req.session_key_data, force=True)
            session_key_stored = True
        except Exception as exc:
            logger.error(
                "Session key storage failed for %s (user can re-grant): %s",
                address, exc,
            )

    # Fire-and-forget: trigger immediate rebalance so idle USDC gets deployed
    if session_key_stored:
        asyncio.create_task(_trigger_initial_rebalance(account["id"], address))

    return AccountResponse(
        id=account["id"],
        address=account["address"],
        owner_address=account["owner_address"],
        is_active=account["is_active"],
        created_at=account["created_at"],
        diversification_preference=account.get("diversification_preference", "balanced"),
    )


# Per-account lock to prevent concurrent rebalance triggers.
# Maps account_id → asyncio.Lock. If a rebalance is already in flight
# for an account, subsequent triggers wait (or skip) rather than
# submitting duplicate UserOps to the bundler.
_rebalance_locks: dict[str, asyncio.Lock] = {}


async def _trigger_initial_rebalance(account_id: str, address: str) -> None:
    """Best-effort immediate rebalance after registration.

    Runs as a fire-and-forget task so the registration response is not delayed.
    Retries up to 3 times with exponential backoff (5s, 15s, 45s).
    If all retries fail (e.g. funds already deployed from frontend), the cron
    scheduler will pick it up on its next cycle.
    Uses a per-account lock to prevent duplicate concurrent submissions.
    """
    await asyncio.sleep(5)  # Wait for session key to fully propagate

    # Acquire per-account lock — if another rebalance is already running, skip
    lock = _rebalance_locks.setdefault(account_id, asyncio.Lock())
    if lock.locked():
        logger.info("Initial rebalance for %s skipped — another attempt in flight", address)
        return

    async with lock:
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                from app.services.optimizer.rebalancer import Rebalancer
                rebalancer = Rebalancer()
                result = await rebalancer.check_and_rebalance(account_id, address)
                res_status = result.get("status", "unknown")
                logger.info(
                    "Initial rebalance for %s attempt %d/%d: %s",
                    address, attempt, max_retries, res_status,
                )
                # Success or "no action needed" (funds already deployed from frontend)
                return
            except Exception as exc:
                exc_msg = str(exc)
                # Non-retryable errors: duplicate permissionHash, user must re-grant
                if "duplicate permissionhash" in exc_msg.lower():
                    logger.warning(
                        "Initial rebalance for %s: duplicate permissionHash — "
                        "funds may already be deployed from frontend, stopping retries.",
                        address,
                    )
                    return
                if attempt < max_retries:
                    delay = 5 * (3 ** (attempt - 1))  # 5s, 15s, 45s
                    logger.warning(
                        "Initial rebalance attempt %d/%d failed for %s: %s — retrying in %ds",
                        attempt, max_retries, address, exc_msg[:200], delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.warning(
                        "Initial rebalance failed for %s after %d attempts (cron will retry): %s",
                        address, max_retries, exc_msg[:200],
                    )


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Register a new smart account (and optionally store its session key)."""
    return await _do_register(req, db)


@router.post("/register", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account_alias(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Alias of POST /accounts for frontend compatibility."""
    return await _do_register(req, db)


# ── GET /accounts/{address} ───────────────────────────────

@router.get("/{address}", response_model=AccountDetailResponse)
@limiter.limit("60/minute")
async def get_account(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Get account info including current session-key status."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("*")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        # Return a minimal stub so the frontend doesn't 404-loop
        # before registration completes
        return AccountDetailResponse(
            id="",
            address=address,
            owner_address="",
            is_active=False,
            created_at=datetime.now(timezone.utc).isoformat(),
            diversification_preference="balanced",
            session_key=None,
        )

    row = acct.data[0]

    # Fetch latest active session key metadata (not the encrypted key itself)
    now_z = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sk = (
        db.table("session_keys")
        .select("key_address, is_active, expires_at, allowed_protocols, max_amount_per_tx, created_at")
        .eq("account_id", row["id"])
        .eq("is_active", True)
        .gte("expires_at", now_z)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    sk_resp = None
    if sk.data:
        s = sk.data[0]
        sk_resp = SessionKeyStatusResponse(
            key_address=s["key_address"],
            is_active=s["is_active"],
            expires_at=s["expires_at"],
            allowed_protocols=s["allowed_protocols"],
            max_amount_per_tx=s["max_amount_per_tx"],
            created_at=s["created_at"],
        )

    return AccountDetailResponse(
        id=row["id"],
        address=row["address"],
        owner_address=row["owner_address"],
        is_active=row["is_active"],
        created_at=row["created_at"],
        diversification_preference=row.get("diversification_preference", "balanced"),
        session_key=sk_resp,
    )


# ── DELETE / POST /accounts/{address}/session-key ────────

async def _do_revoke(address: str, db: Client) -> dict:
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    count = revoke_session_key(db, acct.data[0]["id"])
    return {"revoked": count, "success": True}


@router.delete("/{address}/session-key")
@limiter.limit("10/minute")
async def revoke_account_session_key(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Revoke (deactivate) the active session key for an account."""
    return await _do_revoke(address, db)


@router.post("/{address}/session-key/revoke")
@limiter.limit("10/minute")
async def revoke_account_session_key_post(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """POST alias for session-key revocation (frontend compat)."""
    return await _do_revoke(address, db)


# ── POST /accounts/{address}/session-key ── store/renew ──


class StoreSessionKeyRequest(BaseModel):
    """Request body for storing a session key (used for retry/renewal)."""
    serialized_permission: str = Field(..., alias="serializedPermission")
    session_private_key: str = Field("", alias="sessionPrivateKey")
    session_key_address: str = Field(..., alias="sessionKeyAddress")
    expires_at: int | str = Field(..., alias="expiresAt")
    allowed_protocols: list[str] | None = Field(None, alias="allowedProtocols")
    force: bool = Field(False, description="Bypass renewal guard and always store the new session key")
    owner_address: str | None = Field(
        None,
        alias="ownerAddress",
        description="EOA owner address — required to auto-register missing accounts",
    )
    initial_allocation: dict | None = Field(
        None,
        alias="initialAllocation",
        description="Optional: {protocolId: amountUsdc} to seed allocations table",
    )
    model_config = {"populate_by_name": True}


@router.post("/{address}/session-key")
@limiter.limit("10/minute")
async def store_account_session_key(
    request: Request,
    address: str,
    req: StoreSessionKeyRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Store or renew a session key for an existing account.

    Also optionally records the initial allocation so the rebalancer
    can see existing on-chain positions from frontend deployment.
    """
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, is_active")
        .eq("address", address)
        .limit(1)
        .execute()
    )

    if acct.data:
        account_id = acct.data[0]["id"]
        # Auto-reactivate if deactivated (e.g. after emergency withdrawal)
        if not acct.data[0].get("is_active", True):
            db.table("accounts").update({
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", account_id).execute()
            logger.info("Account %s reactivated via session-key store", address)
    elif req.owner_address:
        # Account doesn't exist — auto-register if owner_address is provided.
        # This handles the case where a full withdrawal deleted the row
        # and the user re-grants from the dashboard.
        owner_addr = validate_eth_address(req.owner_address)
        result = (
            db.table("accounts")
            .upsert(
                {
                    "address": address,
                    "owner_address": owner_addr,
                    "is_active": True,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="address",
            )
            .execute()
        )
        account_id = result.data[0]["id"]
        logger.info("Account %s auto-registered via session-key store (owner=%s)", address, owner_addr)
    else:
        raise HTTPException(status_code=404, detail="Account not found")

    # Store session key
    session_key_data = {
        "serializedPermission": req.serialized_permission,
        "sessionPrivateKey": req.session_private_key,
        "sessionKeyAddress": req.session_key_address,
        "expiresAt": req.expires_at,
        "allowedProtocols": req.allowed_protocols or ["aave_v3", "benqi", "spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"],
    }
    try:
        key_id = store_session_key(db, account_id, session_key_data, force=req.force)
    except ValueError as exc:
        # Renewal guard: active key still has >24h remaining — this is OK
        if "Renewal not needed" in str(exc) or "remaining" in str(exc):
            logger.info("Session key store skipped for %s: %s", address, exc)
            return {"success": True, "keyId": "", "message": str(exc)}
        raise HTTPException(status_code=400, detail=str(exc))
    logger.info("Session key stored via /session-key endpoint for %s (key_id=%s)", address, key_id)

    # Trigger immediate rebalance so idle USDC gets deployed right away
    # (same as register endpoint). The per-account lock prevents duplicates.
    asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    # Optionally record initial allocation
    if req.initial_allocation:
        for protocol_id, amount_str in req.initial_allocation.items():
            try:
                from decimal import Decimal
                amount = Decimal(str(amount_str))
                if amount > Decimal("0.01"):
                    db.table("allocations").upsert(
                        {
                            "account_id": account_id,
                            "protocol_id": protocol_id,
                            "amount_usdc": str(amount.quantize(Decimal("0.000001"))),
                        },
                        on_conflict="account_id,protocol_id",
                    ).execute()
                    logger.info(
                        "Initial allocation recorded: %s/%s = $%s",
                        address, protocol_id, amount,
                    )
            except Exception as exc:
                logger.warning("Failed to record allocation %s/%s: %s", address, protocol_id, exc)

    # NOTE: Do NOT trigger rebalance here. The register endpoint already fires
    # _trigger_initial_rebalance when the session key is stored inline. Firing
    # here as well causes TWO concurrent rebalance attempts that submit
    # identical UserOps to the bundler → "duplicate permissionHash" AA23 revert.
    # The per-account lock in _trigger_initial_rebalance prevents the collision
    # if both endpoints fire — the second attempt will be skipped.
    asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    return {"success": True, "keyId": key_id}


# ── PUT /accounts/{address}/diversification-preference ────


class DiversificationPreferenceRequest(BaseModel):
    diversification_preference: DiversificationPref = Field(
        ..., alias="diversificationPreference",
    )
    model_config = {"populate_by_name": True}


@router.put("/{address}/diversification-preference")
@limiter.limit("20/minute")
async def update_diversification_preference(
    request: Request,
    address: str,
    req: DiversificationPreferenceRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Update the diversification preference for an account."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")

    db.table("accounts").update(
        {
            "diversification_preference": req.diversification_preference.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", acct.data[0]["id"]).execute()

    return {
        "diversificationPreference": req.diversification_preference.value,
    }

