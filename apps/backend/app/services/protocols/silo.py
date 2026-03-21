"""Silo V2 adapter — ERC-4626 vault interface on Avalanche.

Supports two isolated lending markets:
  - savUSD/USDC  vault = 0x606fe9a70338e798a292CA22C1F28C829F24048E (bUSDC-142)
  - sUSDp/USDC   vault = 0x8ad697a333569ca6f04c8c063e9807747ef169c1 (bUSDC-162)

Both vaults implement the standard ERC-4626 interface:
  deposit(assets, receiver) / redeem(shares, receiver, owner)
  convertToAssets(shares) / totalAssets()

Note: Silo V2 USDC vaults have a non-1:1 share-to-asset ratio.
Shares have 6 decimals (same as USDC) but each share is worth ~0.001 USDC.
We use a large query amount (1e18) in convertToAssets for APY precision.
"""

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

logger = logging.getLogger("snowmind.protocols.silo")

# ── ERC-4626 Silo Vault ABI ──────────────────────────────────────────────────
SILO_VAULT_ABI = [
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
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

# 1 USDC = 1e6 (6 decimals)
ONE_USDC = Decimal("1000000")
# Use a large share amount for convertToAssets to get high-precision share price.
# Silo V2 vaults have ~0.001 USDC per share, so 1e6 shares only yields ~1052.
# Using 1e18 gives ~15 digits of precision for APY estimation.
SHARE_PRICE_QUERY_AMOUNT = 10**18
SHARE_PRICE_QUERY_DECIMAL = Decimal("1000000000000000000")
SECONDS_PER_YEAR = Decimal("31557600")


class SiloAdapter(BaseProtocolAdapter):
    """Generic ERC-4626 adapter for a single Silo vault.

    Instantiated once per Silo market (savUSD/USDC, sUSDp/USDC).
    APY is derived from the share price growth rate via convertToAssets().
    """

    # Subclasses override these
    protocol_id: str = ""
    name: str = ""
    BASE_RISK_SCORE: float = 8.0  # Per ARCHITECTURE.md: Silo = 8/10
    is_active: bool = True

    def __init__(self, vault_address: str | None) -> None:
        self.w3 = get_shared_async_web3()
        self.vault_address: str | None = vault_address if vault_address else None
        self.vault = None
        if self.vault_address:
            self.vault = self.w3.eth.contract(
                address=self.w3.to_checksum_address(self.vault_address),
                abi=SILO_VAULT_ABI,
            )
        # Cache for share price APY estimation
        self._last_share_price: Decimal | None = None
        self._last_share_price_time: float | None = None

    # ── Rate reading ──────────────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """Estimate APY from share price growth (convertToAssets over time)."""
        if not self.vault:
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=Decimal("0"),
                effective_apy=Decimal("0"),
                tvl_usd=Decimal("0"),
                utilization_rate=None,
                fetched_at=time.time(),
            )

        # Read current share price with high precision
        current_assets = await self.vault.functions.convertToAssets(
            SHARE_PRICE_QUERY_AMOUNT
        ).call()
        current_price = Decimal(str(current_assets)) / SHARE_PRICE_QUERY_DECIMAL

        total_assets_raw = await self.vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / ONE_USDC

        now = time.time()

        # Estimate APY from price change since last reading
        apy = Decimal("0")
        if (
            self._last_share_price is not None
            and self._last_share_price_time is not None
            and self._last_share_price > Decimal("0")
        ):
            elapsed = Decimal(str(now - self._last_share_price_time))
            if elapsed > Decimal("60"):  # At least 1 minute between readings
                growth = (current_price - self._last_share_price) / self._last_share_price
                if growth > Decimal("0"):
                    apy = growth * SECONDS_PER_YEAR / elapsed

        # Update cache for next call
        self._last_share_price = current_price
        self._last_share_price_time = now

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=apy,
            effective_apy=apy,
            tvl_usd=tvl,
            utilization_rate=None,
            fetched_at=now,
        )

    async def get_health(self) -> ProtocolHealth:
        """Health check: vault must be configured and have non-zero totalAssets."""
        if not self.vault:
            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.EXCLUDED,
                is_deposit_safe=False,
                is_withdrawal_safe=False,
                utilization=None,
                details={"reason": "Vault not configured"},
            )

        try:
            total_assets = await self.vault.functions.totalAssets().call()
            if total_assets == 0:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.EMERGENCY,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=None,
                    details={"reason": "totalAssets is zero — vault may be drained"},
                )

            # Sanity: convertToAssets must return a positive value
            test_assets = await self.vault.functions.convertToAssets(
                SHARE_PRICE_QUERY_AMOUNT
            ).call()
            if test_assets <= 0:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.DEPOSITS_DISABLED,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=None,
                    details={
                        "reason": "Share price is zero — possible loss event",
                        "convertToAssets": str(test_assets),
                    },
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

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=ProtocolStatus.HEALTHY,
            is_deposit_safe=True,
            is_withdrawal_safe=True,
            utilization=None,
            details={},
        )

    # ── Calldata builders ─────────────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """ERC-4626: deposit(uint256 assets, address receiver)"""
        if not self.vault:
            raise RuntimeError(f"Silo vault not configured for {self.protocol_id}")
        data = self.vault.encode_abi(
            "deposit",
            args=[amount, self.w3.to_checksum_address(on_behalf_of)],
        )
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """ERC-4626: redeem(uint256 shares, address receiver, address owner)"""
        if not self.vault:
            raise RuntimeError(f"Silo vault not configured for {self.protocol_id}")
        to_addr = self.w3.to_checksum_address(to)
        data = self.vault.encode_abi("redeem", args=[shares_or_amount, to_addr, to_addr])
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    # ── Balance ───────────────────────────────────────────────────────────────

    async def get_balance(self, user_address: str) -> int:
        """Returns underlying USDC amount by converting shares → assets."""
        if not self.vault:
            return 0
        shares = await self.vault.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()
        if shares == 0:
            return 0
        return await self.vault.functions.convertToAssets(shares).call()

    async def get_shares(self, user_address: str) -> int:
        """Returns the raw ERC-4626 share balance for redemption paths."""
        if not self.vault:
            return 0
        return await self.vault.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()


# ── Concrete adapters (one per Silo market) ───────────────────────────────────

class SiloSavUSDAdapter(SiloAdapter):
    """savUSD/USDC Silo vault on Avalanche."""
    protocol_id = "silo_savusd_usdc"
    name = "Silo (savUSD/USDC)"
    BASE_RISK_SCORE = 8.0
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(vault_address=settings.SILO_SAVUSD_VAULT)


class SiloSUSDpAdapter(SiloAdapter):
    """sUSDp/USDC Silo vault on Avalanche."""
    protocol_id = "silo_susdp_usdc"
    name = "Silo (sUSDp/USDC)"
    BASE_RISK_SCORE = 8.0
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(vault_address=settings.SILO_SUSDP_VAULT)
