"""Silo V2 adapter — ERC-4626 vault interface on Avalanche.

Supports isolated lending vaults:
  - savUSD/USDC  vault = 0x606fe9a70338e798a292CA22C1F28C829F24048E (bUSDC-142)
  - sUSDp/USDC   vault = 0x8ad697a333569ca6f04c8c063e9807747ef169c1 (bUSDC-162)
    - Gami USDC    vault = 0x1F0570a081FeE0e4dF6eAC470f9d2D53CDEDa1c5 (Silo V3 curator vault)

These vaults implement the standard ERC-4626 interface:
  deposit(assets, receiver) / redeem(shares, receiver, owner)
  convertToAssets(shares) / totalAssets()

The Gami Silo V3 vault is ERC-4626-compatible but does not expose Silo V2
helpers like utilizationData()/siloConfig(). The dedicated adapter below
intentionally avoids those calls and reports utilization as unavailable.

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
    {
        "name": "utilizationData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "collateralAssets", "type": "uint256"},
                    {"name": "debtAssets", "type": "uint256"},
                    {"name": "interestRateTimestamp", "type": "uint64"},
                ],
            }
        ],
        "stateMutability": "view",
    },
    {
        "name": "siloConfig",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "address"}],
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
SECONDS_PER_YEAR = Decimal("31536000")  # 365 × 86400

# Minimal ERC-20 ABI for reading vault cash (USDC.balanceOf(vault))
_ERC20_BALANCE_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]

# SiloConfig ABI slice for interest-model/fee lookup
_SILO_CONFIG_ABI = [
    {
        "name": "getConfig",
        "type": "function",
        "inputs": [{"name": "_silo", "type": "address"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "daoFee", "type": "uint256"},
                    {"name": "deployerFee", "type": "uint256"},
                    {"name": "silo", "type": "address"},
                    {"name": "token", "type": "address"},
                    {"name": "protectedShareToken", "type": "address"},
                    {"name": "collateralShareToken", "type": "address"},
                    {"name": "debtShareToken", "type": "address"},
                    {"name": "solvencyOracle", "type": "address"},
                    {"name": "maxLtvOracle", "type": "address"},
                    {"name": "interestRateModel", "type": "address"},
                    {"name": "maxLtv", "type": "uint256"},
                    {"name": "lt", "type": "uint256"},
                    {"name": "liquidationTargetLtv", "type": "uint256"},
                    {"name": "liquidationFee", "type": "uint256"},
                    {"name": "flashloanFee", "type": "uint256"},
                    {"name": "hookReceiver", "type": "address"},
                    {"name": "callBeforeQuote", "type": "bool"},
                ],
            }
        ],
        "stateMutability": "view",
    }
]

# IRM ABI slice for current borrow APR
_INTEREST_RATE_MODEL_ABI = [
    {
        "name": "getCurrentInterestRate",
        "type": "function",
        "inputs": [
            {"name": "_silo", "type": "address"},
            {"name": "_blockTimestamp", "type": "uint256"},
        ],
        "outputs": [{"name": "rcur", "type": "uint256"}],
        "stateMutability": "view",
    }
]

WAD = Decimal("1e18")


def _compute_silo_depositor_apr(
    borrow_apr: Decimal,
    utilization: Decimal,
    dao_fee_wad: Decimal,
    deployer_fee_wad: Decimal,
) -> Decimal:
    """Compute live depositor APR from Silo borrow APR/utilization/fees."""
    util_clamped = max(Decimal("0"), min(utilization, Decimal("1")))
    fee_fraction = (dao_fee_wad + deployer_fee_wad) / WAD
    fee_clamped = max(Decimal("0"), min(fee_fraction, Decimal("1")))
    apr = borrow_apr * util_clamped * (Decimal("1") - fee_clamped)
    return max(Decimal("0"), apr)


class SiloAdapter(BaseProtocolAdapter):
    """Generic ERC-4626 adapter for a single Silo vault.

    Instantiated once per Silo market (savUSD/USDC, sUSDp/USDC).
    APY is derived from the share price growth rate via convertToAssets().
    """

    # Subclasses override these
    protocol_id: str = ""
    name: str = ""
    is_active: bool = True

    def __init__(self, vault_address: str | None) -> None:
        self.vault_address: str | None = vault_address if vault_address else None
        if self.vault_address:
            logger.info(
                "%s using vault address: %s", self.protocol_id or self.name, self.vault_address
            )
        # Cache for share price APY estimation
        self._last_share_price: Decimal | None = None
        self._last_share_price_time: float | None = None
        self._cached_apy: Decimal = Decimal("0")

    def _get_w3(self):
        """Get current active web3 instance (may rotate on 429)."""
        return get_shared_async_web3()

    def _get_vault(self):
        """Get vault contract using the current active RPC provider."""
        if not self.vault_address:
            return None
        w3 = self._get_w3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.vault_address),
            abi=SILO_VAULT_ABI,
        )

    async def _read_live_depositor_apr(
        self,
        vault,
    ) -> tuple[Decimal | None, Decimal | None]:
        """Read live depositor APR from Silo's on-chain IRM.

        Formula (matches market UI):
          depositor_apr = borrow_apr * utilization * (1 - dao_fee - deployer_fee)
        where all fee and rate scalars are WAD (1e18).
        """
        try:
            w3 = self._get_w3()

            utilization_raw = await vault.functions.utilizationData().call()
            collateral_assets = Decimal(str(utilization_raw[0]))
            debt_assets = Decimal(str(utilization_raw[1]))
            interest_rate_timestamp = int(utilization_raw[2]) if len(utilization_raw) > 2 else 0
            utilization = (
                debt_assets / collateral_assets
                if collateral_assets > Decimal("0")
                else Decimal("0")
            )
            utilization = max(Decimal("0"), min(utilization, Decimal("1")))

            silo_config_address = await vault.functions.siloConfig().call()
            if not silo_config_address:
                return None, utilization

            config_contract = w3.eth.contract(
                address=w3.to_checksum_address(silo_config_address),
                abi=_SILO_CONFIG_ABI,
            )
            cfg = await config_contract.functions.getConfig(
                w3.to_checksum_address(self.vault_address)
            ).call()

            dao_fee = Decimal(str(cfg[0] if len(cfg) > 0 else 0))
            deployer_fee = Decimal(str(cfg[1] if len(cfg) > 1 else 0))
            irm_address = cfg[9] if len(cfg) > 9 else None
            if not irm_address:
                return None, utilization

            irm_contract = w3.eth.contract(
                address=w3.to_checksum_address(irm_address),
                abi=_INTEREST_RATE_MODEL_ABI,
            )
            # Use timestamp emitted by utilizationData() to avoid RPC block
            # decoding edge cases while staying anchored to on-chain state.
            block_timestamp = interest_rate_timestamp if interest_rate_timestamp > 0 else int(time.time())
            borrow_apr_raw = await irm_contract.functions.getCurrentInterestRate(
                w3.to_checksum_address(self.vault_address),
                block_timestamp,
            ).call()

            borrow_apr = Decimal(str(borrow_apr_raw)) / WAD
            depositor_apr = _compute_silo_depositor_apr(
                borrow_apr=borrow_apr,
                utilization=utilization,
                dao_fee_wad=dao_fee,
                deployer_fee_wad=deployer_fee,
            )

            return depositor_apr, utilization
        except Exception as exc:
            logger.warning(
                "Silo live APR read failed for %s: %s",
                self.protocol_id,
                exc,
            )
            return None, None

    # ── Rate reading ──────────────────────────────────────────────────────────

    async def get_rate(
        self,
        yesterday_snapshot: Decimal | None = None,
        snapshot_at: str | None = None,
    ) -> ProtocolRate:
        """Compute APY using live IRM APR (UI-aligned), fallback to share-price growth.

        Primary: live on-chain depositor APR from Silo interest-rate model.
        Fallback: convertToAssets snapshot delta / short-horizon share-price growth.
        """
        import datetime as _dt
        vault = self._get_vault()
        if not vault:
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=Decimal("0"),
                effective_apy=Decimal("0"),
                tvl_usd=Decimal("0"),
                utilization_rate=None,
                fetched_at=time.time(),
            )

        # Read current share price with high precision
        current_assets = await vault.functions.convertToAssets(
            SHARE_PRICE_QUERY_AMOUNT
        ).call()
        current_price = Decimal(str(current_assets)) / SHARE_PRICE_QUERY_DECIMAL

        total_assets_raw = await vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / ONE_USDC

        now = time.time()

        live_apy, utilization_rate = await self._read_live_depositor_apr(vault)
        if live_apy is not None:
            self._cached_apy = live_apy
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=self._cached_apy,
                effective_apy=self._cached_apy,
                tvl_usd=tvl,
                utilization_rate=utilization_rate,
                fetched_at=now,
            )

        # Compute utilization: cash = USDC sitting idle in vault, borrowed = totalAssets - cash
        # Fallback path only when live IRM read fails.
        if total_assets_raw > 0:
            try:
                settings = get_settings()
                w3 = self._get_w3()
                usdc_contract = w3.eth.contract(
                    address=w3.to_checksum_address(settings.USDC_ADDRESS),
                    abi=_ERC20_BALANCE_ABI,
                )
                cash_raw = await usdc_contract.functions.balanceOf(
                    w3.to_checksum_address(self.vault_address)
                ).call()
                cash = Decimal(str(cash_raw))
                total = Decimal(str(total_assets_raw))
                utilization_rate = (total - cash) / total
                utilization_rate = max(Decimal("0"), min(utilization_rate, Decimal("1")))
            except Exception as exc:
                logger.warning("Silo utilization calculation failed for %s: %s", self.protocol_id, exc)

        today_value = Decimal(str(current_assets))  # raw 1e18-scale value

        # ── Primary: 24h snapshot delta ──────────────────────────────────
        use_snapshot = False
        if yesterday_snapshot is not None and yesterday_snapshot > 0:
            if yesterday_snapshot < Decimal("1000000000000"):
                logger.info(
                    "%s snapshot scale mismatch: yesterday=%s (1e6) "
                    "vs today=%s (1e18) — fallback",
                    self.protocol_id, yesterday_snapshot, today_value,
                )
            else:
                growth = (today_value - yesterday_snapshot) / yesterday_snapshot
                if growth > Decimal("0"):
                    # Use ACTUAL elapsed time, not hardcoded 24h
                    elapsed_days = Decimal("1")  # default fallback
                    if snapshot_at:
                        try:
                            snap_dt = _dt.datetime.fromisoformat(
                                snapshot_at.replace("Z", "+00:00")
                            )
                            now_dt = _dt.datetime.now(_dt.timezone.utc)
                            elapsed_s = Decimal(
                                str((now_dt - snap_dt).total_seconds())
                            )
                            if elapsed_s > Decimal("3600"):
                                elapsed_days = elapsed_s / Decimal("86400")
                        except (ValueError, TypeError):
                            pass
                    # Linear annualization: APY = daily_growth × 365
                    # Compound formula amplifies transient spikes.
                    daily_growth = growth / elapsed_days
                    self._cached_apy = daily_growth * Decimal("365")
                    use_snapshot = True

        # ── Fallback: share-price growth observation ─────────────────────
        if not use_snapshot:
            if (
                self._last_share_price is not None
                and self._last_share_price_time is not None
                and self._last_share_price > Decimal("0")
            ):
                elapsed = Decimal(str(now - self._last_share_price_time))
                if elapsed > Decimal("60"):  # At least 1 minute between readings
                    growth = (current_price - self._last_share_price) / self._last_share_price
                    if growth > Decimal("0"):
                        # Linear annualization for consistency with snapshot method
                        seconds_elapsed = elapsed
                        daily_growth = growth * (Decimal("86400") / seconds_elapsed)
                        self._cached_apy = daily_growth * Decimal("365")
                    self._last_share_price = current_price
                    self._last_share_price_time = now
            else:
                self._last_share_price = current_price
                self._last_share_price_time = now

        return ProtocolRate(
            protocol_id=self.protocol_id,
            apy=self._cached_apy,
            effective_apy=self._cached_apy,
            tvl_usd=tvl,
            utilization_rate=utilization_rate,
            fetched_at=now,
        )

    async def get_health(self) -> ProtocolHealth:
        """Health check: vault must be configured, have non-zero totalAssets,
        and utilization below 90%."""
        vault = self._get_vault()
        if not vault:
            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.EXCLUDED,
                is_deposit_safe=False,
                is_withdrawal_safe=False,
                utilization=None,
                details={"reason": "Vault not configured"},
            )

        try:
            total_assets = await vault.functions.totalAssets().call()
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
            test_assets = await vault.functions.convertToAssets(
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

        # Check utilization using Silo's utilizationData.
        utilization: Decimal | None = None
        status = ProtocolStatus.HEALTHY
        is_deposit_safe = True
        try:
            utilization_raw = await vault.functions.utilizationData().call()
            collateral_assets = Decimal(str(utilization_raw[0]))
            debt_assets = Decimal(str(utilization_raw[1]))
            utilization = (
                debt_assets / collateral_assets
                if collateral_assets > Decimal("0")
                else Decimal("0")
            )
            utilization = max(Decimal("0"), min(utilization, Decimal("1")))

            if utilization > Decimal("0.90"):
                status = ProtocolStatus.HIGH_UTILIZATION
                is_deposit_safe = False
                logger.info(
                    "Silo %s utilization %.1f%% > 90%% — marking HIGH_UTILIZATION",
                    self.protocol_id, float(utilization * 100),
                )
        except Exception as exc:
            logger.warning("Silo %s utilization check failed: %s — assuming healthy", self.protocol_id, exc)

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=status,
            is_deposit_safe=is_deposit_safe,
            is_withdrawal_safe=True,
            utilization=utilization,
            details={},
        )

    async def get_utilization(self) -> Decimal | None:
        """Read utilization from Silo's native utilizationData."""
        vault = self._get_vault()
        if not vault or not self.vault_address:
            return None

        utilization_raw = await vault.functions.utilizationData().call()
        collateral_assets = Decimal(str(utilization_raw[0]))
        debt_assets = Decimal(str(utilization_raw[1]))
        utilization = (
            debt_assets / collateral_assets
            if collateral_assets > Decimal("0")
            else Decimal("0")
        )
        return max(Decimal("0"), min(utilization, Decimal("1")))

    # ── Snapshot helper ──────────────────────────────────────────────────

    async def get_convert_to_assets_value(self) -> int:
        """Read current convertToAssets(1e18) for daily snapshot persistence."""
        vault = self._get_vault()
        if not vault:
            raise RuntimeError(f"Silo vault not configured for {self.protocol_id}")
        return await vault.functions.convertToAssets(SHARE_PRICE_QUERY_AMOUNT).call()

    # ── Calldata builders ─────────────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """ERC-4626: deposit(uint256 assets, address receiver)"""
        vault = self._get_vault()
        if not vault:
            raise RuntimeError(f"Silo vault not configured for {self.protocol_id}")
        w3 = self._get_w3()
        data = vault.encode_abi(
            "deposit",
            args=[amount, w3.to_checksum_address(on_behalf_of)],
        )
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    def build_withdraw_calldata(
        self, shares_or_amount: int, to: str
    ) -> TransactionCalldata:
        """ERC-4626: redeem(uint256 shares, address receiver, address owner)"""
        vault = self._get_vault()
        if not vault:
            raise RuntimeError(f"Silo vault not configured for {self.protocol_id}")
        w3 = self._get_w3()
        to_addr = w3.to_checksum_address(to)
        data = vault.encode_abi("redeem", args=[shares_or_amount, to_addr, to_addr])
        return TransactionCalldata(to=self.vault_address, data=data, value=0)

    # ── Balance ───────────────────────────────────────────────────────────────

    async def get_balance(self, user_address: str) -> int:
        """Returns underlying USDC amount by converting shares → assets."""
        vault = self._get_vault()
        if not vault:
            return 0
        w3 = self._get_w3()
        shares = await vault.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()
        if shares == 0:
            return 0
        return await vault.functions.convertToAssets(shares).call()

    async def get_shares(self, user_address: str) -> int:
        """Returns the raw ERC-4626 share balance for redemption paths."""
        vault = self._get_vault()
        if not vault:
            return 0
        w3 = self._get_w3()
        return await vault.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()


