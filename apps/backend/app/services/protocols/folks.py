"""Folks Finance xChain adapter on Avalanche hub.

Folks is not ERC-4626 and not Aave-like. Deposits/withdrawals require
Account+Loan identifiers, so generic supply/withdraw calldata builders are
intentionally disabled to prevent unsafe call construction.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal

from app.core.config import get_settings
from .base import (
    BaseProtocolAdapter,
    ProtocolHealth,
    ProtocolRate,
    ProtocolStatus,
    TransactionCalldata,
    get_shared_async_web3,
)

logger = logging.getLogger("snowmind.protocols.folks")

_ONE = Decimal("1")
_ZERO = Decimal("0")
_ONE_USDC = Decimal("1000000")
_RATE_SCALE = Decimal("1e18")
_SECONDS_PER_HOUR = Decimal("3600")
_HOURS_PER_YEAR = 8760


# HubPool read ABI
FOLKS_HUB_POOL_ABI = [
    {
        "name": "getDepositData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "optimalUtilisationRatio", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "interestIndex", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getVariableBorrowData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "vr0", "type": "uint256"},
            {"name": "vr1", "type": "uint256"},
            {"name": "vr2", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "interestIndex", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getStableBorrowData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "sr0", "type": "uint256"},
            {"name": "sr1", "type": "uint256"},
            {"name": "sr2", "type": "uint256"},
            {"name": "sr3", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "averageInterestRate", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getConfigData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "deprecated", "type": "bool"},
            {"name": "stableBorrowSupported", "type": "bool"},
            {"name": "flashLoanSupported", "type": "bool"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "totalSupply",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]


class FolksAdapter(BaseProtocolAdapter):
    protocol_id = "folks"
    name = "Folks Finance xChain"

    def __init__(self) -> None:
        settings = get_settings()
        self.hub_pool_address = settings.FOLKS_USDC_HUB_POOL
        self.spoke_common_address = settings.FOLKS_SPOKE_COMMON
        self.spoke_usdc_address = settings.FOLKS_SPOKE_USDC

        if not self.hub_pool_address:
            raise ValueError("FOLKS_USDC_HUB_POOL not configured")

    def _get_w3(self):
        return get_shared_async_web3()

    def _get_hub_pool(self):
        w3 = self._get_w3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.hub_pool_address),
            abi=FOLKS_HUB_POOL_ABI,
        )

    @staticmethod
    def _compute_hourly_compounded_apy(rate_per_second: Decimal) -> Decimal:
        """Folks SDK-equivalent APY: (1 + r * 3600)^8760 - 1."""
        if rate_per_second <= _ZERO:
            return _ZERO
        hourly_factor = _ONE + (rate_per_second * _SECONDS_PER_HOUR)
        if hourly_factor <= _ZERO:
            return _ZERO
        return max((hourly_factor ** _HOURS_PER_YEAR) - _ONE, _ZERO)

    async def get_rate(self) -> ProtocolRate:
        pool = self._get_hub_pool()
        now = time.time()
        try:
            deposit_data = await pool.functions.getDepositData().call()
            variable_borrow_data = await pool.functions.getVariableBorrowData().call()
            stable_borrow_data = await pool.functions.getStableBorrowData().call()

            total_deposit_raw = int(deposit_data[1])
            deposit_rate_raw = int(deposit_data[2])
            variable_borrow_raw = int(variable_borrow_data[3])
            stable_borrow_raw = int(stable_borrow_data[4])

            tvl_usd = Decimal(str(total_deposit_raw)) / _ONE_USDC
            rate_per_second = Decimal(str(deposit_rate_raw)) / _RATE_SCALE
            apy = self._compute_hourly_compounded_apy(rate_per_second)

            utilization_rate: Decimal | None = None
            if total_deposit_raw > 0:
                total_borrow = Decimal(str(variable_borrow_raw + stable_borrow_raw))
                utilization_rate = total_borrow / Decimal(str(total_deposit_raw))
                utilization_rate = max(_ZERO, min(utilization_rate, _ONE))

            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=apy,
                effective_apy=apy,
                tvl_usd=max(tvl_usd, _ZERO),
                utilization_rate=utilization_rate,
                fetched_at=now,
            )
        except Exception as exc:
            logger.warning("Folks get_rate failed: %s", exc)
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=_ZERO,
                effective_apy=_ZERO,
                tvl_usd=_ZERO,
                utilization_rate=None,
                fetched_at=now,
            )

    async def get_health(self) -> ProtocolHealth:
        pool = self._get_hub_pool()
        settings = get_settings()

        try:
            config = await pool.functions.getConfigData().call()
            deposit_data = await pool.functions.getDepositData().call()
            variable_borrow_data = await pool.functions.getVariableBorrowData().call()
            stable_borrow_data = await pool.functions.getStableBorrowData().call()

            deprecated = bool(config[0])
            total_deposit_raw = int(deposit_data[1])
            variable_borrow_raw = int(variable_borrow_data[3])
            stable_borrow_raw = int(stable_borrow_data[4])

            utilization: Decimal | None = None
            if total_deposit_raw > 0:
                utilization = Decimal(str(variable_borrow_raw + stable_borrow_raw)) / Decimal(
                    str(total_deposit_raw)
                )
                utilization = max(_ZERO, min(utilization, _ONE))

            if deprecated:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.DEPOSITS_DISABLED,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=utilization,
                    details={"reason": "Folks pool marked deprecated"},
                )

            threshold = Decimal(str(settings.UTILIZATION_THRESHOLD))
            if utilization is not None and utilization > threshold:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.HIGH_UTILIZATION,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=utilization,
                    details={
                        "reason": "Utilization above configured threshold",
                        "threshold": str(threshold),
                    },
                )

            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.HEALTHY,
                is_deposit_safe=True,
                is_withdrawal_safe=True,
                utilization=utilization,
                details={},
            )
        except Exception as exc:
            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.EMERGENCY,
                is_deposit_safe=False,
                is_withdrawal_safe=False,
                utilization=None,
                details={"reason": f"Health check RPC failed: {exc}"},
            )

    async def get_balance(self, user_address: str) -> int:
        """Return underlying USDC amount from fToken share balance."""
        pool = self._get_hub_pool()
        w3 = self._get_w3()
        user = w3.to_checksum_address(user_address)

        shares = int(await pool.functions.balanceOf(user).call())
        if shares <= 0:
            return 0

        total_supply = int(await pool.functions.totalSupply().call())
        if total_supply <= 0:
            return 0

        deposit_data = await pool.functions.getDepositData().call()
        total_deposit_raw = int(deposit_data[1])
        if total_deposit_raw <= 0:
            return 0

        return (shares * total_deposit_raw) // total_supply

    async def get_shares(self, user_address: str) -> int:
        pool = self._get_hub_pool()
        w3 = self._get_w3()
        return int(await pool.functions.balanceOf(w3.to_checksum_address(user_address)).call())

    def build_supply_calldata(self, amount: int, on_behalf_of: str) -> TransactionCalldata:
        del amount
        del on_behalf_of
        raise RuntimeError(
            "Folks requires accountId/loanId and custom spoke calls. "
            "Use execution-service Folks routing instead of generic adapter calldata."
        )

    def build_withdraw_calldata(self, shares_or_amount: int, to: str) -> TransactionCalldata:
        del shares_or_amount
        del to
        raise RuntimeError(
            "Folks requires accountId/loanId and custom spoke calls. "
            "Use execution-service Folks routing instead of generic adapter calldata."
        )