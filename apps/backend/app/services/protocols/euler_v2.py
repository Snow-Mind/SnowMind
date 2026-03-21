"""Euler (9Summits) adapter — ERC-4626 vault interface on Avalanche."""

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

logger = logging.getLogger("snowmind.protocols.euler")

# ── ERC-4626 Euler V2 Vault ABI ──────────────────────────────────────────────
# Uses only standard ERC-4626 functions — interestRatePerSecond is NOT available
# on EVK vaults. APY is derived from share price growth (convertToAssets).
EULER_V2_ABI = [
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
SECONDS_PER_YEAR = Decimal("31557600")


class EulerV2Adapter(BaseProtocolAdapter):
    protocol_id = "euler_v2"
    name = "Euler (9Summits)"
    BASE_RISK_SCORE = 5.0  # "Euler v2: 5 (newer, add with caution)"
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        self.w3 = get_shared_async_web3()
        self.vault_address: str | None = (
            settings.EULER_VAULT if settings.EULER_VAULT else None
        )
        self.vault = None
        if self.vault_address:
            self.vault = self.w3.eth.contract(
                address=self.w3.to_checksum_address(self.vault_address),
                abi=EULER_V2_ABI,
            )
        # Cache for share price APY estimation
        self._last_share_price: Decimal | None = None
        self._last_share_price_time: float | None = None
        self._cached_apy: Decimal = Decimal("0")

    # ── Rate reading ──────────────────────────────────────────────────────────

    async def get_rate(self) -> ProtocolRate:
        """Estimate APY from share price growth (convertToAssets(1e6) over time).

        EVK vaults do NOT expose interestRatePerSecond() — the only reliable
        way to get the supply APY is to observe the share price changing.
        First call returns 0% APY; subsequent calls compute annualized growth.

        When called rapidly (< 60s), returns the previously computed APY
        without resetting the share-price observation window.
        """
        if not self.vault:
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=Decimal("0"),
                effective_apy=Decimal("0"),
                tvl_usd=Decimal("0"),
                utilization_rate=None,
                fetched_at=time.time(),
            )

        # Read current share price: how much USDC does 1e6 shares convert to
        current_assets = await self.vault.functions.convertToAssets(int(ONE_USDC)).call()
        current_price = Decimal(str(current_assets)) / ONE_USDC  # ratio >= 1.0

        total_assets_raw = await self.vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / ONE_USDC

        now = time.time()

        # Estimate APY from price change since last reading
        if (
            self._last_share_price is not None
            and self._last_share_price_time is not None
            and self._last_share_price > Decimal("0")
        ):
            elapsed = Decimal(str(now - self._last_share_price_time))
            if elapsed > Decimal("60"):  # At least 1 minute between readings
                growth = (current_price - self._last_share_price) / self._last_share_price
                if growth > Decimal("0"):
                    self._cached_apy = growth * SECONDS_PER_YEAR / elapsed
                # Update observation window only when we compute a new APY
                self._last_share_price = current_price
                self._last_share_price_time = now
            # elapsed < 60s: keep _cached_apy, don't reset the observation window
        else:
            # First call ever: seed the price cache
            self._last_share_price = current_price
            self._last_share_price_time = now

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=self._cached_apy,
            effective_apy=self._cached_apy,
            tvl_usd=tvl,
            utilization_rate=None,
            fetched_at=now,
        )

    async def get_health(self) -> ProtocolHealth:
        """Health check: vault must have non-zero totalAssets and valid share price."""
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

            # Sanity: convertToAssets should return at least 1:1 ratio
            one_usdc = 1_000_000  # 1 USDC in 6 decimals
            test_assets = await self.vault.functions.convertToAssets(one_usdc).call()
            if test_assets < one_usdc:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.DEPOSITS_DISABLED,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=None,
                    details={
                        "reason": "Share price below 1:1 — possible loss event",
                        "share_price_ratio": str(Decimal(str(test_assets)) / Decimal("1000000")),
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
            raise RuntimeError("Euler V2 vault not configured")
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
            raise RuntimeError("Euler V2 vault not configured")
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
        return await self.vault.functions.convertToAssets(shares).call()

    async def get_shares(self, user_address: str) -> int:
        """Returns the raw ERC-4626 share balance for redemption paths."""
        if not self.vault:
            return 0
        return await self.vault.functions.balanceOf(
            self.w3.to_checksum_address(user_address)
        ).call()
