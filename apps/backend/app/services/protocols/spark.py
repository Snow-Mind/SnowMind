"""Spark Savings adapter — ERC-4626 vault interface on Avalanche."""

import time
from decimal import Decimal

from app.core.config import get_settings
from .base import BaseProtocolAdapter, ProtocolRate, TransactionCalldata, get_shared_async_web3

# ERC-4626 ABI subset (same interface as Euler V2 mock vault)
SPARK_VAULT_ABI = [
    {
        "name": "deposit",
        "type": "function",
        "inputs": [
            {"name": "assets", "type": "uint256"},
            {"name": "receiver", "type": "address"},
        ],
        "outputs": [{"name": "shares", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "redeem",
        "type": "function",
        "inputs": [
            {"name": "shares", "type": "uint256"},
            {"name": "receiver", "type": "address"},
            {"name": "owner", "type": "address"},
        ],
        "outputs": [{"name": "assets", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "convertToAssets",
        "type": "function",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "totalAssets",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "interestRatePerSecond",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

SECONDS_PER_YEAR = Decimal("31557600")
MANTISSA = Decimal("1e18")


class SparkAdapter(BaseProtocolAdapter):
    protocol_id = "spark"
    name = "Spark Savings"
    BASE_RISK_SCORE = 3.0  # MakerDAO-backed, well-audited
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        self.w3 = get_shared_async_web3()
        self.vault_address: str | None = (
            settings.SPARK_VAULT if settings.SPARK_VAULT else None
        )
        self.vault = None
        if self.vault_address:
            self.vault = self.w3.eth.contract(
                address=self.w3.to_checksum_address(self.vault_address),
                abi=SPARK_VAULT_ABI,
            )

    async def get_rate(self) -> ProtocolRate:
        if not self.vault:
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=Decimal("0"),
                tvl_usd=Decimal("0"),
                utilization_rate=None,
                fetched_at=time.time(),
            )

        rate_per_sec_raw = await self.vault.functions.interestRatePerSecond().call()
        rate_per_sec = Decimal(str(rate_per_sec_raw)) / MANTISSA
        apy = (1 + rate_per_sec) ** SECONDS_PER_YEAR - 1

        total_assets_raw = await self.vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / Decimal("1e6")  # USDC 6 decimals

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            tvl_usd=tvl,
            utilization_rate=None,
            fetched_at=time.time(),
        )

    def build_supply_calldata(
        self, asset: str, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """ERC-4626: deposit(uint256 assets, address receiver)"""
        if not self.vault:
            raise RuntimeError("Spark vault not configured")
        data = self.vault.encode_abi(
            "deposit",
            args=[amount, self.w3.to_checksum_address(on_behalf_of)],
        )
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    def build_withdraw_calldata(
        self, asset: str, amount: int, to: str
    ) -> TransactionCalldata:
        """ERC-4626: redeem(uint256 shares, address receiver, address owner)"""
        if not self.vault:
            raise RuntimeError("Spark vault not configured")
        to_addr = self.w3.to_checksum_address(to)
        data = self.vault.encode_abi("redeem", args=[amount, to_addr, to_addr])
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    async def get_user_balance(self, user_address: str, asset: str) -> int:
        """Returns underlying USDC amount by converting shares -> assets."""
        if not self.vault:
            return 0
        shares = await self.vault.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()
        return await self.vault.functions.convertToAssets(shares).call()