# ── Concrete adapters (one per Silo market) ───────────────────────────────────

class SiloSavUSDAdapter(SiloAdapter):
    """savUSD/USDC Silo vault on Avalanche."""
    protocol_id = "silo_savusd_usdc"
    name = "Silo (savUSD/USDC)"
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(vault_address=settings.SILO_SAVUSD_VAULT)


class SiloSUSDpAdapter(SiloAdapter):
    """sUSDp/USDC Silo vault on Avalanche."""
    protocol_id = "silo_susdp_usdc"
    name = "Silo (sUSDp/USDC)"
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(vault_address=settings.SILO_SUSDP_VAULT)


class SiloGamiUSDCAdapter(SiloAdapter):
    """Silo V3 Gami USDC curator vault on Avalanche."""

    protocol_id = "silo_gami_usdc"
    name = "Silo V3 (Gami USDC)"
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        super().__init__(vault_address=settings.SILO_GAMI_USDC_VAULT)

    async def _read_live_depositor_apr(self, vault) -> tuple[Decimal | None, Decimal | None]:
        """Gami vault doesn't expose Silo V2 IRM helpers; use share-price APY path."""
        del vault
        return None, None

    async def get_utilization(self) -> Decimal | None:
        """Utilization is not exposed by the Gami vault interface."""
        return None

    async def get_health(self) -> ProtocolHealth:
        """Health check for ERC-4626 compatibility and non-zero vault state."""
        vault = self._get_vault()
        if not vault:
            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.EXCLUDED,
                is_deposit_safe=False,
                is_withdrawal_safe=False,
                utilization=None,
                details={"reason": "Vault not configured"},
            )

        try:
            total_assets = await vault.functions.totalAssets().call()
            if total_assets == 0:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.EMERGENCY,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=None,
                    details={"reason": "totalAssets is zero — vault may be drained"},
                )

            test_assets = await vault.functions.convertToAssets(
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
            details={"note": "Utilization unavailable for Silo V3 Gami vault interface"},
        )
