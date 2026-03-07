from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# ── Request models ──────────────────────────────────────────


class AccountCreate(BaseModel):
    address: str = Field(..., description="Checksummed smart-account address")
    owner_address: str = Field(..., description="Checksummed EOA owner address")


class SessionKeyCreate(BaseModel):
    account_id: UUID
    key_address: str
    serialized_permission: str
    expires_at: datetime
    allowed_protocols: list[str]
    max_amount_per_tx: str = Field(..., description="BigInt as string")


# ── Response models ─────────────────────────────────────────


class AccountResponse(BaseModel):
    id: UUID
    address: str
    owner_address: str
    is_active: bool
    created_at: datetime


class SessionKeyStatusResponse(BaseModel):
    key_address: str
    is_active: bool
    expires_at: datetime
    allowed_protocols: list[str]
    max_amount_per_tx: str
    created_at: datetime


class AccountDetailResponse(AccountResponse):
    session_key: SessionKeyStatusResponse | None = None
