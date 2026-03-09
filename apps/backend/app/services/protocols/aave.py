"""Aave V3 protocol adapter — live Fuji / mainnet contract reads."""

import logging
import time
from decimal import Decimal

import httpx
from web3 import AsyncWeb3, AsyncHTTPProvider
from web3.contract import AsyncContract

from app.core.config import get_settings
from .base import BaseProtocolAdapter, ProtocolRate, TransactionCalldata

logger = logging.getLogger(__name__)

# ── Mainnet fallbacks (used when IS_TESTNET is False) ───────────────
_AAVE_V3_POOL_MAINNET = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
_USDC_MAINNET = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6C"

# DefiLlama pool UUID for Aave V3 USDC on Avalanche
_DEFILLAMA_AAVE_POOL = "747c1d2a-c668-4682-b9f9-296571049571"

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
        """Read live currentLiquidityRate from the Aave V3 Pool contract.
        
        Falls back to DefiLlama mainnet rate when on-chain call fails (e.g. Fuji testnet).
        """
        try:
            reserve_data = await self.pool.functions.getReserveData(
                self.w3.to_checksum_address(self.usdc_address)
            ).call()

            RAY = Decimal("1e27")
            SECONDS_PER_YEAR = Decimal("31557600")

            liquidity_rate = Decimal(str(reserve_data[2])) / RAY
            apy = (1 + liquidity_rate / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1

            atoken_address = reserve_data[8]

            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=apy,
                tvl_usd=await self._get_tvl(atoken_address),
                utilization_rate=None,
                fetched_at=time.time(),
            )
        except Exception as exc:
            logger.warning(
                "Aave V3 on-chain read failed: %s — falling back to DefiLlama", exc,
            )
            return await self._fetch_defillama_rate()

    async def _fetch_defillama_rate(self) -> ProtocolRate:
        """Fetch live Aave V3 Avalanche USDC rate from DefiLlama yield API."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"https://yields.llama.fi/chart/{_DEFILLAMA_AAVE_POOL}"
                )
                resp.raise_for_status()
                data = resp.json()

            points = data.get("data") or []
            if not points:
                raise ValueError("Empty data from DefiLlama")

            latest = points[-1]
            apy_pct = latest.get("apy", latest.get("apyBase", 0))
            apy = Decimal(str(apy_pct)) / Decimal("100")
            tvl = Decimal(str(latest.get("tvlUsd", 0)))

            logger.info("Aave V3 rate from DefiLlama: %.2f%%", float(apy * 100))
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=apy,
                tvl_usd=tvl,
                utilization_rate=None,
                fetched_at=time.time(),
            )
        except Exception as exc:
            logger.warning("DefiLlama fallback also failed: %s — returning 0 APY", exc)
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=Decimal("0"),
                tvl_usd=Decimal("0"),
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
        try:
            reserve_data = await self.pool.functions.getReserveData(
                self.w3.to_checksum_address(self.usdc_address)
            ).call()
        except Exception:
            return 0
        atoken_address = reserve_data[8]

        atoken = self.w3.eth.contract(
            address=self.w3.to_checksum_address(atoken_address),
            abi=_ERC20_BALANCE_ABI,
        )
        return await atoken.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()
