"""
Aave V3 protocol adapter — Avalanche C-Chain mainnet.

APY Source: getReserveData(USDC).currentLiquidityRate (RAY = 1e27 → annualized)
Health:     Reserve config bitmap — is_active, is_frozen, is_paused flags
Utilization: 1 - (usdc.balanceOf(aToken) / aToken.totalSupply())
"""

import asyncio
import logging
import time
from decimal import Decimal
from typing import Any

from app.core.config import get_settings
from app.core.rpc import get_web3
from .base import (
    BaseProtocolAdapter,
    ProtocolHealth,
    ProtocolRate,
    ProtocolStatus,
    TransactionCalldata,
)

logger = logging.getLogger("snowmind.protocols.aave")

# ── Constants ────────────────────────────────────────────────────────────────

RAY = Decimal("1e27")
SECONDS_PER_YEAR = Decimal("31536000")  # 365 × 86400

# Reserve configuration bitmap bit positions (Aave V3)
# See: https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/libraries/configuration/ReserveConfiguration.sol
LTV_MASK = (1 << 16) - 1
IS_ACTIVE_BIT = 56
IS_FROZEN_BIT = 57
IS_PAUSED_BIT = 60

# ── Minimal ABI slices ──────────────────────────────────────────────────────

AAVE_POOL_ABI = [
    {
        "name": "getReserveData",
        "type": "function",
        "inputs": [{"name": "asset", "type": "address"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "configuration", "type": "uint256"},
                    {"name": "liquidityIndex", "type": "uint128"},
                    {"name": "currentLiquidityRate", "type": "uint128"},
                    {"name": "variableBorrowIndex", "type": "uint128"},
                    {"name": "currentVariableBorrowRate", "type": "uint128"},
                    {"name": "currentStableBorrowRate", "type": "uint128"},
                    {"name": "lastUpdateTimestamp", "type": "uint40"},
                    {"name": "id", "type": "uint16"},
                    {"name": "aTokenAddress", "type": "address"},
                    {"name": "stableDebtTokenAddress", "type": "address"},
                    {"name": "variableDebtTokenAddress", "type": "address"},
                    {"name": "interestRateStrategyAddress", "type": "address"},
                    {"name": "accruedToTreasury", "type": "uint128"},
                    {"name": "unbacked", "type": "uint128"},
                    {"name": "isolationModeTotalDebt", "type": "uint128"},
                ],
            }
        ],
        "stateMutability": "view",
    },
    {
        "name": "supply",
        "type": "function",
        "inputs": [
            {"name": "asset", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "onBehalfOf", "type": "address"},
            {"name": "referralCode", "type": "uint16"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "name": "withdraw",
        "type": "function",
        "inputs": [
            {"name": "asset", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "to", "type": "address"},
        ],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "nonpayable",
    },
]

ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "totalSupply",
        "type": "function",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
]


def _parse_reserve_config(config_data: int) -> dict[str, bool]:
    """Parse the Aave V3 reserve configuration bitmap into boolean flags."""
    return {
        "is_active": bool((config_data >> IS_ACTIVE_BIT) & 1),
        "is_frozen": bool((config_data >> IS_FROZEN_BIT) & 1),
        "is_paused": bool((config_data >> IS_PAUSED_BIT) & 1),
    }


