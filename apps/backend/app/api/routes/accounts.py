"""Account registration, lookup, and session-key management."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth
from app.core.validators import validate_eth_address
from app.models.account import (
    AccountDetailResponse,
    AccountResponse,
    SessionKeyStatusResponse,
)
from app.services.execution.session_key import (
    revoke_session_key,
    store_session_key,
)

logger = logging.getLogger("snowmind")

router = APIRouter(dependencies=[Depends(require_privy_auth)])


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


# ── POST /accounts  AND  /accounts/register ───────────────

async def _do_register(
    req: RegisterAccountRequest,
    db: Client,
) -> AccountResponse:
    """Shared implementation for both registration endpoints."""
    address = validate_eth_address(req.resolved_address())
    owner_address = validate_eth_address(req.resolved_owner())
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

    # Optionally store session key
    if req.session_key_data:
        store_session_key(db, account["id"], req.session_key_data)

    return AccountResponse(
        id=account["id"],
        address=account["address"],
        owner_address=account["owner_address"],
        is_active=account["is_active"],
        created_at=account["created_at"],
    )


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
):
    """Register a new smart account (and optionally store its session key)."""
    return await _do_register(req, db)


@router.post("/register", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account_alias(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
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
        raise HTTPException(status_code=404, detail="Account not found")

    row = acct.data[0]

    # Fetch latest active session key metadata (not the encrypted key itself)
    now_iso = datetime.now(timezone.utc).isoformat()
    sk = (
        db.table("session_keys")
        .select("key_address, is_active, expires_at, allowed_protocols, max_amount_per_tx, created_at")
        .eq("account_id", row["id"])
        .eq("is_active", True)
        .gte("expires_at", now_iso)
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
):
    """Revoke (deactivate) the active session key for an account."""
    return await _do_revoke(address, db)


@router.post("/{address}/session-key/revoke")
@limiter.limit("10/minute")
async def revoke_account_session_key_post(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
):
    """POST alias for session-key revocation (frontend compat)."""
    return await _do_revoke(address, db)


# ── PUT /accounts/{address}/risk-profile ─────────────────

LAMBDA_MAP = {"conservative": 0.8, "moderate": 0.5, "aggressive": 0.2}


class RiskProfileRequest(BaseModel):
    risk_tolerance: Literal["conservative", "moderate", "aggressive"]


@router.put("/{address}/risk-profile")
@limiter.limit("20/minute")
async def update_risk_profile(
    request: Request,
    address: str,
    req: RiskProfileRequest,
    db: Client = Depends(get_db),
):
    """Update the risk tolerance for an account."""
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
            "risk_tolerance": req.risk_tolerance,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", acct.data[0]["id"]).execute()

    return {
        "riskTolerance": req.risk_tolerance,
        "lambdaValue": LAMBDA_MAP[req.risk_tolerance],
    }
