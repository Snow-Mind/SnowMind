"""Folks Finance xChain adapter on Avalanche hub.

Folks is not ERC-4626 and not Aave-like. Deposits/withdrawals require
Account+Loan identifiers, so generic supply/withdraw calldata builders are
intentionally disabled to prevent unsafe call construction.
"""

from __future__ import annotations

import logging
import time
from decimal import Decimal
from typing import Any

from app.core.config import get_settings
from .base import (
    BaseProtocolAdapter,
    ProtocolHealth,
    ProtocolRate,
    ProtocolStatus,
    TransactionCalldata,
    get_shared_async_web3,
)

logger = logging.getLogger("snowmind.protocols.folks")

_ONE = Decimal("1")
_ZERO = Decimal("0")
_ONE_USDC = Decimal("1000000")
_RATE_SCALE = Decimal("1e18")
_HOURS_PER_YEAR = 8760
_MAX_UINT32 = (1 << 32) - 1
_ROUTE_CACHE_TTL_SECONDS = 120.0


# HubPool read ABI
FOLKS_HUB_POOL_ABI = [
    {
        "name": "getDepositData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "optimalUtilisationRatio", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "interestIndex", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getVariableBorrowData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "vr0", "type": "uint256"},
            {"name": "vr1", "type": "uint256"},
            {"name": "vr2", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "interestIndex", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getStableBorrowData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "sr0", "type": "uint256"},
            {"name": "sr1", "type": "uint256"},
            {"name": "sr2", "type": "uint256"},
            {"name": "sr3", "type": "uint256"},
            {"name": "totalAmount", "type": "uint256"},
            {"name": "interestRate", "type": "uint256"},
            {"name": "averageInterestRate", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    {
        "name": "getConfigData",
        "type": "function",
        "inputs": [],
        "outputs": [
            {"name": "deprecated", "type": "bool"},
            {"name": "stableBorrowSupported", "type": "bool"},
            {"name": "flashLoanSupported", "type": "bool"},
        ],
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
        "name": "totalSupply",
        "type": "function",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    },
]

FOLKS_ACCOUNT_MANAGER_ABI = [
    {
        "name": "isAccountCreated",
        "type": "function",
        "inputs": [{"name": "accountId", "type": "bytes32"}],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "getAccountIdOfAddressOnChain",
        "type": "function",
        "inputs": [
            {"name": "addr", "type": "bytes32"},
            {"name": "chainId", "type": "uint16"},
        ],
        "outputs": [{"name": "", "type": "bytes32"}],
        "stateMutability": "view",
    },
]

FOLKS_LOAN_MANAGER_ABI = [
    {
        "name": "isUserLoanActive",
        "type": "function",
        "inputs": [{"name": "loanId", "type": "bytes32"}],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
    },
    {
        "name": "getUserLoan",
        "type": "function",
        "inputs": [{"name": "loanId", "type": "bytes32"}],
        "outputs": [
            {"name": "accountId", "type": "bytes32"},
            {"name": "loanTypeId", "type": "uint16"},
            {"name": "colPools", "type": "uint8[]"},
            {"name": "borPools", "type": "uint8[]"},
            {
                "name": "collaterals",
                "type": "tuple[]",
                "components": [
                    {"name": "balance", "type": "uint256"},
                    {"name": "rewardIndex", "type": "uint256"},
                ],
            },
            {
                "name": "borrows",
                "type": "tuple[]",
                "components": [
                    {"name": "amount", "type": "uint256"},
                    {"name": "balance", "type": "uint256"},
                    {"name": "lastInterestIndex", "type": "uint256"},
                    {"name": "stableInterestRate", "type": "uint256"},
                    {"name": "lastStableUpdateTimestamp", "type": "uint256"},
                    {"name": "rewardIndex", "type": "uint256"},
                ],
            },
        ],
        "stateMutability": "view",
    },
]


class FolksAdapter(BaseProtocolAdapter):
    protocol_id = "folks"
    name = "Folks Finance xChain"

    def __init__(self) -> None:
        settings = get_settings()
        self.hub_pool_address = settings.FOLKS_USDC_HUB_POOL
        self.spoke_common_address = settings.FOLKS_SPOKE_COMMON
        self.spoke_usdc_address = settings.FOLKS_SPOKE_USDC
        self.account_manager_address = settings.FOLKS_ACCOUNT_MANAGER
        self.loan_manager_address = settings.FOLKS_LOAN_MANAGER
        self.hub_chain_id = int(getattr(settings, "FOLKS_HUB_CHAIN_ID", 100))
        self.pool_id = int(getattr(settings, "FOLKS_USDC_POOL_ID", 1))
        self.account_nonce = int(getattr(settings, "FOLKS_ACCOUNT_NONCE", 1))
        self.loan_nonce = int(getattr(settings, "FOLKS_LOAN_NONCE", 1))
        configured_account_scan = int(getattr(settings, "FOLKS_ACCOUNT_NONCE_SCAN_MAX", 128))
        configured_loan_scan = int(getattr(settings, "FOLKS_LOAN_NONCE_SCAN_MAX", 8))
        # Recovery guard: older Folks accounts may use high nonces. Keep account
        # scan floor high enough to rediscover existing positions.
        self.account_nonce_scan_max = min(max(configured_account_scan, 128), 512)
        self.loan_nonce_scan_max = min(max(configured_loan_scan, 4), 64)
        self._route_cache: dict[str, tuple[float, dict[str, Any] | None]] = {}

        if not self.hub_pool_address:
            raise ValueError("FOLKS_USDC_HUB_POOL not configured")

    def _get_w3(self):
        return get_shared_async_web3()

    def _get_hub_pool(self):
        w3 = self._get_w3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.hub_pool_address),
            abi=FOLKS_HUB_POOL_ABI,
        )

    def _get_account_manager(self):
        if not self.account_manager_address:
            return None
        w3 = self._get_w3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.account_manager_address),
            abi=FOLKS_ACCOUNT_MANAGER_ABI,
        )

    def _get_loan_manager(self):
        if not self.loan_manager_address:
            return None
        w3 = self._get_w3()
        return w3.eth.contract(
            address=w3.to_checksum_address(self.loan_manager_address),
            abi=FOLKS_LOAN_MANAGER_ABI,
        )

    @staticmethod
    def _sanitize_nonce(raw_value: int, fallback: int) -> int:
        try:
            parsed = int(raw_value)
        except Exception:
            return fallback
        if parsed < 0 or parsed > _MAX_UINT32:
            return fallback
        return parsed

    @staticmethod
    def _address_to_bytes32(checksum_address: str) -> bytes:
        return bytes.fromhex(checksum_address[2:]).rjust(32, b"\x00")

    @staticmethod
    def _is_zero_bytes32(value: Any) -> bool:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if not normalized.startswith("0x"):
                return False
            try:
                return int(normalized, 16) == 0
            except Exception:
                return False
        if isinstance(value, (bytes, bytearray)):
            return int.from_bytes(value, "big") == 0
        try:
            return int(value) == 0
        except Exception:
            return False

    def _to_hex32(self, value: Any) -> str:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized.startswith("0x"):
                return normalized
            return f"0x{normalized}"
        return self._get_w3().to_hex(value)

    def _build_account_id(self, checksum_user: str, nonce: int, legacy: bool) -> str:
        w3 = self._get_w3()
        nonce_bytes = self._sanitize_nonce(nonce, self.account_nonce).to_bytes(4, "big")
        if legacy:
            digest = w3.solidity_keccak(
                ["address", "uint16", "bytes4"],
                [checksum_user, self.hub_chain_id, nonce_bytes],
            )
        else:
            digest = w3.solidity_keccak(
                ["bytes32", "uint16", "bytes4"],
                [self._address_to_bytes32(checksum_user), self.hub_chain_id, nonce_bytes],
            )
        return w3.to_hex(digest)

    def _build_loan_id(self, account_id: str, nonce: int) -> str:
        w3 = self._get_w3()
        nonce_bytes = self._sanitize_nonce(nonce, self.loan_nonce).to_bytes(4, "big")
        digest = w3.solidity_keccak(["bytes32", "bytes4"], [account_id, nonce_bytes])
        return w3.to_hex(digest)

    @staticmethod
    def _build_nonce_candidates(primary_nonce: int, scan_max: int) -> list[int]:
        max_nonce = max(0, int(scan_max))
        ordered: list[int] = []
        seen: set[int] = set()

        def _push(value: int) -> None:
            if value in seen:
                return
            seen.add(value)
            ordered.append(value)

        _push(max(0, int(primary_nonce)))
        for nonce in range(max_nonce + 1):
            _push(nonce)

        return ordered

    def _get_cached_route(self, user_address: str) -> tuple[bool, dict[str, Any] | None]:
        key = user_address.lower()
        cached = self._route_cache.get(key)
        if not cached:
            return False, None

        expires_at, route = cached
        if time.time() > expires_at:
            self._route_cache.pop(key, None)
            return False, None

        return True, route

    def _set_cached_route(self, user_address: str, route: dict[str, Any] | None) -> None:
        key = user_address.lower()
        self._route_cache[key] = (time.time() + _ROUTE_CACHE_TTL_SECONDS, route)

    async def _lookup_account_id(self, checksum_user: str) -> str | None:
        account_manager = self._get_account_manager()
        if account_manager is None:
            return None

        try:
            account_id = await account_manager.functions.getAccountIdOfAddressOnChain(
                self._address_to_bytes32(checksum_user),
                self.hub_chain_id,
            ).call()
        except Exception:
            return None

        if self._is_zero_bytes32(account_id):
            return None
        return self._to_hex32(account_id)

    async def _extract_pool_f_token_balance(self, loan_id: str) -> int:
        loan_manager = self._get_loan_manager()
        if loan_manager is None:
            return 0

        try:
            user_loan = await loan_manager.functions.getUserLoan(loan_id).call()
        except Exception:
            return 0

        col_pools = list(user_loan[2] or [])
        collaterals = list(user_loan[4] or [])
        for idx, raw_pool_id in enumerate(col_pools):
            if int(raw_pool_id) != self.pool_id:
                continue
            if idx >= len(collaterals):
                return 0
            collateral = collaterals[idx]
            if isinstance(collateral, (list, tuple)) and len(collateral) >= 1:
                return int(collateral[0])
            return 0

        return 0

    async def _resolve_active_position(self, user_address: str) -> dict[str, Any] | None:
        cached_hit, cached_route = self._get_cached_route(user_address)
        if cached_hit:
            return cached_route

        loan_manager = self._get_loan_manager()
        if loan_manager is None:
            self._set_cached_route(user_address, None)
            return None

        w3 = self._get_w3()
        checksum_user = w3.to_checksum_address(user_address)
        account_nonce_candidates = self._build_nonce_candidates(self.account_nonce, self.account_nonce_scan_max)
        loan_nonce_candidates = self._build_nonce_candidates(self.loan_nonce, self.loan_nonce_scan_max)

        account_ids: list[tuple[str, int, str]] = []
        seen_account_ids: set[str] = set()

        looked_up_account_id = await self._lookup_account_id(checksum_user)
        if looked_up_account_id:
            normalized = looked_up_account_id.lower()
            seen_account_ids.add(normalized)
            account_ids.append((looked_up_account_id, self.account_nonce, "registered"))

        for account_nonce in account_nonce_candidates:
            canonical = self._build_account_id(checksum_user, account_nonce, legacy=False)
            canonical_key = canonical.lower()
            if canonical_key not in seen_account_ids:
                seen_account_ids.add(canonical_key)
                account_ids.append((canonical, account_nonce, "canonical"))

            legacy = self._build_account_id(checksum_user, account_nonce, legacy=True)
            legacy_key = legacy.lower()
            if legacy_key not in seen_account_ids:
                seen_account_ids.add(legacy_key)
                account_ids.append((legacy, account_nonce, "legacy"))

        fallback_active_route: dict[str, Any] | None = None
        for account_id, account_nonce, source in account_ids:
            account_created = True
            if source != "registered":
                account_manager = self._get_account_manager()
                if account_manager is not None:
                    try:
                        account_created = bool(
                            await account_manager.functions.isAccountCreated(account_id).call()
                        )
                    except Exception:
                        account_created = False
            if not account_created:
                continue

            for loan_nonce in loan_nonce_candidates:
                loan_id = self._build_loan_id(account_id, loan_nonce)
                try:
                    loan_active = bool(await loan_manager.functions.isUserLoanActive(loan_id).call())
                except Exception:
                    continue
                if not loan_active:
                    continue

                f_token_balance = await self._extract_pool_f_token_balance(loan_id)
                route = {
                    "account_id": account_id,
                    "loan_id": loan_id,
                    "account_nonce": account_nonce,
                    "loan_nonce": loan_nonce,
                    "f_token_balance": f_token_balance,
                    "source": source,
                }

                if f_token_balance > 0:
                    self._set_cached_route(user_address, route)
                    return route

                if fallback_active_route is None:
                    fallback_active_route = route

        self._set_cached_route(user_address, fallback_active_route)
        return fallback_active_route

    @staticmethod
    def _compute_hourly_compounded_apy(annual_rate: Decimal) -> Decimal:
        """Compute APY from annual WAD-scaled deposit rate.

        Folks hub pool `getDepositData().interestRate` is annualized with 1e18
        precision. Convert annual rate -> hourly APR and compound hourly.
        """
        if annual_rate <= _ZERO:
            return _ZERO

        hourly_rate = annual_rate / Decimal(str(_HOURS_PER_YEAR))
        hourly_factor = _ONE + hourly_rate
        if hourly_factor <= _ZERO:
            return _ZERO
        return max((hourly_factor ** _HOURS_PER_YEAR) - _ONE, _ZERO)

    async def get_rate(self) -> ProtocolRate:
        pool = self._get_hub_pool()
        now = time.time()
        try:
            deposit_data = await pool.functions.getDepositData().call()
            variable_borrow_data = await pool.functions.getVariableBorrowData().call()
            stable_borrow_data = await pool.functions.getStableBorrowData().call()

            total_deposit_raw = int(deposit_data[1])
            deposit_rate_raw = int(deposit_data[2])
            variable_borrow_raw = int(variable_borrow_data[3])
            stable_borrow_raw = int(stable_borrow_data[4])

            tvl_usd = Decimal(str(total_deposit_raw)) / _ONE_USDC
            annual_rate = Decimal(str(deposit_rate_raw)) / _RATE_SCALE
            apy = self._compute_hourly_compounded_apy(annual_rate)

            utilization_rate: Decimal | None = None
            if total_deposit_raw > 0:
                total_borrow = Decimal(str(variable_borrow_raw + stable_borrow_raw))
                utilization_rate = total_borrow / Decimal(str(total_deposit_raw))
                utilization_rate = max(_ZERO, min(utilization_rate, _ONE))

            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=apy,
                effective_apy=apy,
                tvl_usd=max(tvl_usd, _ZERO),
                utilization_rate=utilization_rate,
                fetched_at=now,
            )
        except Exception as exc:
            logger.warning("Folks get_rate failed: %s", exc)
            return ProtocolRate(
                protocol_id=self.protocol_id,
                apy=_ZERO,
                effective_apy=_ZERO,
                tvl_usd=_ZERO,
                utilization_rate=None,
                fetched_at=now,
            )

    async def get_health(self) -> ProtocolHealth:
        pool = self._get_hub_pool()
        settings = get_settings()

        try:
            config = await pool.functions.getConfigData().call()
            deposit_data = await pool.functions.getDepositData().call()
            variable_borrow_data = await pool.functions.getVariableBorrowData().call()
            stable_borrow_data = await pool.functions.getStableBorrowData().call()

            deprecated = bool(config[0])
            total_deposit_raw = int(deposit_data[1])
            variable_borrow_raw = int(variable_borrow_data[3])
            stable_borrow_raw = int(stable_borrow_data[4])

            utilization: Decimal | None = None
            if total_deposit_raw > 0:
                utilization = Decimal(str(variable_borrow_raw + stable_borrow_raw)) / Decimal(
                    str(total_deposit_raw)
                )
                utilization = max(_ZERO, min(utilization, _ONE))

            if deprecated:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.DEPOSITS_DISABLED,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=utilization,
                    details={"reason": "Folks pool marked deprecated"},
                )

            threshold = Decimal(str(settings.UTILIZATION_THRESHOLD))
            if utilization is not None and utilization > threshold:
                return ProtocolHealth(
                    protocol_id=self.protocol_id,
                    status=ProtocolStatus.HIGH_UTILIZATION,
                    is_deposit_safe=False,
                    is_withdrawal_safe=True,
                    utilization=utilization,
                    details={
                        "reason": "Utilization above configured threshold",
                        "threshold": str(threshold),
                    },
                )

            return ProtocolHealth(
                protocol_id=self.protocol_id,
                status=ProtocolStatus.HEALTHY,
                is_deposit_safe=True,
                is_withdrawal_safe=True,
                utilization=utilization,
                details={},
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

    async def get_balance(self, user_address: str) -> int:
        """Return underlying USDC amount from Folks fToken share balance."""
        pool = self._get_hub_pool()
        shares = int(await self.get_shares(user_address))
        if shares <= 0:
            return 0

        total_supply = int(await pool.functions.totalSupply().call())
        if total_supply <= 0:
            return 0

        deposit_data = await pool.functions.getDepositData().call()
        total_deposit_raw = int(deposit_data[1])
        if total_deposit_raw <= 0:
            return 0

        return (shares * total_deposit_raw) // total_supply

    async def get_shares(self, user_address: str) -> int:
        route = await self._resolve_active_position(user_address)
        if route and int(route.get("f_token_balance", 0)) > 0:
            return int(route["f_token_balance"])

        pool = self._get_hub_pool()
        w3 = self._get_w3()
        return int(await pool.functions.balanceOf(w3.to_checksum_address(user_address)).call())

    def build_supply_calldata(self, amount: int, on_behalf_of: str) -> TransactionCalldata:
        del amount
        del on_behalf_of
        raise RuntimeError(
            "Folks requires accountId/loanId and custom spoke calls. "
            "Use execution-service Folks routing instead of generic adapter calldata."
        )

    def build_withdraw_calldata(self, shares_or_amount: int, to: str) -> TransactionCalldata:
        del shares_or_amount
        del to
        raise RuntimeError(
            "Folks requires accountId/loanId and custom spoke calls. "
            "Use execution-service Folks routing instead of generic adapter calldata."
        )