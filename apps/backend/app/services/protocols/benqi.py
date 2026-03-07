"""Benqi protocol adapter — real qiToken mint/redeem via web3.py."""

from __future__ import annotations

import asyncio
import time
from decimal import Decimal

from web3 import AsyncWeb3, AsyncHTTPProvider

from app.core.config import get_settings
from .base import BaseProtocolAdapter, ProtocolRate, TransactionCalldata

# ── Benqi qiToken ABI — same on mainnet and MockBenqiPool ────────────────────
BENQI_QITOKEN_ABI = [
    {
        "name": "mint",
        "type": "function",
        "inputs": [{"name": "mintAmount", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "redeem",
        "type": "function",
        "inputs": [{"name": "redeemTokens", "type": "uint256"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "supplyRatePerTimestamp",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "exchangeRateStored",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "balanceOfUnderlying",
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
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

# Real mainnet qiUSDC addresses
BENQI_MAINNET = {
    "qi_usdc_n": "0xB715808a78F6041E46d61Cb123C9B4A27056AE9C",  # qiUSDCn (native)
    "usdc":      "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6C",
}

# Seconds per year for APY calculation (365.25 × 86 400)
SECONDS_PER_YEAR = Decimal("31557600")
MANTISSA = Decimal("1e18")


class BenqiAdapter(BaseProtocolAdapter):
    protocol_id = "benqi"
    name = "Benqi"

    BASE_RISK_SCORE = 3.0

    def __init__(self) -> None:
        settings = get_settings()
        self.w3 = AsyncWeb3(AsyncHTTPProvider(settings.AVALANCHE_RPC_URL))

        # Fuji → MockBenqiPool; mainnet → real qiUSDCn
        self.pool_address = (
            settings.BENQI_POOL if settings.IS_TESTNET
            else BENQI_MAINNET["qi_usdc_n"]
        )
        self.usdc_address = (
            settings.USDC_ADDRESS if settings.IS_TESTNET
            else BENQI_MAINNET["usdc"]
        )

        if not self.pool_address:
            raise ValueError(
                "BENQI_POOL not configured — set it in .env or environment"
            )

        self.pool = self.w3.eth.contract(
            address=self.w3.to_checksum_address(self.pool_address),
            abi=BENQI_QITOKEN_ABI,
        )

    # ── Rate reading ──────────────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """
        APY = (1 + supplyRatePerTimestamp / 1e18) ^ SECONDS_PER_YEAR - 1
        """
        rate_per_sec_raw, exchange_rate_raw, total_supply_raw = await asyncio.gather(
            self.pool.functions.supplyRatePerTimestamp().call(),
            self.pool.functions.exchangeRateStored().call(),
            self.pool.functions.totalSupply().call(),
        )

        rate_per_second = Decimal(str(rate_per_sec_raw)) / MANTISSA
        apy = (1 + rate_per_second) ** SECONDS_PER_YEAR - 1

        # TVL: totalSupply (qiTokens) × exchangeRate / 1e18 / 1e12 (USDC 6 dec)
        exchange_rate = Decimal(str(exchange_rate_raw)) / MANTISSA
        tvl_usdc = (Decimal(str(total_supply_raw)) * exchange_rate) / Decimal("1e12")

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            tvl_usd=tvl_usdc,
            utilization_rate=None,
            fetched_at=time.time(),
        )

    async def get_rate_at_deposit(self, hypothetical_deposit_usdc: Decimal) -> Decimal:
        """
        Approximate how APY changes if we add *hypothetical_deposit_usdc* more.
        Uses linear dilution: new_rate = current_rate × tvl / (tvl + deposit).
        """
        current_rate_raw, total_supply, exchange_rate_raw = await asyncio.gather(
            self.pool.functions.supplyRatePerTimestamp().call(),
            self.pool.functions.totalSupply().call(),
            self.pool.functions.exchangeRateStored().call(),
        )

        current_rate = Decimal(str(current_rate_raw)) / MANTISSA
        exchange_rate = Decimal(str(exchange_rate_raw)) / MANTISSA
        current_tvl = (
            Decimal(str(total_supply)) * exchange_rate / Decimal("1e12")
        )

        if current_tvl > 0:
            new_rate = current_rate * (current_tvl / (current_tvl + hypothetical_deposit_usdc))
        else:
            new_rate = current_rate

        return (1 + new_rate) ** SECONDS_PER_YEAR - 1

    # ── Calldata builders ─────────────────────────────────────────────────────

    def build_supply_calldata(
        self, asset: str, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """Benqi uses mint(uint256) — asset param ignored (pool is USDC-specific)."""
        data = self.pool.encode_abi("mint", args=[amount])
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    def build_withdraw_calldata(
        self, asset: str, amount: int, to: str
    ) -> TransactionCalldata:
        """
        Benqi redeem(uint256) takes qiToken units.
        Caller must convert via usdc_to_qi_tokens() first.
        """
        data = self.pool.encode_abi("redeem", args=[amount])
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def usdc_to_qi_tokens(self, usdc_amount: int) -> int:
        """Convert a USDC amount to the equivalent qiToken amount."""
        exchange_rate = await self.pool.functions.exchangeRateStored().call()
        # qiTokens = usdc * 1e12 * 1e18 / exchangeRate
        return (usdc_amount * 10**12 * 10**18) // exchange_rate

    async def get_user_balance(self, user_address: str, asset: str) -> int:
        """Returns the user's underlying USDC balance in Benqi (6 decimals)."""
        return await self.pool.functions.balanceOfUnderlying(
            self.w3.to_checksum_address(user_address)
        ).call()
