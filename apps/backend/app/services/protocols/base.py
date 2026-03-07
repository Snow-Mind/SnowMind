"""Abstract base for protocol adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
import time


@dataclass
class ProtocolRate:
    """Live rate snapshot for a single protocol."""

    protocol_id: str
    apy: Decimal
    tvl_usd: Decimal
    utilization_rate: Decimal | None = None
    fetched_at: float = field(default_factory=time.time)


@dataclass
class TransactionCalldata:
    """Ready-to-submit call for inclusion in a UserOp batch."""

    to: str        # contract address
    data: str      # hex-encoded calldata with 0x prefix
    value: int = 0 # native token value in wei


class BaseProtocolAdapter(ABC):
    """Interface every lending-protocol adapter must implement."""

    protocol_id: str = ""
    name: str = ""

    @abstractmethod
    async def get_rate(self) -> ProtocolRate:
        """Return live supply APY + metadata."""
        ...

    @abstractmethod
    def build_supply_calldata(
        self, asset: str, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """Encode a supply / deposit call."""
        ...

    @abstractmethod
    def build_withdraw_calldata(
        self, asset: str, amount: int, to: str
    ) -> TransactionCalldata:
        """Encode a withdraw / redeem call."""
        ...

    @abstractmethod
    async def get_user_balance(self, user_address: str, asset: str) -> int:
        """Return the user's deposited balance (in token's smallest unit)."""
        ...


# Backward-compat alias
ProtocolAdapter = BaseProtocolAdapter
