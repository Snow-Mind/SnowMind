"""
Spark Savings adapter — ERC-4626 vault on Avalanche C-Chain (spUSDC).

APY Source:      convertToAssets(1e6) delta vs 24h-ago snapshot × 365
Effective APY:   gross_apy × 1.0 (convertToAssets already includes deployment ratio)

AVALANCHE-SPECIFIC CHANGES (PSM3 architecture):
- Avalanche uses PSM3, NOT Ethereum's DssLitePsm/UsdsPsmWrapper.
- PSM3 has no tin() method — there is no deposit fee on Avalanche PSM3.
- There is no MakerDAO vat on Avalanche — no vat.live() exists.
- Deposit-safety check:  PSM3.totalAssets() == 0 → deposits disabled.
- Emergency-exit check:  spUSDC.maxWithdraw(probe) == 0 → no liquidity, exit.

CRITICAL: Spark has NO utilization check, NO velocity check, NO sanity bound,
NO 7-day stability check, and NO TVL cap. Its rate is governance-set, not market-driven.
These exemptions are intentional — see ARCHITECTURE.md for reasoning.
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

logger = logging.getLogger("snowmind.protocols.spark")

# ── Constants ────────────────────────────────────────────────────────────────

# NOTE: DEPLOYMENT_RATIO is 1.0 because convertToAssets() already reflects
# the effective depositor yield AFTER the 90/10 split (90% deployed, 10% buffer).
# Applying 0.90 on top would double-count and under-report the APY.
# See: https://docs.spark.fi/user-guides/earning-savings/spusdc
DEPLOYMENT_RATIO = Decimal("1.0")
DEFAULT_EXPECTED_HOLD_DAYS = 30

# Minimum PSM3 totalAssets below which we consider deposits unsafe (USDC 6 dec).
# $1000 worth of USDC = 1_000_000_000 raw units.
PSM3_MIN_TOTAL_ASSETS = 1_000_000_000

# Probe address for maxWithdraw liquidity check (zero address = generic probe).
LIQUIDITY_PROBE_ADDRESS = "0x0000000000000000000000000000000000000001"

# Share price query: 1e18 to maximize precision for short-term APY estimation
SHARE_PRICE_QUERY_AMOUNT = 10**18
SHARE_PRICE_QUERY_DECIMAL = Decimal(str(SHARE_PRICE_QUERY_AMOUNT))
SECONDS_PER_YEAR = Decimal("31536000")

# ── Minimal ABI slices ──────────────────────────────────────────────────────

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
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "name": "maxWithdraw",
        "type": "function",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"name": "maxAssets", "type": "uint256"}],
        "stateMutability": "view",
    },
]

# PSM3 on Avalanche — totalAssets() to check liquidity pool health.
# PSM3 has NO tin() — there is no deposit fee on Avalanche.
SPARK_PSM3_ABI = [
    {
        "name": "totalAssets",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]


class SparkAdapter(BaseProtocolAdapter):
    """
    Spark Savings Vault adapter for spUSDC on Avalanche C-Chain.

    This adapter is intentionally different from Aave/Benqi:
    - No utilization curve (governance-set rate)
    - No velocity check (step changes from governance are expected)
    - No sanity bound (governed rate won't approach extreme values)
    - No 7-day stability check (step changes are meaningful, not anomalous)
    - No TVL cap (fixed rate doesn't compress under deposit pressure)
    """

    protocol_id = "spark"
    name = "Spark Savings"

    def __init__(self) -> None:
        settings = get_settings()
        self.vault_address = settings.SPARK_SPUSDC
        self.psm3_address = settings.SPARK_PSM3

        if not self.vault_address:
            raise ValueError("SPARK_SPUSDC not configured — set it in .env")

        # Cache for short-term share-price APY estimation (fallback when no DB snapshot)
        self._last_share_price: Decimal | None = None
        self._last_share_price_time: float | None = None
        self._cached_apy: Decimal = Decimal("0")

    def _get_vault_contract(self) -> Any:
        """Get spUSDC vault contract using current active RPC provider."""
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.vault_address),
            abi=SPARK_VAULT_ABI,
        )

    def _get_psm3_contract(self) -> Any | None:
        """Get PSM3 contract for totalAssets() liquidity check.

        Returns None if PSM3 address is not configured or has no deployed code.
        """
        if not self.psm3_address:
            return None
        w3 = get_web3()
        addr = w3.to_checksum_address(self.psm3_address)
        # Validate the address has contract code before calling it
        try:
            code = w3.eth.get_code(addr)
            if len(code) == 0:
                logger.warning(
                    "SPARK_PSM3 address %s has no deployed code — ignoring", self.psm3_address
                )
                return None
        except Exception:
            return None
        return w3.eth.contract(address=addr, abi=SPARK_PSM3_ABI)

    # ── Rate reading ────────────────────────────────────────────────────

    async def get_rate(
        self,
        yesterday_snapshot: Decimal | None = None,
        expected_hold_days: int = DEFAULT_EXPECTED_HOLD_DAYS,
    ) -> ProtocolRate:
        """
        Calculate Spark effective APY on Avalanche.

        Primary:  gross_apy = (today_convertToAssets - yesterday_snapshot) / yesterday × 365
        Fallback: When no DB snapshot exists yet, uses share-price-growth estimation
                  (same pattern as Euler/Silo — observes convertToAssets change over time).

        effective_apy = gross_apy × 1.0  (convertToAssets already reflects the
                        effective depositor yield after the 90/10 split)

        Avalanche PSM3 has NO deposit fee (no tin()), so effective APY is simply
        the convertToAssets-derived APY (no additional adjustment needed).

        If PSM3 totalAssets is near-zero, effective_apy is set to 0 to prevent
        new deposits into an illiquid PSM.
        """
        vault = self._get_vault_contract()

        # Read high-precision share price: convertToAssets(1e18) for both
        # primary APY calculation and fallback estimation.
        # Using 1e18 instead of 1e6 eliminates integer rounding errors.
        high_prec_raw = await vault.functions.convertToAssets(SHARE_PRICE_QUERY_AMOUNT).call()
        today_value = Decimal(str(high_prec_raw))
        current_price = today_value / SHARE_PRICE_QUERY_DECIMAL

        # Read total assets for TVL
        total_assets_raw = await vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / Decimal("1e6")  # USDC 6 decimals

        # Calculate gross APY — prefer 24h DB snapshot, fall back to share-price-growth
        gross_apy = Decimal("0")
        use_snapshot = False

        if yesterday_snapshot is not None and yesterday_snapshot > 0:
            # Guard against scale mismatch: old snapshots used 1e6 scale
            # (values < 10^12), new ones use 1e18 scale (values > 10^12).
            if yesterday_snapshot < Decimal("1000000000000"):
                # Old snapshot was stored at 1e6 scale. Scaling up by 1e12
                # loses ~12 digits of precision, which when annualized (×365)
                # inflates APY by ~44% (e.g. 3.75% → 5.39%). Skip to fallback.
                logger.info(
                    "Spark snapshot scale mismatch: yesterday=%s (1e6 scale) "
                    "vs today=%s (1e18 scale) — skipping to share-price fallback",
                    yesterday_snapshot, today_value,
                )
            else:
                # Primary: 24h delta from DB snapshot (both at 1e18 scale)
                daily_rate = (today_value - yesterday_snapshot) / yesterday_snapshot
                # Compound APY: (1 + daily_rate)^365 - 1
                # Linear (daily_rate * 365) gives APR, not APY.
                gross_apy = (Decimal("1") + daily_rate) ** Decimal("365") - Decimal("1")
                use_snapshot = True

        if not use_snapshot:
            # Fallback: short-term share-price-growth estimation
            # Same pattern as Euler/Silo cached APY — observes price change over ≥60s
            now = time.time()
            if (
                self._last_share_price is not None
                and self._last_share_price_time is not None
                and self._last_share_price > Decimal("0")
            ):
                elapsed = Decimal(str(now - self._last_share_price_time))
                if elapsed > Decimal("60"):
                    growth = (current_price - self._last_share_price) / self._last_share_price
                    if growth > Decimal("0"):
                        # Compound APY: (1 + growth)^periods - 1
                        periods = SECONDS_PER_YEAR / elapsed
                        self._cached_apy = (Decimal("1") + growth) ** periods - Decimal("1")
                    self._last_share_price = current_price
                    self._last_share_price_time = now
                # elapsed < 60s: keep _cached_apy, don't reset observation window
            else:
                # First call: seed the price cache
                self._last_share_price = current_price
                self._last_share_price_time = now
            gross_apy = self._cached_apy

        # convertToAssets already reflects the effective depositor yield
        # (90% deployed yields, 10% buffer), so DEPLOYMENT_RATIO is 1.0.
        deployed_apy = gross_apy * DEPLOYMENT_RATIO

        # Check PSM3 liquidity — if pool is near-empty, effective APY = 0
        # to prevent new deposits into an illiquid PSM.
        effective_apy = deployed_apy
        psm3 = self._get_psm3_contract()
        if psm3:
            try:
                psm3_total = await psm3.functions.totalAssets().call()
                if psm3_total < PSM3_MIN_TOTAL_ASSETS:
                    logger.warning(
                        "Spark PSM3 totalAssets=%d below minimum %d — "
                        "setting effective APY to 0",
                        psm3_total,
                        PSM3_MIN_TOTAL_ASSETS,
                    )
                    effective_apy = Decimal("0")
            except Exception as exc:
                logger.warning("Failed to read PSM3 totalAssets: %s", exc)
                # Conservative: if we can't check PSM3, still report APY
                # but health check will also flag this.

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=gross_apy,
            effective_apy=effective_apy,
            tvl_usd=tvl,
            utilization_rate=None,  # Spark has no utilization concept
            fetched_at=time.time(),
        )

    # ── Health checks ───────────────────────────────────────────────────

    async def get_health(self) -> ProtocolHealth:
        """
        Check Spark protocol health on Avalanche.

        Two checks (Avalanche-specific, replaces Ethereum tin/vat):
        1. spUSDC.maxWithdraw(probe) == 0 → vault has no liquidity → EMERGENCY
        2. PSM3.totalAssets() near-zero  → PSM pool drained → DEPOSITS_DISABLED

        NO utilization check, NO velocity check, NO sanity bound,
        NO 7-day stability check, NO TVL minimum.
        """
        details: dict[str, Any] = {}
        is_deposit_safe = True
        is_withdrawal_safe = True
        status = ProtocolStatus.HEALTHY

        # Check 1: Vault liquidity — can funds actually be withdrawn?
        # replaces vat.live() which doesn't exist on Avalanche.
        vault = self._get_vault_contract()
        try:
            w3 = get_web3()
            max_withdraw = await vault.functions.maxWithdraw(
                w3.to_checksum_address(LIQUIDITY_PROBE_ADDRESS)
            ).call()
            vault_total = await vault.functions.totalAssets().call()
            details["vault_max_withdraw_probe"] = max_withdraw
            details["vault_total_assets"] = vault_total

            # If vault has significant TVL but maxWithdraw returns 0 for a probe,
            # that's expected (probe has no shares). Instead check totalAssets.
            if vault_total == 0:
                # Vault has zero TVL — emergency exit for any existing positions.
                status = ProtocolStatus.EMERGENCY
                is_deposit_safe = False
                is_withdrawal_safe = True  # Still attempt withdrawal
                logger.critical(
                    "EMERGENCY: Spark spUSDC vault totalAssets == 0. "
                    "Vault may be bricked or fully redeemed. Triggering exit."
                )
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=status,
                    is_deposit_safe=is_deposit_safe,
                    is_withdrawal_safe=is_withdrawal_safe,
                    utilization=None,
                    details=details,
                )
        except Exception as exc:
            logger.warning("Failed to read Spark vault state: %s", exc)
            details["vault_error"] = str(exc)
            # Conservative: if we can't even read the vault, mark as degraded
            status = ProtocolStatus.EMERGENCY
            is_deposit_safe = False

        # Check 2: PSM3 liquidity — is the underlying PSM pool healthy?
        # replaces psmWrapper.tin() which doesn't exist on Avalanche PSM3.
        psm3 = self._get_psm3_contract()
        if psm3:
            try:
                psm3_total = await psm3.functions.totalAssets().call()
                details["psm3_total_assets"] = psm3_total
                if psm3_total < PSM3_MIN_TOTAL_ASSETS:
                    # PSM pool is near-empty — new deposits would be unsafe.
                    if status != ProtocolStatus.EMERGENCY:
                        status = ProtocolStatus.DEPOSITS_DISABLED
                    is_deposit_safe = False
                    logger.warning(
                        "Spark PSM3 totalAssets=%d below minimum %d — "
                        "deposits disabled.",
                        psm3_total,
                        PSM3_MIN_TOTAL_ASSETS,
                    )
            except Exception as exc:
                logger.warning("Failed to read PSM3 totalAssets: %s", exc)
                details["psm3_error"] = str(exc)
                # Conservative: if PSM3 unreadable, block new deposits
                is_deposit_safe = False

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=status,
            is_deposit_safe=is_deposit_safe,
            is_withdrawal_safe=is_withdrawal_safe,
            utilization=None,  # Spark has no utilization concept
            details=details,
        )

    # ── Balance reading ─────────────────────────────────────────────────

    async def get_balance(self, user_address: str) -> int:
        """Returns underlying USDC amount by converting shares → assets."""
        vault = self._get_vault_contract()
        w3 = get_web3()
        shares = await vault.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()
        if shares == 0:
            return 0
        return await vault.functions.convertToAssets(shares).call()

    async def get_shares(self, user_address: str) -> int:
        """Returns the user's spUSDC share balance (for share-based redemption)."""
        vault = self._get_vault_contract()
        w3 = get_web3()
        return await vault.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()

    # ── Calldata builders ───────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """Build ERC-4626 deposit(assets, receiver) calldata."""
        vault = self._get_vault_contract()
        w3 = get_web3()
        data = vault.encode_abi(
            "deposit",
            args=[amount, w3.to_checksum_address(on_behalf_of)],
        )
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """
        Build ERC-4626 redeem(shares, receiver, owner) calldata.

        IMPORTANT: Amount is in spUSDC shares, NOT underlying USDC.
        Caller must pass share balance from get_shares().
        """
        vault = self._get_vault_contract()
        w3 = get_web3()
        to_addr = w3.to_checksum_address(to)
        data = vault.encode_abi("redeem", args=[shares_or_amount, to_addr, to_addr])
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    # ── Snapshot helper ─────────────────────────────────────────────────

    async def get_convert_to_assets_value(self) -> int:
        """
        Read current convertToAssets(1e18) value.

        This is stored daily as a snapshot for APY calculation.
        Returns raw integer at 18-digit precision for accurate APY computation.
        Using 1e18 instead of 1e6 eliminates integer rounding errors that
        caused ~1% relative APY error at low yield levels.
        """
        vault = self._get_vault_contract()
        return await vault.functions.convertToAssets(SHARE_PRICE_QUERY_AMOUNT).call()
