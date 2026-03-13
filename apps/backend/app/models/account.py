from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.base import CamelModel


# ── Enums ────────────────────────────────────────────


class DiversificationPref(str, Enum):
    MAX_YIELD = "max_yield"
    BALANCED = "balanced"
    DIVERSIFIED = "diversified"


# ── Request models ──────────────────────────────────────────


class AccountCreate(BaseModel):
    address: str = Field(..., description="Checksummed smart-account address")
    owner_address: str = Field(..., description="Checksummed EOA owner address")
    diversification_preference: DiversificationPref = DiversificationPref.BALANCED


class SessionKeyCreate(BaseModel):
    account_id: UUID
    key_address: str
    serialized_permission: str
    expires_at: datetime
    allowed_protocols: list[str]
    max_amount_per_tx: str = Field(..., description="BigInt as string")


# ── Response models ─────────────────────────────────────────


class AccountResponse(CamelModel):
    id: UUID
    address: str
    owner_address: str
    is_active: bool
    created_at: datetime
    diversification_preference: DiversificationPref = DiversificationPref.BALANCED


class SessionKeyStatusResponse(CamelModel):
    key_address: str
    is_active: bool
    expires_at: datetime
    allowed_protocols: list[str]
    max_amount_per_tx: str
    created_at: datetime


class AccountDetailResponse(AccountResponse):
    session_key: SessionKeyStatusResponse | None = None
