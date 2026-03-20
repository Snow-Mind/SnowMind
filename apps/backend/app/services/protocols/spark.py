"""
Spark Savings adapter — ERC-4626 vault on Avalanche C-Chain (spUSDC).

APY Source:      convertToAssets(1e6) delta vs 24h-ago snapshot × 365
Effective APY:   gross_apy × 0.90 (only 90% deployed, 10% instant-redemption buffer)
PSM Fee:         psmWrapper.tin() — if > 0, deduct annualized fee from effective APY
                 if tin == type(uint256).max: deposits disabled, exclude from allocation
Emergency:       vat.live() must == 1 (MakerDAO global settlement)

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

MAX_UINT256 = 2**256 - 1
DEPLOYMENT_RATIO = Decimal("0.90")  # Spark V2: only 90% of deposits deployed
DEFAULT_EXPECTED_HOLD_DAYS = 30

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
]

SPARK_PSM_WRAPPER_ABI = [
    {
        "name": "tin",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

MAKER_VAT_ABI = [
    {
        "name": "live",
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
        self.psm_wrapper_address = settings.SPARK_PSM_WRAPPER
        self.vat_address = settings.SPARK_VAT

        if not self.vault_address:
            raise ValueError("SPARK_SPUSDC not configured — set it in .env")

    def _get_vault_contract(self) -> Any:
        """Get spUSDC vault contract using current active RPC provider."""
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.vault_address),
            abi=SPARK_VAULT_ABI,
        )

    def _get_psm_wrapper_contract(self) -> Any | None:
        """Get PSM wrapper contract for tin() reads."""
        if not self.psm_wrapper_address:
            return None
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.psm_wrapper_address),
            abi=SPARK_PSM_WRAPPER_ABI,
        )

    def _get_vat_contract(self) -> Any | None:
        """Get MakerDAO vat contract for live() check."""
        if not self.vat_address:
            return None
        w3 = get_web3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.vat_address),
            abi=MAKER_VAT_ABI,
        )

    # ── Rate reading ────────────────────────────────────────────────────

    async def get_rate(
        self,
        yesterday_snapshot: Decimal | None = None,
        expected_hold_days: int = DEFAULT_EXPECTED_HOLD_DAYS,
    ) -> ProtocolRate:
        """
        Calculate Spark effective APY.

        gross_apy = (today_convertToAssets - yesterday_snapshot) / yesterday × 365
        effective_apy = gross_apy × 0.90 - annualized_psm_fee

        If yesterday_snapshot is None, effective_apy will equal gross × 0.90
        (PSM fee still applied if non-zero).
        """
        vault = self._get_vault_contract()

        # Read current share value: convertToAssets(1e6) = 1 USDC worth of shares
        today_value_raw = await vault.functions.convertToAssets(1_000_000).call()
        today_value = Decimal(str(today_value_raw))

        # Read total assets for TVL
        total_assets_raw = await vault.functions.totalAssets().call()
        tvl = Decimal(str(total_assets_raw)) / Decimal("1e6")  # USDC 6 decimals

        # Calculate gross APY from 24h snapshot delta
        gross_apy = Decimal("0")
        if yesterday_snapshot is not None and yesterday_snapshot > 0:
            daily_rate = (today_value - yesterday_snapshot) / yesterday_snapshot
            gross_apy = daily_rate * Decimal("365")

        # Apply 90% deployment ratio (Spark V2: 10% held as instant redemption buffer)
        deployed_apy = gross_apy * DEPLOYMENT_RATIO

        # Read PSM fee (tin) and calculate annualized cost
        effective_apy = deployed_apy
        tin_value = 0
        psm = self._get_psm_wrapper_contract()
        if psm:
            try:
                tin_value = await psm.functions.tin().call()
                if tin_value == MAX_UINT256:
                    # Deposits disabled — effective APY is 0 (will be excluded)
                    return ProtocolRate(
                        protocol_id=self.protocol_id,
                        apy=gross_apy,
                        effective_apy=Decimal("0"),
                        tvl_usd=tvl,
                        utilization_rate=None,  # Spark has no utilization concept
                        fetched_at=time.time(),
                    )

                if tin_value > 0:
                    fee_rate = Decimal(str(tin_value)) / Decimal("1e18")
                    annualized_psm_cost = fee_rate * (
                        Decimal("365") / Decimal(str(expected_hold_days))
                    )
                    effective_apy = deployed_apy - annualized_psm_cost
            except Exception as exc:
                logger.warning("Failed to read Spark PSM tin: %s", exc)

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
        Check Spark protocol health.

        Only two checks apply to Spark:
        1. vat.live() == 1 — MakerDAO global settlement check
        2. tin value — if type(uint256).max, deposits are disabled

        NO utilization check, NO velocity check, NO sanity bound,
        NO 7-day stability check, NO TVL minimum.
        """
        details: dict[str, Any] = {}
        is_deposit_safe = True
        is_withdrawal_safe = True
        status = ProtocolStatus.HEALTHY

        # Check 1: MakerDAO global settlement (vat.live)
        vat = self._get_vat_contract()
        if vat:
            try:
                vat_live = await vat.functions.live().call()
                details["vat_live"] = vat_live
                if vat_live != 1:
                    # EMERGENCY: MakerDAO global settlement — move ALL funds immediately
                    status = ProtocolStatus.EMERGENCY
                    is_deposit_safe = False
                    is_withdrawal_safe = True  # Still try to withdraw
                    logger.critical(
                        "EMERGENCY: MakerDAO vat.live() = %d (expected 1). "
                        "Global settlement detected. Initiating emergency exit.",
                        vat_live,
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
                logger.warning("Failed to read vat.live(): %s", exc)
                details["vat_error"] = str(exc)

        # Check 2: PSM deposit gate (tin)
        psm = self._get_psm_wrapper_contract()
        if psm:
            try:
                tin_value = await psm.functions.tin().call()
                details["tin"] = str(tin_value)
                if tin_value == MAX_UINT256:
                    status = ProtocolStatus.DEPOSITS_DISABLED
                    is_deposit_safe = False
                    logger.info("Spark deposits disabled: tin == type(uint256).max")
            except Exception as exc:
                logger.warning("Failed to read PSM tin: %s", exc)
                details["tin_error"] = str(exc)

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
        Read current convertToAssets(1e6) value.

        This is stored daily as a snapshot for APY calculation.
        Returns raw integer (6 decimal USDC value of 1 USDC worth of shares).
        """
        vault = self._get_vault_contract()
        return await vault.functions.convertToAssets(1_000_000).call()
