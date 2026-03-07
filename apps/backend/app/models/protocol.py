from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class ProtocolRate(BaseModel):
    """A single rate snapshot from on-chain or DefiLlama."""
    protocol_id: str
    apy: Decimal
    tvl_usd: Decimal | None = None
    utilization_rate: float | None = None  # not financial, stays float
    fetched_at: datetime


class ProtocolConfig(BaseModel):
    """Static protocol metadata used by the optimizer."""
    protocol_id: str
    name: str
    contract_address: str
    min_allocation: Decimal  # USD
    max_allocation: Decimal  # fraction (0.0-1.0)
    risk_score: Decimal
    is_active: bool = True