def ray_to_apy(current_liquidity_rate: int) -> Decimal:
    """
    Convert Aave V3 currentLiquidityRate (RAY) to annual percentage yield.

    Aave uses per-second compounding:
    APY = (1 + rate / SECONDS_PER_YEAR) ^ SECONDS_PER_YEAR - 1
    """
    deposit_apr = Decimal(str(current_liquidity_rate)) / RAY
    apy = (1 + deposit_apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1
    return apy


class AaveV3Adapter(BaseProtocolAdapter):
    """Aave V3 lending pool adapter for USDC on Avalanche C-Chain."""

    protocol_id = "aave_v3"
    name = "Aave V3"

    def __init__(self) -> None:
        settings = get_settings()
        self.pool_address = settings.AAVE_V3_POOL
        self.usdc_address = settings.USDC_ADDRESS
        self._atoken_address_cache: str | None = None

    def _get_pool_contract(self) -> Any:
        """Get pool contract using current active RPC provider."""
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.pool_address),
            abi=AAVE_POOL_ABI,
        )

    def _get_erc20_contract(self, address: str) -> Any:
        """Get an ERC20 contract instance."""
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(address),
            abi=ERC20_ABI,
        )

    async def _get_reserve_data(self) -> tuple:
        """Fetch reserve data for USDC from the Aave V3 Pool."""
        w3 = get_web3()
        pool = self._get_pool_contract()
        return await pool.functions.getReserveData(
            w3.to_checksum_address(self.usdc_address)
        ).call()

    async def _get_atoken_address(self) -> str:
        """Resolve and cache the reserve aToken address."""
        if self._atoken_address_cache:
            return self._atoken_address_cache
        reserve_data = await self._get_reserve_data()
        self._atoken_address_cache = reserve_data[8]
        return self._atoken_address_cache

    async def get_utilization(self) -> Decimal | None:
        """Read utilization via cash and total supply with minimal RPC calls."""
        atoken_address = await self._get_atoken_address()
        atoken = self._get_erc20_contract(atoken_address)
        usdc_contract = self._get_erc20_contract(self.usdc_address)
        w3 = get_web3()

        total_supply, usdc_cash = await asyncio.gather(
            atoken.functions.totalSupply().call(),
            usdc_contract.functions.balanceOf(
                w3.to_checksum_address(atoken_address)
            ).call(),
        )

        if total_supply <= 0:
            return Decimal("0")

        utilization = Decimal("1") - (
            Decimal(str(usdc_cash)) / Decimal(str(total_supply))
        )
        return max(Decimal("0"), min(utilization, Decimal("1")))

    # ── Rate reading ────────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """
        Read live currentLiquidityRate from the Aave V3 Pool contract.

        On-chain data is authoritative. DefiLlama is NOT used as a fallback
        for rate reads — it's only a soft cross-validation signal.
        """
        reserve_data = await self._get_reserve_data()

        current_liquidity_rate = reserve_data[2]
        apy = ray_to_apy(current_liquidity_rate)

        atoken_address = reserve_data[8]

        # TVL = totalSupply of aToken (aTokens are 1:1 with underlying)
        atoken = self._get_erc20_contract(atoken_address)
        total_supply = await atoken.functions.totalSupply().call()
        tvl = Decimal(str(total_supply)) / Decimal("1e6")  # USDC 6 decimals

        # Utilization = 1 - (USDC cash in aToken / aToken totalSupply)
        w3 = get_web3()
        usdc_contract = self._get_erc20_contract(self.usdc_address)
        usdc_cash = await usdc_contract.functions.balanceOf(
            w3.to_checksum_address(atoken_address)
        ).call()

        utilization = Decimal("0")
        if total_supply > 0:
            utilization = Decimal("1") - (
                Decimal(str(usdc_cash)) / Decimal(str(total_supply))
            )

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            effective_apy=apy,  # Aave: effective = raw (no adjustments)
            tvl_usd=tvl,
            utilization_rate=utilization,
            fetched_at=time.time(),
        )

    # ── Health checks ───────────────────────────────────────────────────

    async def get_health(self) -> ProtocolHealth:
        """
        Check Aave V3 reserve health.

        Reads the reserve configuration bitmap for:
        - is_active: reserve is accepting deposits/withdrawals
        - is_frozen: reserve is NOT accepting new deposits (withdrawals OK)
        - is_paused: reserve is fully paused
        """
        reserve_data = await self._get_reserve_data()
        config_raw = reserve_data[0]
        flags = _parse_reserve_config(config_raw)

        is_active = flags["is_active"]
        is_frozen = flags["is_frozen"]
        is_paused = flags["is_paused"]

        # Determine deposit/withdrawal safety
        is_deposit_safe = is_active and not is_frozen and not is_paused
        is_withdrawal_safe = is_active and not is_paused

        # Determine overall status
        if is_paused or not is_active:
            status = ProtocolStatus.DEPOSITS_DISABLED
        elif is_frozen:
            status = ProtocolStatus.DEPOSITS_DISABLED
        else:
            status = ProtocolStatus.HEALTHY

        # Check utilization
        rate = await self.get_rate()
        if rate.utilization_rate is not None and rate.utilization_rate > Decimal("0.90"):
            status = ProtocolStatus.HIGH_UTILIZATION
            is_deposit_safe = False  # Exclude from new deposits, withdrawals still OK

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=status,
            is_deposit_safe=is_deposit_safe,
            is_withdrawal_safe=is_withdrawal_safe,
            utilization=rate.utilization_rate,
            details={
                "is_active": is_active,
                "is_frozen": is_frozen,
                "is_paused": is_paused,
                "tvl_usd": str(rate.tvl_usd),
            },
        )

    # ── Balance reading ─────────────────────────────────────────────────

    async def get_balance(self, user_address: str) -> int:
        """Returns the user's aToken balance (= underlying USDC, 6 decimals)."""
        reserve_data = await self._get_reserve_data()
        atoken_address = reserve_data[8]
        w3 = get_web3()
        atoken = self._get_erc20_contract(atoken_address)
        return await atoken.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()

    async def get_shares(self, user_address: str) -> int:
        """Aave aTokens are 1:1 with underlying, so shares = balance."""
        return await self.get_balance(user_address)

    # ── Calldata builders ───────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """Build Aave V3 supply(asset, amount, onBehalfOf, referralCode=0) calldata."""
        w3 = get_web3()
        pool = self._get_pool_contract()
        data = pool.encode_abi(
            "supply",
            args=[
                w3.to_checksum_address(self.usdc_address),
                amount,
                w3.to_checksum_address(on_behalf_of),
                0,  # referralCode
            ],
        )
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """
        Build Aave V3 withdraw(asset, amount, to) calldata.

        For full withdrawal, pass amount = 2**256 - 1 (MaxUint256).
        """
        w3 = get_web3()
        pool = self._get_pool_contract()
        data = pool.encode_abi(
            "withdraw",
            args=[
                w3.to_checksum_address(self.usdc_address),
                shares_or_amount,  # use 2**256 - 1 for full withdrawal
                w3.to_checksum_address(to),
            ],
        )
        return TransactionCalldata(to=self.pool_address, data=data, value=0)
