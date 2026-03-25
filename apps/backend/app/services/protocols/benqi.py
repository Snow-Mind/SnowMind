"""
Benqi protocol adapter — Avalanche C-Chain mainnet (qiUSDCn).

APY Source:    supplyRatePerTimestamp() → annualized
Balance:       ALWAYS use exchangeRateStored() (NOT exchangeRateCurrent())
Withdrawals:   Redeem by shares (qiTokens), not by underlying USDC amount
Health:        comptroller.mintGuardianPaused() and comptroller.redeemGuardianPaused()
Utilization:   totalBorrows / (getCash + totalBorrows - totalReserves)
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

logger = logging.getLogger("snowmind.protocols.benqi")

# ── Constants ────────────────────────────────────────────────────────────────

SECONDS_PER_YEAR = Decimal("31536000")  # 365 × 86400
MANTISSA = Decimal("1e18")

# ── Minimal ABI slices ──────────────────────────────────────────────────────

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
        "name": "exchangeRateCurrent",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
    },
    {
        "name": "exchangeRateStored",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "getCash",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "totalBorrows",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "totalReserves",
        "type": "function",
        "inputs": [],
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

BENQI_COMPTROLLER_ABI = [
    {
        "name": "mintGuardianPaused",
        "type": "function",
        "inputs": [{"name": "qiToken", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "redeemGuardianPaused",
        "type": "function",
        "inputs": [{"name": "qiToken", "type": "address"}],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
]


class BenqiAdapter(BaseProtocolAdapter):
    """Benqi lending adapter for qiUSDCn on Avalanche C-Chain."""

    protocol_id = "benqi"
    name = "Benqi"

    def __init__(self) -> None:
        settings = get_settings()
        self.pool_address = settings.BENQI_QIUSDC
        self.usdc_address = settings.USDC_ADDRESS
        self.comptroller_address = settings.BENQI_COMPTROLLER

        if not self.pool_address:
            raise ValueError("BENQI_QIUSDC not configured — set it in .env")

    def _get_pool_contract(self) -> Any:
        """Get qiToken contract using current active RPC provider."""
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.pool_address),
            abi=BENQI_QITOKEN_ABI,
        )

    @property
    def pool(self) -> Any:
        """Backward-compatible contract handle used by legacy tests/helpers."""
        return self._get_pool_contract()

    def _get_comptroller_contract(self) -> Any:
        """Get comptroller contract for pause flag checks."""
        if not self.comptroller_address:
            return None
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.comptroller_address),
            abi=BENQI_COMPTROLLER_ABI,
        )

    # ── Rate reading ────────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """
        APY = (1 + supplyRatePerTimestamp / 1e18) ^ SECONDS_PER_YEAR - 1

        Uses exchangeRateStored() for TVL calculation (NOT exchangeRateCurrent).
        """
        pool = self._get_pool_contract()

        # Parallel reads for efficiency
        (
            rate_per_sec_raw,
            exchange_rate_raw,
            total_supply_raw,
            cash_raw,
            borrows_raw,
            reserves_raw,
        ) = await asyncio.gather(
            pool.functions.supplyRatePerTimestamp().call(),
            pool.functions.exchangeRateStored().call(),  # NOT exchangeRateCurrent
            pool.functions.totalSupply().call(),
            pool.functions.getCash().call(),
            pool.functions.totalBorrows().call(),
            pool.functions.totalReserves().call(),
        )

        # APY calculation
        rate_per_second = Decimal(str(rate_per_sec_raw)) / MANTISSA
        apy = (1 + rate_per_second) ** SECONDS_PER_YEAR - 1

        # TVL: totalSupply (qiTokens) × exchangeRate → underlying USDC
        # qiToken has 8 decimals, exchangeRate mantissa is 1e18.
        # underlying_raw = totalSupply * exchangeRate / 1e18 → USDC 6-decimal units
        # TVL in dollars = underlying_raw / 1e6
        exchange_rate = Decimal(str(exchange_rate_raw)) / MANTISSA
        tvl_underlying = Decimal(str(total_supply_raw)) * exchange_rate
        tvl_usdc = tvl_underlying / Decimal("1e6")

        # Utilization: totalBorrows / (cash + totalBorrows - totalReserves)
        cash = Decimal(str(cash_raw))
        borrows = Decimal(str(borrows_raw))
        reserves = Decimal(str(reserves_raw))
        total_supply_underlying = cash + borrows - reserves

        utilization = Decimal("0")
        if total_supply_underlying > 0:
            utilization = borrows / total_supply_underlying

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            effective_apy=apy,  # Benqi: effective = raw (no adjustments)
            tvl_usd=tvl_usdc,
            utilization_rate=utilization,
            fetched_at=time.time(),
        )

    # ── Health checks ───────────────────────────────────────────────────

    async def get_health(self) -> ProtocolHealth:
        """
        Check Benqi protocol health.

        Reads comptroller pause flags:
        - mintGuardianPaused: deposits disabled
        - redeemGuardianPaused: withdrawals disabled (ALERT: funds may be locked)
        Also checks utilization > 90%.
        """
        comptroller = self._get_comptroller_contract()
        w3 = get_web3()

        mint_paused = False
        redeem_paused = False
        details: dict[str, Any] = {}

        if comptroller:
            try:
                mint_paused = await comptroller.functions.mintGuardianPaused(
                    w3.to_checksum_address(self.pool_address)
                ).call()
            except Exception as exc:
                logger.warning("Benqi mintGuardianPaused check failed: %s", exc)
                details["mint_check_error"] = str(exc)

            try:
                redeem_paused = await comptroller.functions.redeemGuardianPaused(
                    w3.to_checksum_address(self.pool_address)
                ).call()
            except Exception as exc:
                # redeemGuardianPaused returns empty data for some markets (e.g. qiUSDCn).
                # Conservative default: assume NOT paused (withdrawals allowed).
                logger.debug("Benqi redeemGuardianPaused unavailable for %s: %s", self.pool_address, exc)
                details["redeem_check_unavailable"] = True

        details["mint_paused"] = mint_paused
        details["redeem_paused"] = redeem_paused

        # Deposit safety
        is_deposit_safe = not mint_paused
        is_withdrawal_safe = not redeem_paused

        # Determine status
        if redeem_paused:
            status = ProtocolStatus.WITHDRAWALS_DISABLED
            logger.error("ALERT: Benqi redeem is paused — withdrawals may be locked!")
        elif mint_paused:
            status = ProtocolStatus.DEPOSITS_DISABLED
        else:
            status = ProtocolStatus.HEALTHY

        # Check utilization
        try:
            rate = await self.get_rate()
            details["tvl_usd"] = str(rate.tvl_usd)
            if rate.utilization_rate is not None and rate.utilization_rate > Decimal("0.90"):
                status = ProtocolStatus.HIGH_UTILIZATION
                is_deposit_safe = False  # Exclude from new deposits only
                details["utilization"] = str(rate.utilization_rate)
        except Exception as exc:
            logger.warning("Benqi rate check failed during health check: %s", exc)
            details["rate_error"] = str(exc)

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=status,
            is_deposit_safe=is_deposit_safe,
            is_withdrawal_safe=is_withdrawal_safe,
            utilization=rate.utilization_rate if 'rate' in dir() else None,
            details=details,
        )

    # ── Balance reading ─────────────────────────────────────────────────

    async def get_balance(self, user_address: str) -> int:
        """
        Returns the user's underlying USDC balance in Benqi (6 decimals).

        Uses exchangeRateStored() × balanceOf — NOT balanceOfUnderlying()
        which internally calls exchangeRateCurrent() (a state-changing call).
        """
        w3 = get_web3()
        pool = self._get_pool_contract()
        qi_balance, exchange_rate = await asyncio.gather(
            pool.functions.balanceOf(
                w3.to_checksum_address(user_address)
            ).call(),
            pool.functions.exchangeRateStored().call(),
        )
        # underlying = qiTokens × exchangeRate / 1e18
        return (qi_balance * exchange_rate) // (10**18)

    async def get_shares(self, user_address: str) -> int:
        """Returns the user's qiToken balance (for share-based redemption)."""
        w3 = get_web3()
        pool = self._get_pool_contract()
        return await pool.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()

    # ── Calldata builders ───────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """
        Build Benqi mint(uint256) calldata.

        Benqi qiTokens use mint(amount) — the asset is implicit (pool is USDC-specific).
        """
        pool = self._get_pool_contract()
        data = pool.encode_abi("mint", args=[amount])
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """
        Build Benqi redeem(uint256) calldata.

        IMPORTANT: Amount is in qiToken shares, NOT underlying USDC.
        Architecture spec: "redeem by shares (not by amount) for exactness"
        Caller must pass qiToken balance from get_shares().
        """
        pool = self._get_pool_contract()
        data = pool.encode_abi("redeem", args=[shares_or_amount])
        return TransactionCalldata(to=self.pool_address, data=data, value=0)

    # ── Helpers ──────────────────────────────────────────────────────────

    async def usdc_to_qi_tokens(self, usdc_amount: int) -> int:
        """Convert a USDC amount (6 decimals) to equivalent qiToken amount.

        Compound V2 exchange rate formula:
            exchangeRate = (cash + borrows - reserves) * 1e18 / totalSupply
            underlying   = qiTokens * exchangeRate / 1e18
            qiTokens     = underlying * 1e18 / exchangeRate
        """
        pool = self._get_pool_contract()
        exchange_rate = await pool.functions.exchangeRateStored().call()
        # qiTokens = usdc_raw(6dec) * 1e18 / exchangeRate
        return (usdc_amount * 10**18) // exchange_rate
