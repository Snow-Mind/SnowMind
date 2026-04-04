"""
Abstract base for protocol adapters.

Every protocol adapter MUST implement the full interface.
All financial math uses Python Decimal — never float.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
import time
from typing import Any


def get_shared_async_web3():
    """Backward-compatible helper for legacy call sites."""
    from app.core.rpc import get_web3
    return get_web3()


# ── Typed Results ────────────────────────────────────────────────────────────

class ProtocolStatus(Enum):
    """Protocol health status."""
    HEALTHY = "healthy"
    HIGH_UTILIZATION = "high_utilization"   # >90% — exclude from new deposits only
    DEPOSITS_DISABLED = "deposits_disabled"  # Admin/protocol paused deposits
    WITHDRAWALS_DISABLED = "withdrawals_disabled"  # Admin paused withdrawals
    EMERGENCY = "emergency"                  # vat.live != 1, etc.
    EXCLUDED = "excluded"                    # Circuit breaker or other exclusion


@dataclass
class ProtocolRate:
    """Live rate snapshot for a single protocol."""
    protocol_id: str
    apy: Decimal               # Raw (gross) APY
    effective_apy: Decimal     # After adjustments (Spark: ×0.90 - PSM fee)
    tvl_usd: Decimal
    utilization_rate: Decimal | None = None
    fetched_at: float = field(default_factory=time.time)


@dataclass
class ProtocolHealth:
    """Health check result for a single protocol."""
    protocol_id: str
    status: ProtocolStatus
    is_deposit_safe: bool       # Can we deposit new funds?
    is_withdrawal_safe: bool    # Can we withdraw existing funds?
    utilization: Decimal | None = None
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class TransactionCalldata:
    """Ready-to-submit call for inclusion in a UserOp batch."""
    to: str        # contract address
    data: str      # hex-encoded calldata with 0x prefix
    value: int = 0  # native token value in wei


class BaseProtocolAdapter(ABC):
    """
    Interface every lending-protocol adapter must implement.

    Each adapter provides:
      - Rate reading (APY, TVL)
      - Health checking (pause flags, utilization, protocol-specific safety)
      - Balance reading
      - Calldata building (supply/deposit, withdraw/redeem)
    """

    protocol_id: str = ""
    name: str = ""

    @abstractmethod
    async def get_rate(self) -> ProtocolRate:
        """Return live supply APY, effective APY, and metadata."""
        ...

    @abstractmethod
    async def get_health(self) -> ProtocolHealth:
        """
        Run protocol-specific health checks.

        For Aave/Benqi: reserve flags, comptroller flags, utilization.
        For Spark: vault liquidity (maxWithdraw), PSM3 totalAssets.
        """
        ...

    @abstractmethod
    async def get_balance(self, user_address: str) -> int:
        """Return the user's deposited balance in USDC base units (6 decimals)."""
        ...

    async def get_user_balance(self, user_address: str, asset: str | None = None) -> int:
        """Backward-compatible alias retained for legacy consumers."""
        return await self.get_balance(user_address)

    async def get_utilization(self) -> Decimal | None:
        """Return protocol utilization when available.

        Concrete adapters can override this with cheaper RPC paths.
        """
        health = await self.get_health()
        return health.utilization

    @abstractmethod
    async def get_shares(self, user_address: str) -> int:
        """
        Return the user's share/token balance (for share-based redemption).

        For Aave: aToken balance (same as USDC amount due to 1:1 peg)
        For Benqi: qiToken balance (NOT underlying USDC)
        For Spark: spUSDC share balance (NOT underlying USDC)
        """
        ...

    @abstractmethod
    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """Encode a supply / deposit call."""
        ...

    @abstractmethod
    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """Encode a withdraw / redeem call."""
        ...


# Backward-compat alias
ProtocolAdapter = BaseProtocolAdapter
