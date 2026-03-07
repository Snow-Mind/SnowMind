from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

RebalanceStatus = Literal["executed", "skipped", "failed"]


class RebalanceLog(BaseModel):
    """Full DB row representation."""
    id: UUID
    account_id: UUID
    status: RebalanceStatus
    skip_reason: str | None = None
    proposed_allocations: dict[str, Any] | None = None
    executed_allocations: dict[str, Any] | None = None
    apr_improvement: Decimal | None = None
    gas_cost_usd: Decimal | None = None
    tx_hash: str | None = None
    error_message: str | None = None
    created_at: datetime


class RebalanceLogResponse(BaseModel):
    """Subset for frontend consumption."""
    id: UUID
    status: RebalanceStatus
    proposed_allocations: dict[str, Any] | None = None
    executed_allocations: dict[str, Any] | None = None
    apr_improvement: float | None = None
    gas_cost_usd: float | None = None
    tx_hash: str | None = None
    created_at: datetime


class RebalanceHistoryResponse(BaseModel):
    logs: list[RebalanceLogResponse]
    total: int
