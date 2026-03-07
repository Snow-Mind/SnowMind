"""Aave V3 protocol adapter — live Fuji / mainnet contract reads."""

from __future__ import annotations

import time
from decimal import Decimal

from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.contract import AsyncContract

from app.core.config import get_settings
from .base import BaseProtocolAdapter, ProtocolRate, TransactionCalldata

# ── Mainnet fallbacks (used when IS_TESTNET is False) ───────────────
_AAVE_V3_POOL_MAINNET = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
_USDC_MAINNET = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6C"

# ── Minimal ABI slices ──────────────────────────────────────────────
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

_ERC20_BALANCE_ABI = [
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


class AaveV3Adapter(BaseProtocolAdapter):
    protocol_id = "aave_v3"
    name = "Aave V3"

    def __init__(self) -> None:
        settings = get_settings()
        self.w3 = AsyncWeb3(AsyncHTTPProvider(settings.AVALANCHE_RPC_URL))
        self.pool_address = (
            settings.AAVE_V3_POOL if settings.IS_TESTNET else _AAVE_V3_POOL_MAINNET
        )
        self.usdc_address = (
            settings.USDC_ADDRESS if settings.IS_TESTNET else _USDC_MAINNET
        )
        self.pool: AsyncContract = self.w3.eth.contract(
            address=self.w3.to_checksum_address(self.pool_address),
            abi=AAVE_POOL_ABI,
        )

    # ── Rate reading ────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """Read live currentLiquidityRate from the Aave V3 Pool contract."""
        reserve_data = await self.pool.functions.getReserveData(
            self.w3.to_checksum_address(self.usdc_address)
        ).call()

        RAY = Decimal("1e27")
        SECONDS_PER_YEAR = Decimal("31557600")

        # index 2 = currentLiquidityRate (RAY units)
        liquidity_rate = Decimal(str(reserve_data[2])) / RAY

        # Compound-interest APY
        apy = (1 + liquidity_rate / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1

        atoken_address = reserve_data[8]  # index 8 = aTokenAddress

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            tvl_usd=await self._get_tvl(atoken_address),
            utilization_rate=None,
            fetched_at=time.time(),
        )

    async def _get_tvl(self, atoken_address: str) -> Decimal:
        atoken = self.w3.eth.contract(
            address=self.w3.to_checksum_address(atoken_address),
            abi=_ERC20_BALANCE_ABI,
        )
        total_supply = await atoken.functions.totalSupply().call()
        return Decimal(str(total_supply)) / Decimal("1e6")  # USDC 6 decimals

    # ── Calldata builders ───────────────────────────────────────────

    def build_supply_calldata(
        self, asset: str, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        data = self.pool.encode_abi(
            "supply",
            args=[
                self.w3.to_checksum_address(asset),
                amount,
                self.w3.to_checksum_address(on_behalf_of),
                0,  # referralCode
            ],
        )
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    def build_withdraw_calldata(
        self, asset: str, amount: int, to: str
    ) -> TransactionCalldata:
        data = self.pool.encode_abi(
            "withdraw",
            args=[
                self.w3.to_checksum_address(asset),
                amount,  # use 2**256-1 for full withdrawal
                self.w3.to_checksum_address(to),
            ],
        )
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    # ── Balance ─────────────────────────────────────────────────────

    async def get_user_balance(self, user_address: str, asset: str) -> int:
        reserve_data = await self.pool.functions.getReserveData(
            self.w3.to_checksum_address(self.usdc_address)
        ).call()
        atoken_address = reserve_data[8]

        atoken = self.w3.eth.contract(
            address=self.w3.to_checksum_address(atoken_address),
            abi=_ERC20_BALANCE_ABI,
        )
        return await atoken.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()
