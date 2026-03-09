from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.base import CamelModel

ProtocolId = Literal["benqi", "aave_v3", "euler_v2"]


class AllocationRecord(BaseModel):
    """Maps 1-to-1 with the *allocations* table."""
    account_id: UUID
    protocol_id: ProtocolId
    amount_usdc: Decimal = Field(..., ge=0)
    allocation_pct: Decimal = Field(..., ge=0, le=1)
    apy_at_allocation: Decimal | None = None


class AllocationResponse(CamelModel):
    """Subset returned to the frontend."""
    protocol_id: str
    name: str
    amount_usdc: Decimal
    allocation_pct: Decimal
    current_apy: Decimal


class PortfolioResponse(CamelModel):
    total_deposited_usd: Decimal
    total_yield_usd: Decimal
    allocations: list[AllocationResponse]
    last_rebalance_at: datetime | None = None
