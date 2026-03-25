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
SECONDS_PER_YEAR = Decimal("31536000")  # 365 × 86400

# Use large query amount for sub-second APY precision.
# convertToAssets(1e6) returns an integer — at 4.74% APY, the change over 60s
# is < 1 raw unit, so growth rounds to 0.  With 1e18 we get ~100k units of
# precision per minute, enough to detect any meaningful APY.
SHARE_PRICE_QUERY_AMOUNT = 10**18
SHARE_PRICE_QUERY_DECIMAL = Decimal("1e18")

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


class EulerV2Adapter(BaseProtocolAdapter):
    protocol_id = "euler_v2"
    name = "Euler (9Summits)"
    BASE_RISK_SCORE = 5.0  # "Euler v2: 5 (newer, add with caution)"
    is_active = True

    def __init__(self) -> None:
        settings = get_settings()
        self.vault_address: str | None = (
            settings.EULER_VAULT if settings.EULER_VAULT else None
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
            abi=EULER_V2_ABI,
        )

    # ── Rate reading ──────────────────────────────────────────────────────────

    async def get_rate(
        self,
        yesterday_snapshot: Decimal | None = None,
        snapshot_at: str | None = None,
    ) -> ProtocolRate:
        """Compute APY using convertToAssets snapshot delta with ACTUAL elapsed
        time (not hardcoded 24h).

        Primary: When yesterday_snapshot is provided (1e18-scale convertToAssets
        value from ~24h ago), APY = (1 + growth)^(365/elapsed_days) - 1.
        Using actual elapsed time prevents APY inflation when snapshot is
        older than 24h.

        Fallback: When no snapshot exists, observes share-price change over ≥60s
        and compounds to annualized APY.
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

        # Compute utilization: cash = USDC sitting idle in vault, borrowed = totalAssets - cash
        utilization_rate: Decimal | None = None
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
                logger.warning("Euler utilization calculation failed: %s", exc)

        now = time.time()
        today_value = Decimal(str(current_assets))  # raw 1e18-scale value

        # ── Primary: 24h snapshot delta ──────────────────────────────────
        use_snapshot = False
        if yesterday_snapshot is not None and yesterday_snapshot > 0:
            # Guard against scale mismatch: old snapshots may use 1e6 scale
            if yesterday_snapshot < Decimal("1000000000000"):
                logger.info(
                    "Euler snapshot scale mismatch: yesterday=%s (1e6 scale) "
                    "vs today=%s (1e18 scale) — skipping to share-price fallback",
                    yesterday_snapshot, today_value,
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
                    # Compound formula amplifies transient spikes (0.06% daily
                    # → 25% compound vs 22% linear).  Lending pool interest
                    # accrues linearly, so linear matches DefiLlama methodology.
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
        """Health check: vault must have non-zero totalAssets, valid share price,
        and utilization below 95%."""
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

            # Sanity: convertToAssets should return at least 1:1 ratio
            one_usdc = 1_000_000  # 1 USDC in 6 decimals
            test_assets = await vault.functions.convertToAssets(one_usdc).call()
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

        # Check utilization: cash = USDC.balanceOf(vault), utilization = 1 - cash/totalAssets
        utilization: Decimal | None = None
        status = ProtocolStatus.HEALTHY
        is_deposit_safe = True
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
            total = Decimal(str(total_assets))
            utilization = (total - cash) / total
            utilization = max(Decimal("0"), min(utilization, Decimal("1")))

            # Euler 9Summits vault on Avalanche normally operates at 90-93%
            # utilization — the high demand is what drives the elevated APY.
            # A 90% threshold would permanently block deposits.  Use 95% to
            # only exclude when withdrawal liquidity is genuinely constrained.
            if utilization > Decimal("0.95"):
                status = ProtocolStatus.HIGH_UTILIZATION
                is_deposit_safe = False
                logger.info(
                    "Euler utilization %.1f%% > 95%% — marking HIGH_UTILIZATION",
                    float(utilization * 100),
                )
        except Exception as exc:
            logger.warning("Euler utilization check failed: %s — assuming healthy", exc)

        return ProtocolHealth(
            protocol_id=self.protocol_id,
            status=status,
            is_deposit_safe=is_deposit_safe,
            is_withdrawal_safe=True,
            utilization=utilization,
            details={},
        )

    # ── Calldata builders ─────────────────────────────────────────────────────

    def build_supply_calldata(
        self, amount: int, on_behalf_of: str
    ) -> TransactionCalldata:
        """ERC-4626: deposit(uint256 assets, address receiver)"""
        vault = self._get_vault()
        if not vault:
            raise RuntimeError("Euler V2 vault not configured")
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
            raise RuntimeError("Euler V2 vault not configured")
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
        return await vault.functions.convertToAssets(shares).call()

    async def get_convert_to_assets_value(self) -> int:
        """Read current convertToAssets(1e18) for daily snapshot persistence."""
        vault = self._get_vault()
        if not vault:
            raise RuntimeError("Euler V2 vault not configured")
        return await vault.functions.convertToAssets(SHARE_PRICE_QUERY_AMOUNT).call()

    async def get_shares(self, user_address: str) -> int:
        """Returns the raw ERC-4626 share balance for redemption paths."""
        vault = self._get_vault()
        if not vault:
            return 0
        w3 = self._get_w3()
        return await vault.functions.balanceOf(
            w3.to_checksum_address(user_address)
        ).call()
