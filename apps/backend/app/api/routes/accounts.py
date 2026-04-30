"""Account registration, lookup, and session-key management."""

import asyncio
import logging
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import (
    assert_owner_matches_claims,
    require_privy_auth,
    verify_account_ownership,
)
from app.core.validators import validate_eth_address
from app.models.account import (
    AccountDetailResponse,
    AccountResponse,
    DiversificationPref,
    SessionKeyStatusResponse,
)
from app.services.execution.session_key import (
    get_active_session_key_metadata,
    revoke_session_key,
    store_session_key,
)
from app.services.execution.executor import verify_userop_execution
from app.services.protocols import ACTIVE_ADAPTERS, get_adapter
from app.services.protocols.base import get_shared_async_web3


logger = logging.getLogger("snowmind")

router = APIRouter()  # Auth applied per-endpoint

_DEFAULT_ALLOWED_PROTOCOLS = [
    "aave_v3",
    "benqi",
    "spark",
    "euler_v2",
    "silo_savusd_usdc",
    "silo_susdp_usdc",
]

_ACCOUNT_REACTIVATION_DUST_USDC = Decimal("0.01")
_ACCOUNT_BALANCE_READ_TIMEOUT_SECONDS = 8.0
_MAX_DEPOSIT_REQUEST_USDC = Decimal("10000000")
_TX_HASH_PATTERN = re.compile(r"^0x[a-f0-9]{64}$")
_ERC20_BALANCE_OF_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]


def _canonical_protocol_id(raw_protocol_id: str) -> str:
    pid = str(raw_protocol_id).strip().lower()
    if pid == "aave":
        return "aave_v3"
    return pid


def _normalize_allowed_protocols(protocols: list[str] | None) -> list[str]:
    """Normalize allowed protocol IDs to canonical values and preserve order."""
    if not protocols:
        return []

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in protocols:
        pid = _canonical_protocol_id(raw)
        if not pid:
            continue
        if pid not in _DEFAULT_ALLOWED_PROTOCOLS:
            continue
        if pid in seen:
            continue
        seen.add(pid)
        normalized.append(pid)
    return normalized


def _normalize_allocation_caps(
    caps: dict[str, object] | None,
    *,
    strict: bool = False,
) -> dict[str, int] | None:
    """Normalize per-protocol max allocation caps.

    Returns a canonical ``{protocol_id: integer_percent}`` mapping where values
    are constrained to ``0..100``. ``None`` means no explicit caps (equivalent to
    100% for all protocols).
    """
    if caps is None:
        return None
    if not isinstance(caps, dict):
        if strict:
            raise ValueError("allocationCaps must be an object")
        return None

    normalized: dict[str, int] = {}
    for raw_pid, raw_value in caps.items():
        pid = _canonical_protocol_id(str(raw_pid))
        if pid not in _DEFAULT_ALLOWED_PROTOCOLS:
            if strict:
                raise ValueError(f"Invalid protocol in allocationCaps: {raw_pid}")
            continue

        value: int | None = None
        if isinstance(raw_value, bool):
            value = None
        elif isinstance(raw_value, int):
            value = raw_value
        elif isinstance(raw_value, float) and raw_value.is_integer():
            value = int(raw_value)
        elif isinstance(raw_value, str):
            stripped = raw_value.strip()
            if stripped.isdigit() or (
                stripped.startswith("-") and stripped[1:].isdigit()
            ):
                value = int(stripped)

        if value is None or value < 0 or value > 100:
            if strict:
                raise ValueError(
                    f"allocationCaps[{pid}] must be an integer between 0 and 100"
                )
            continue

        normalized[pid] = value

    if not normalized:
        return None
    return normalized


def _resolve_scope_protocols(protocols: list[str] | None) -> list[str]:
    """Return a normalized protocol scope, defaulting to all supported markets."""
    normalized = _normalize_allowed_protocols(protocols)
    if normalized:
        return normalized
    return list(_DEFAULT_ALLOWED_PROTOCOLS)


def _scope_allocation_caps(
    caps: dict[str, int] | None,
    allowed_protocols: list[str] | None,
) -> dict[str, int] | None:
    """Keep only cap entries that belong to the provided allowed protocol scope."""
    if caps is None:
        return None

    allowed_set = set(_resolve_scope_protocols(allowed_protocols))
    scoped = {
        pid: max(0, min(int(value), 100))
        for pid, value in caps.items()
        if pid in allowed_set
    }
    return scoped or None


def _effective_cap_total_pct(
    caps: dict[str, int] | None,
    allowed_protocols: list[str] | None,
) -> int:
    """Return aggregate effective cap total over the current allowed scope.

    Missing protocol caps are treated as 100% (unbounded for that protocol).
    This helps detect user configurations that can leave funds intentionally idle
    when combined caps across selected markets are below 100%.
    """
    total = 0
    for pid in _resolve_scope_protocols(allowed_protocols):
        if caps is None:
            cap_value = 100
        else:
            cap_value = int(caps.get(pid, 100))
        total += max(0, min(cap_value, 100))
    return total


def _has_deployable_cap(
    caps: dict[str, int] | None,
    allowed_protocols: list[str] | None,
) -> bool:
    """Return True when at least one allowed protocol can receive deposits."""
    for pid in _resolve_scope_protocols(allowed_protocols):
        if caps is None:
            return True
        cap_value = int(caps.get(pid, 100))
        if cap_value > 0:
            return True
    return False


def _resolve_allowed_protocols(
    db: Client,
    account_id: str,
    requested_protocols: list[str] | None,
) -> list[str]:
    """Resolve protocol scope for session-key storage.

    Priority:
      1) Explicit protocols from request.
      2) Most recent stored session-key scope for this account.
      3) Default full protocol set.
    """
    requested = _normalize_allowed_protocols(requested_protocols)
    if requested:
        return requested

    try:
        latest = (
            db.table("session_keys")
            .select("allowed_protocols")
            .eq("account_id", account_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if latest.data:
            preserved = _normalize_allowed_protocols(latest.data[0].get("allowed_protocols"))
            if preserved:
                return preserved
    except Exception as exc:
        logger.warning("Failed to reuse previous allowed_protocols for %s: %s", account_id, exc)

    return list(_DEFAULT_ALLOWED_PROTOCOLS)


def _resolve_allocation_caps(
    db: Client,
    account_id: str,
    requested_caps: dict[str, object] | None,
) -> dict[str, int] | None:
    """Resolve per-protocol cap map for session-key storage.

    Priority:
      1) Explicit caps from request.
      2) Most recent stored session-key caps for this account.
      3) ``None`` (means 100% for all protocols).
    """
    explicit = _normalize_allocation_caps(requested_caps, strict=True)
    if explicit is not None:
        return explicit

    try:
        latest = (
            db.table("session_keys")
            .select("allocation_caps")
            .eq("account_id", account_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if latest.data:
            preserved = _normalize_allocation_caps(
                latest.data[0].get("allocation_caps"),
                strict=False,
            )
            if preserved is not None:
                return preserved
    except Exception as exc:
        logger.warning("Failed to reuse previous allocation_caps for %s: %s", account_id, exc)

    return None


def _find_excluded_funded_protocols(
    db: Client,
    account_id: str,
    allowed_protocols: list[str],
) -> list[str]:
    """Return funded protocols that are missing from requested scope.

    Safety guard: users should not be allowed to remove a protocol from
    session-key scope while funds are still allocated there, otherwise funds
    can become operationally stranded until re-grant.
    """
    allowed_set = set(_normalize_allowed_protocols(allowed_protocols))

    allocations = (
        db.table("allocations")
        .select("protocol_id, amount_usdc")
        .eq("account_id", account_id)
        .execute()
    )

    excluded: list[str] = []
    for row in allocations.data or []:
        pid = _canonical_protocol_id(str(row.get("protocol_id") or ""))
        if not pid:
            continue
        if pid not in _DEFAULT_ALLOWED_PROTOCOLS:
            continue

        try:
            amount = Decimal(str(row.get("amount_usdc") or "0"))
        except (InvalidOperation, TypeError, ValueError):
            continue

        if amount <= Decimal("0.000001"):
            continue
        if pid in allowed_set:
            continue
        if pid in excluded:
            continue
        excluded.append(pid)

    return sorted(excluded)


async def _find_excluded_funded_protocols_onchain(
    address: str,
    allowed_protocols: list[str],
) -> list[str]:
    """Return excluded protocols that still hold on-chain funds.

    Source of truth is on-chain balance, not DB allocations. This prevents
    stale DB rows from blocking valid updates and blocks risky updates when
    live balances still exist in excluded protocols.
    """
    allowed_set = set(_normalize_allowed_protocols(allowed_protocols))
    threshold = Decimal("0.000001")
    settings = get_settings()

    async def _read_protocol_balance(protocol_id: str) -> str | None:
        adapter = get_adapter(protocol_id)
        balance_wei = await adapter.get_user_balance(address, settings.USDC_ADDRESS)
        balance_usdc = Decimal(str(balance_wei)) / Decimal("1000000")
        return protocol_id if balance_usdc > threshold else None

    candidates = [
        pid for pid in _DEFAULT_ALLOWED_PROTOCOLS
        if pid not in allowed_set
    ]
    if not candidates:
        return []

    checks = await asyncio.gather(
        *(_read_protocol_balance(pid) for pid in candidates),
        return_exceptions=True,
    )

    excluded: list[str] = []
    for pid, result in zip(candidates, checks, strict=False):
        if isinstance(result, Exception):
            raise RuntimeError(
                f"On-chain balance validation failed for {pid}: {result}"
            ) from result
        if result:
            excluded.append(result)

    return sorted(excluded)


def _record_funding_transfer(
    db: Client,
    account_id: str,
    address: str,
    funding_tx_hash: str | None,
    funding_amount_usdc: str | None,
    funding_source: str | None,
    is_existing_account: bool,
) -> bool:
    """Persist onboarding funding transfer as a durable activity row.

    This ensures the dashboard can show the initial deposit transaction even
    when subsequent monitoring cycles are all "skipped" entries.
    """
    if not funding_amount_usdc:
        return False

    try:
        amount = Decimal(str(funding_amount_usdc))
    except (InvalidOperation, TypeError, ValueError):
        logger.warning("Ignoring invalid fundingAmountUsdc for %s: %r", address, funding_amount_usdc)
        return False

    if amount <= Decimal("0.000001"):
        return False

    normalized_amount = amount.quantize(Decimal("0.000001"))
    normalized_hash = funding_tx_hash.lower() if funding_tx_hash else None

    # Guardrail: for already-registered accounts, require tx hash so retries
    # cannot inflate principal tracking with duplicate implicit deposits.
    if is_existing_account and not normalized_hash:
        logger.warning(
            "Skipping funding activity for existing account %s because funding tx hash is missing",
            address,
        )
        return False

    # Idempotency: same funding tx for same account should not duplicate rows.
    if normalized_hash:
        existing = (
            db.table("rebalance_logs")
            .select("id")
            .eq("account_id", account_id)
            .eq("tx_hash", normalized_hash)
            .eq("from_protocol", "user_wallet")
            .limit(1)
            .execute()
        )
        if existing.data:
            return False

    row = {
        "account_id": account_id,
        "status": "executed",
        "skip_reason": "Initial funding transfer",
        "from_protocol": "user_wallet",
        "to_protocol": "idle",
        "amount_moved": str(normalized_amount),
        "tx_hash": normalized_hash,
        "executed_allocations": {"idle": str(normalized_amount)},
        "correlation_id": f"funding:{funding_source or 'wallet_transfer'}",
    }

    try:
        db.table("rebalance_logs").insert(row).execute()
    except Exception as exc:
        logger.warning("Failed to persist funding transfer activity for %s: %s", address, exc)
        return False

    # Keep principal accounting in sync for platform analytics.
    try:
        from app.services.fee_calculator import record_deposit
        record_deposit(db, account_id, normalized_amount)
    except Exception as exc:
        logger.warning("Failed to update deposit tracking for %s: %s", address, exc)
    return True


def _normalize_tx_hash(raw_tx_hash: str) -> str:
    tx_hash = str(raw_tx_hash or "").strip().lower()
    if not _TX_HASH_PATTERN.fullmatch(tx_hash):
        raise ValueError(
            "fundingTxHash must be a 0x-prefixed 32-byte transaction hash"
        )
    return tx_hash


def _parse_deposit_amount_usdc(raw_amount: str) -> Decimal:
    try:
        amount = Decimal(str(raw_amount))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("fundingAmountUsdc must be a valid decimal string") from exc

    if amount <= Decimal("0"):
        raise ValueError("fundingAmountUsdc must be greater than 0")
    if amount > _MAX_DEPOSIT_REQUEST_USDC:
        raise ValueError(
            f"fundingAmountUsdc exceeds maximum (${_MAX_DEPOSIT_REQUEST_USDC})"
        )
    quantized = amount.quantize(Decimal("0.000001"))
    if amount != quantized:
        raise ValueError("fundingAmountUsdc exceeds USDC precision (max 6 decimals)")
    return quantized


# ── Request body ───────────────────────────────────────────

class RegisterAccountRequest(BaseModel):
    # Accept BOTH camelCase (frontend) and snake_case (direct callers)
    address: str | None = Field(None, alias="smartAccountAddress", description="Smart-account address")
    owner_address: str | None = Field(None, alias="ownerAddress", description="EOA owner")

    # Also allow snake_case direct fields
    smart_account_address: str | None = None

    model_config = {"populate_by_name": True}

    def resolved_address(self) -> str:
        return self.address or self.smart_account_address or ""

    def resolved_owner(self) -> str:
        return self.owner_address or ""

    session_key_data: dict | None = Field(
        None,
        alias="sessionKeyData",
        description="Optional session-key blob to encrypt & store",
    )

    initial_allocation: dict | None = Field(
        None,
        alias="initialAllocation",
        description="Optional {protocolId: amountUsdc} from frontend initial deployment",
    )

    funding_tx_hash: str | None = Field(
        None,
        alias="fundingTxHash",
        description="Optional USDC funding transfer tx hash (EOA → smart account)",
    )

    funding_amount_usdc: str | None = Field(
        None,
        alias="fundingAmountUsdc",
        description="Optional USDC amount transferred in funding tx",
    )

    funding_source: str | None = Field(
        "wallet_transfer",
        alias="fundingSource",
        description="Optional source tag for funding tx tracking",
    )


# ── POST /accounts  AND  /accounts/register ───────────────

async def _do_register(
    req: RegisterAccountRequest,
    db: Client,
    auth_claims: dict | None = None,
) -> AccountResponse:
    """Shared implementation for both registration endpoints."""
    address = validate_eth_address(req.resolved_address())
    owner_address = validate_eth_address(req.resolved_owner())

    if not auth_claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication identity",
        )
    assert_owner_matches_claims(auth_claims, owner_address)

    # Guard: prevent overwriting an existing account's owner
    existing = (
        db.table("accounts")
        .select("owner_address")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if existing.data:
        existing_owner = existing.data[0].get("owner_address", "").lower()
        if existing_owner and existing_owner != owner_address.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already registered with a different owner",
            )

    # Store Privy DID for future authorization checks
    privy_did = auth_claims.get("sub")

    # Upsert: if account already exists, just return it
    upsert_data = {
        "address": address,
        "owner_address": owner_address,
        "is_active": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if privy_did:
        upsert_data["privy_did"] = privy_did

    result = (
        db.table("accounts")
        .upsert(upsert_data, on_conflict="address")
        .execute()
    )
    account = result.data[0]
    logger.info("Account registered/updated: %s", address)

    _record_funding_transfer(
        db,
        account["id"],
        address,
        req.funding_tx_hash,
        req.funding_amount_usdc,
        req.funding_source,
        is_existing_account=bool(existing.data),
    )

    # Record initial allocation FIRST (idempotent, must not be blocked by
    # a session-key storage failure).
    if req.initial_allocation:
        from decimal import Decimal
        for protocol_id, amount_str in req.initial_allocation.items():
            try:
                amount = Decimal(str(amount_str))
                if amount > Decimal("0.01"):
                    db.table("allocations").upsert(
                        {
                            "account_id": account["id"],
                            "protocol_id": protocol_id,
                            "amount_usdc": str(amount.quantize(Decimal("0.000001"))),
                        },
                        on_conflict="account_id,protocol_id",
                    ).execute()
                    logger.info("Initial allocation: %s/%s = $%s", address, protocol_id, amount)
            except Exception as exc:
                logger.warning("Failed to record allocation %s/%s: %s", address, protocol_id, exc)

    # Store session key (may fail on KMS/encryption — non-fatal for account
    # creation since the user can re-grant from the dashboard).
    # force=True because re-running onboarding means the user explicitly wants
    # the new session key to replace any old one (the old one's enable signature
    # may be invalid after a signing fix deployment).
    session_key_stored = False
    if req.session_key_data:
        try:
            session_key_payload = dict(req.session_key_data)

            resolved_protocols = _resolve_allowed_protocols(
                db,
                account["id"],
                session_key_payload.get("allowedProtocols")
                or session_key_payload.get("allowed_protocols"),
            )
            resolved_caps = _resolve_allocation_caps(
                db,
                account["id"],
                session_key_payload.get("allocationCaps")
                or session_key_payload.get("allocation_caps"),
            )

            session_key_payload["allowedProtocols"] = resolved_protocols
            if resolved_caps is not None:
                session_key_payload["allocationCaps"] = resolved_caps

            store_session_key(db, account["id"], session_key_payload, force=True)
            session_key_stored = True
        except Exception as exc:
            logger.error(
                "Session key storage failed for %s (user can re-grant): %s",
                address, exc,
            )

    # Fire-and-forget: trigger immediate rebalance so idle USDC gets deployed
    if session_key_stored:
        asyncio.create_task(_trigger_initial_rebalance(account["id"], address))

    return AccountResponse(
        id=account["id"],
        address=account["address"],
        owner_address=account["owner_address"],
        is_active=account["is_active"],
        created_at=account["created_at"],
        diversification_preference=account.get("diversification_preference", "balanced"),
    )


# Per-account lock to prevent concurrent rebalance triggers.
# Maps account_id → asyncio.Lock. If a rebalance is already in flight
# for an account, subsequent triggers wait (or skip) rather than
# submitting duplicate UserOps to the bundler.
_rebalance_locks: dict[str, asyncio.Lock] = {}


async def _trigger_initial_rebalance(account_id: str, address: str) -> None:
    """Best-effort immediate rebalance after registration.

    Runs as a fire-and-forget task so the registration response is not delayed.
    Retries up to 3 times with exponential backoff (5s, 15s, 45s).
    If all retries fail (e.g. funds already deployed from frontend), the cron
    scheduler will pick it up on its next cycle.
    Uses a per-account lock to prevent duplicate concurrent submissions.
    """
    await asyncio.sleep(5)  # Wait for session key to fully propagate

    # Acquire per-account lock — if another rebalance is already running, skip
    lock = _rebalance_locks.setdefault(account_id, asyncio.Lock())
    if lock.locked():
        logger.info("Initial rebalance for %s skipped — another attempt in flight", address)
        return

    async with lock:
        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                from app.services.optimizer.rebalancer import Rebalancer
                rebalancer = Rebalancer()
                result = await rebalancer.check_and_rebalance(account_id, address)
                res_status = str(result.get("status", "unknown")).lower()
                skip_reason = str(
                    result.get("skip_reason")
                    or result.get("skipReason")
                    or result.get("reason")
                    or ""
                )
                logger.info(
                    "Initial rebalance for %s attempt %d/%d: status=%s skip_reason=%s",
                    address,
                    attempt,
                    max_retries,
                    res_status,
                    skip_reason[:180] if skip_reason else "-",
                )

                if res_status in {"executed", "pending", "executing"}:
                    return

                if res_status == "skipped":
                    skip_reason_lc = skip_reason.lower()
                    transient_skip = (
                        "another rebalance attempt in flight" in skip_reason_lc
                        or "no active session key" in skip_reason_lc
                    )
                    if transient_skip and attempt < max_retries:
                        delay = 5 * (3 ** (attempt - 1))
                        logger.info(
                            "Initial rebalance transient skip for %s (attempt %d/%d): %s — retrying in %ds",
                            address,
                            attempt,
                            max_retries,
                            skip_reason[:160],
                            delay,
                        )
                        await asyncio.sleep(delay)
                        continue

                    # Non-transient skip (e.g. no deposited balance / no action needed)
                    return

                # Unknown states are treated as terminal here; scheduler will retry.
                return
            except Exception as exc:
                exc_msg = str(exc)
                # Non-retryable errors: duplicate permissionHash, user must re-grant
                if "duplicate permissionhash" in exc_msg.lower():
                    logger.warning(
                        "Initial rebalance for %s: duplicate permissionHash — "
                        "funds may already be deployed from frontend, stopping retries.",
                        address,
                    )
                    return
                if attempt < max_retries:
                    delay = 5 * (3 ** (attempt - 1))  # 5s, 15s, 45s
                    logger.warning(
                        "Initial rebalance attempt %d/%d failed for %s: %s — retrying in %ds",
                        attempt, max_retries, address, exc_msg[:200], delay,
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.warning(
                        "Initial rebalance failed for %s after %d attempts (cron will retry): %s",
                        address, max_retries, exc_msg[:200],
                    )


async def _recover_failed_full_withdrawal_deactivation(
    db: Client,
    account_row: dict,
) -> dict:
    """Re-activate accounts that were deactivated by a failed full-withdrawal tx.

    Historical bug pattern: backend accepted a tx hash as success and immediately
    deactivated the account, even when EntryPoint reported an inner user-op revert.
    This recovery runs only for currently inactive accounts and only flips account
    state when on-chain receipt verification proves the recorded withdrawal failed.
    """
    if account_row.get("is_active", True):
        return account_row

    account_id = str(account_row.get("id") or "").strip()
    address = str(account_row.get("address") or "").strip()
    if not account_id or not address:
        return account_row

    try:
        latest_withdrawal = (
            db.table("rebalance_logs")
            .select("id, tx_hash, created_at, status")
            .eq("account_id", account_id)
            .eq("from_protocol", "withdrawal")
            .eq("to_protocol", "user_eoa")
            .eq("status", "executed")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "Failed to load latest withdrawal log for %s (%s): %s",
            address,
            account_id,
            exc,
        )
        return account_row

    if not latest_withdrawal.data:
        return account_row

    withdrawal_log = latest_withdrawal.data[0]
    tx_hash = str(withdrawal_log.get("tx_hash") or "").strip()
    if not tx_hash:
        return account_row

    verification = await verify_userop_execution(
        tx_hash,
        address,
        timeout_seconds=25,
    )

    if verification.succeeded:
        return account_row

    if not verification.terminal:
        logger.warning(
            "Skipping inactive-account recovery for %s: tx verification inconclusive (%s)",
            address,
            verification.reason,
        )
        return account_row

    is_proven_withdraw_failure = (
        verification.reason == "entrypoint_transaction_reverted"
        or verification.reason.startswith("useroperation_failed_inside_entrypoint")
    )
    if not is_proven_withdraw_failure:
        return account_row

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        db.table("accounts").update(
            {
                "is_active": True,
                "updated_at": now_iso,
            }
        ).eq("id", account_id).execute()
    except Exception as exc:
        logger.error(
            "Failed to recover inactive account state for %s (%s): %s",
            address,
            account_id,
            exc,
        )
        return account_row

    try:
        db.table("rebalance_logs").update(
            {
                "status": "failed",
                "skip_reason": f"WITHDRAWAL_USEROP_FAILED:{verification.reason}"[:500],
            }
        ).eq("id", withdrawal_log.get("id")).execute()
    except Exception as exc:
        logger.warning(
            "Failed to update withdrawal log status during recovery for %s: %s",
            address,
            exc,
        )

    logger.error(
        "Recovered false full-withdrawal deactivation for %s (tx=%s reason=%s)",
        address,
        tx_hash,
        verification.reason,
    )
    patched = dict(account_row)
    patched["is_active"] = True
    return patched


async def _read_total_position_balance_usdc(address: str) -> tuple[Decimal, bool]:
    """Read total on-chain position value (full balances, not withdrawable-only)."""
    settings = get_settings()
    w3 = get_shared_async_web3()

    total_raw = 0
    balance_check_complete = True

    for pid, adapter in ACTIVE_ADAPTERS.items():
        try:
            balance = await asyncio.wait_for(
                adapter.get_balance(address),
                timeout=_ACCOUNT_BALANCE_READ_TIMEOUT_SECONDS,
            )
            total_raw += int(balance)
        except Exception as exc:
            balance_check_complete = False
            logger.warning(
                "Failed to read %s balance for inactive-account recovery %s: %s",
                pid,
                address,
                exc,
            )

    try:
        usdc = w3.eth.contract(
            address=w3.to_checksum_address(settings.USDC_ADDRESS),
            abi=_ERC20_BALANCE_OF_ABI,
        )
        idle_raw = await asyncio.wait_for(
            usdc.functions.balanceOf(w3.to_checksum_address(address)).call(),
            timeout=_ACCOUNT_BALANCE_READ_TIMEOUT_SECONDS,
        )
        total_raw += int(idle_raw)
    except Exception as exc:
        balance_check_complete = False
        logger.warning(
            "Failed to read idle USDC for inactive-account recovery %s: %s",
            address,
            exc,
        )

    return Decimal(str(total_raw)) / Decimal("1e6"), balance_check_complete


async def _recover_inactive_funded_account(
    db: Client,
    account_row: dict,
) -> dict:
    """Auto-reactivate legacy rows when on-chain funds still exist."""
    if account_row.get("is_active", True):
        return account_row

    account_id = str(account_row.get("id") or "").strip()
    address = str(account_row.get("address") or "").strip()
    if not account_id or not address:
        return account_row

    total_usdc, balance_check_complete = await _read_total_position_balance_usdc(address)
    if not balance_check_complete:
        return account_row
    if total_usdc <= _ACCOUNT_REACTIVATION_DUST_USDC:
        return account_row

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        db.table("accounts").update(
            {
                "is_active": True,
                "updated_at": now_iso,
            }
        ).eq("id", account_id).execute()
    except Exception as exc:
        logger.error(
            "Failed to auto-reactivate funded account %s (%s): %s",
            address,
            account_id,
            exc,
        )
        return account_row

    logger.warning(
        "Auto-reactivated funded account %s with residual on-chain balance $%.6f",
        address,
        float(total_usdc),
    )
    patched = dict(account_row)
    patched["is_active"] = True
    return patched


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Register a new smart account (and optionally store its session key)."""
    return await _do_register(req, db, _auth)


@router.post("/register", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def register_account_alias(
    request: Request,
    req: RegisterAccountRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Alias of POST /accounts for frontend compatibility."""
    return await _do_register(req, db, _auth)


# ── GET /accounts/{address} ───────────────────────────────

@router.get("/{address}", response_model=AccountDetailResponse)
@limiter.limit("60/minute")
async def get_account(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Get account info including current session-key status."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, address, owner_address, is_active, created_at, diversification_preference, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        # Return a minimal stub so the frontend doesn't 404-loop
        # before registration completes
        return AccountDetailResponse(
            id="",
            address=address,
            owner_address="",
            is_active=False,
            created_at=datetime.now(timezone.utc).isoformat(),
            diversification_preference="balanced",
            session_key=None,
            allocation_caps=None,
        )

    row = acct.data[0]
    verify_account_ownership(_auth, row, db=db)
    row = await _recover_failed_full_withdrawal_deactivation(db, row)
    row = await _recover_inactive_funded_account(db, row)

    # Fetch latest active session key metadata with robust expiry handling.
    sk_meta = get_active_session_key_metadata(db, row["id"])
    sk_resp = None
    if sk_meta:
        sk_resp = SessionKeyStatusResponse(
            key_address=str(sk_meta.get("key_address") or ""),
            is_active=True,
            expires_at=str(sk_meta.get("expires_at") or ""),
            allowed_protocols=sk_meta.get("allowed_protocols") or [],
            max_amount_per_tx=str(sk_meta.get("max_amount_per_tx") or "0"),
            created_at=str(sk_meta.get("created_at") or datetime.now(timezone.utc).isoformat()),
        )

    return AccountDetailResponse(
        id=row["id"],
        address=row["address"],
        owner_address=row["owner_address"],
        is_active=row["is_active"],
        created_at=row["created_at"],
        diversification_preference=row.get("diversification_preference", "balanced"),
        session_key=sk_resp,
        allocation_caps=sk_meta.get("allocation_caps") if sk_meta else None,
    )


# ── DELETE / POST /accounts/{address}/session-key ────────

async def _do_revoke(address: str, db: Client, auth_claims: dict) -> dict:
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_account_ownership(auth_claims, acct.data[0], db=db)
    count = revoke_session_key(db, acct.data[0]["id"])
    return {"revoked": count, "success": True}


@router.delete("/{address}/session-key")
@limiter.limit("10/minute")
async def revoke_account_session_key(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Revoke (deactivate) the active session key for an account."""
    return await _do_revoke(address, db, _auth)


@router.post("/{address}/session-key/revoke")
@limiter.limit("10/minute")
async def revoke_account_session_key_post(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """POST alias for session-key revocation (frontend compat)."""
    return await _do_revoke(address, db, _auth)


# ── POST /accounts/{address}/session-key ── store/renew ──


class StoreSessionKeyRequest(BaseModel):
    """Request body for storing a session key (used for retry/renewal)."""
    serialized_permission: str = Field(..., alias="serializedPermission")
    session_private_key: str = Field("", alias="sessionPrivateKey")
    session_key_address: str = Field(..., alias="sessionKeyAddress")
    expires_at: int | str = Field(..., alias="expiresAt")
    allowed_protocols: list[str] | None = Field(None, alias="allowedProtocols")
    allocation_caps: dict[str, int] | None = Field(None, alias="allocationCaps")
    force: bool = Field(False, description="Bypass renewal guard and always store the new session key")
    owner_address: str | None = Field(
        None,
        alias="ownerAddress",
        description="EOA owner address — required to auto-register missing accounts",
    )
    initial_allocation: dict | None = Field(
        None,
        alias="initialAllocation",
        description="Optional: {protocolId: amountUsdc} to seed allocations table",
    )
    model_config = {"populate_by_name": True}


@router.post("/{address}/session-key")
@limiter.limit("10/minute")
async def store_account_session_key(
    request: Request,
    address: str,
    req: StoreSessionKeyRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Store or renew a session key for an existing account.

    Also optionally records the initial allocation so the rebalancer
    can see existing on-chain positions from frontend deployment.
    """
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, is_active, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )

    if acct.data:
        account_row = acct.data[0]
        account_id = account_row["id"]
        verify_account_ownership(_auth, account_row, db=db)
        # Auto-reactivate if deactivated (e.g. after emergency withdrawal)
        if not acct.data[0].get("is_active", True):
            db.table("accounts").update({
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", account_id).execute()
            logger.info("Account %s reactivated via session-key store", address)
    elif req.owner_address:
        # Account doesn't exist — auto-register if owner_address is provided.
        # This handles the case where a full withdrawal deleted the row
        # and the user re-grants from the dashboard.
        owner_addr = validate_eth_address(req.owner_address)
        assert_owner_matches_claims(_auth, owner_addr)
        result = (
            db.table("accounts")
            .upsert(
                {
                    "address": address,
                    "owner_address": owner_addr,
                    "privy_did": _auth.get("sub"),
                    "is_active": True,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="address",
            )
            .execute()
        )
        account_id = result.data[0]["id"]
        logger.info("Account %s auto-registered via session-key store (owner=%s)", address, owner_addr)
    else:
        raise HTTPException(status_code=404, detail="Account not found")

    # Store session key
    resolved_protocols = _resolve_allowed_protocols(db, account_id, req.allowed_protocols)
    resolved_caps = _resolve_allocation_caps(
        db,
        account_id,
        req.allocation_caps,
    )

    session_key_data = {
        "serializedPermission": req.serialized_permission,
        "sessionPrivateKey": req.session_private_key,
        "sessionKeyAddress": req.session_key_address,
        "expiresAt": req.expires_at,
        "allowedProtocols": resolved_protocols,
        "allocationCaps": resolved_caps,
    }
    try:
        key_id = store_session_key(db, account_id, session_key_data, force=req.force)
    except ValueError as exc:
        # Renewal guard: active key still has >24h remaining — this is OK
        if "Renewal not needed" in str(exc) or "remaining" in str(exc):
            logger.info("Session key store skipped for %s: %s", address, exc)
            return {"success": True, "keyId": "", "message": str(exc)}
        raise HTTPException(status_code=400, detail=str(exc))
    logger.info("Session key stored via /session-key endpoint for %s (key_id=%s)", address, key_id)

    # Optionally record initial allocation
    if req.initial_allocation:
        for protocol_id, amount_str in req.initial_allocation.items():
            try:
                from decimal import Decimal
                amount = Decimal(str(amount_str))
                if amount > Decimal("0.01"):
                    db.table("allocations").upsert(
                        {
                            "account_id": account_id,
                            "protocol_id": protocol_id,
                            "amount_usdc": str(amount.quantize(Decimal("0.000001"))),
                        },
                        on_conflict="account_id,protocol_id",
                    ).execute()
                    logger.info(
                        "Initial allocation recorded: %s/%s = $%s",
                        address, protocol_id, amount,
                    )
            except Exception as exc:
                logger.warning("Failed to record allocation %s/%s: %s", address, protocol_id, exc)

    # Trigger immediate rebalance so idle USDC gets deployed right away.
    # This endpoint may be called after a failed inline store on registration,
    # so we run it here as a best-effort deployment kick-off.
    asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    return {"success": True, "keyId": key_id}


# ── PUT /accounts/{address}/diversification-preference ────


class DiversificationPreferenceRequest(BaseModel):
    diversification_preference: DiversificationPref = Field(
        ..., alias="diversificationPreference",
    )
    model_config = {"populate_by_name": True}


class AllowedProtocolsUpdateRequest(BaseModel):
    allowed_protocols: list[str] = Field(..., alias="allowedProtocols")
    model_config = {"populate_by_name": True}


class AllocationCapsUpdateRequest(BaseModel):
    allocation_caps: dict[str, int] = Field(..., alias="allocationCaps")
    model_config = {"populate_by_name": True}


class ProtocolSelectionDepositRequest(BaseModel):
    allowed_protocols: list[str] = Field(..., alias="allowedProtocols")
    funding_tx_hash: str = Field(..., alias="fundingTxHash")
    funding_amount_usdc: str = Field(..., alias="fundingAmountUsdc")
    funding_source: str | None = Field(
        "dashboard_wallet_transfer",
        alias="fundingSource",
    )
    allocation_caps: dict[str, int] | None = Field(None, alias="allocationCaps")
    trigger_rebalance: bool = Field(True, alias="triggerRebalance")
    model_config = {"populate_by_name": True}


@router.put("/{address}/diversification-preference")
@limiter.limit("20/minute")
async def update_diversification_preference(
    request: Request,
    address: str,
    req: DiversificationPreferenceRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Update the diversification preference for an account."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_account_ownership(_auth, acct.data[0], db=db)

    db.table("accounts").update(
        {
            "diversification_preference": req.diversification_preference.value,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", acct.data[0]["id"]).execute()

    return {
        "diversificationPreference": req.diversification_preference.value,
    }


@router.put("/{address}/allowed-protocols")
@limiter.limit("20/minute")
async def update_allowed_protocols(
    request: Request,
    address: str,
    req: AllowedProtocolsUpdateRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Update active session-key protocol scope for an account.

    This lets users adjust market exposure after onboarding without changing
    account ownership or other permissions.
    """
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_account_ownership(_auth, acct.data[0], db=db)

    account_id = acct.data[0]["id"]
    normalized = _normalize_allowed_protocols(req.allowed_protocols)
    if not normalized:
        raise HTTPException(
            status_code=400,
            detail="At least one valid protocol must be selected",
        )

    active_keys = (
        db.table("session_keys")
        .select("id, allocation_caps")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )
    active_count = len(active_keys.data or [])
    if active_count == 0:
        raise HTTPException(
            status_code=409,
            detail="No active session key found. Re-grant session key first",
        )

    try:
        excluded_funded_db = _find_excluded_funded_protocols(db, account_id, normalized)
        excluded_funded_chain = await _find_excluded_funded_protocols_onchain(address, normalized)
    except Exception as exc:
        logger.exception(
            "Failed to validate funded protocol exclusions for %s (account_id=%s): %s",
            address,
            account_id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to validate current allocations. Please retry.",
        ) from exc

    # On-chain balances are authoritative. Log DB drift but do not block on it.
    if excluded_funded_db and not excluded_funded_chain:
        logger.info(
            "Ignoring stale DB-funded exclusions for %s: %s",
            address,
            ", ".join(excluded_funded_db),
        )

    if excluded_funded_chain:
        raise HTTPException(
            status_code=409,
            detail=(
                "Some selected markets still hold funds: "
                f"{', '.join(excluded_funded_chain)}. "
                "Keep them enabled or withdraw first."
            ),
        )

    scoped_caps: dict[str, int] | None = None
    try:
        if active_keys.data:
            existing_caps = _normalize_allocation_caps(
                active_keys.data[0].get("allocation_caps"),
                strict=False,
            )
            scoped_caps = _scope_allocation_caps(existing_caps, normalized)
    except Exception as exc:
        logger.warning(
            "Failed to scope existing allocation caps for %s: %s",
            address,
            exc,
        )

    if not _has_deployable_cap(scoped_caps, normalized):
        raise HTTPException(
            status_code=400,
            detail="At least one selected market must have a cap above 0%",
        )

    effective_total_pct = _effective_cap_total_pct(scoped_caps, normalized)
    idle_remainder_possible = effective_total_pct < 100

    try:
        db.table("session_keys").update(
            {
                "allowed_protocols": normalized,
                "allocation_caps": scoped_caps,
            }
        ).eq("account_id", account_id).eq("is_active", True).execute()
    except Exception as exc:
        logger.exception(
            "Failed to update allowed protocols for %s (account_id=%s): %s",
            address,
            account_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update allowed protocols",
        ) from exc

    # Best-effort: apply updated scope without waiting for next scheduler tick.
    asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    return {
        "allowedProtocols": normalized,
        "allocationCaps": scoped_caps,
        "effectiveCapTotalPct": effective_total_pct,
        "idleRemainderPossible": idle_remainder_possible,
        "updatedRows": active_count,
    }


@router.put("/{address}/allocation-caps")
@limiter.limit("20/minute")
async def update_allocation_caps(
    request: Request,
    address: str,
    req: AllocationCapsUpdateRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Update active session-key per-protocol max allocation caps.

    Caps are stored off-chain in ``session_keys.allocation_caps`` and applied by
    the rebalancer as user-level constraints (most restrictive wins against
    system TVL caps).
    """
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_account_ownership(_auth, acct.data[0], db=db)

    account_id = acct.data[0]["id"]

    try:
        normalized_caps = _normalize_allocation_caps(req.allocation_caps, strict=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    active_keys = (
        db.table("session_keys")
        .select("id, allowed_protocols")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )
    active_count = len(active_keys.data or [])
    if active_count == 0:
        raise HTTPException(
            status_code=409,
            detail="No active session key found. Re-grant session key first",
        )

    allowed_scope: list[str] = []
    for row in active_keys.data or []:
        for pid in _normalize_allowed_protocols(row.get("allowed_protocols")):
            if pid not in allowed_scope:
                allowed_scope.append(pid)
    if not allowed_scope:
        allowed_scope = list(_DEFAULT_ALLOWED_PROTOCOLS)

    if normalized_caps is not None:
        out_of_scope = [
            pid for pid in normalized_caps.keys()
            if pid not in set(allowed_scope)
        ]
        if out_of_scope:
            # Backward-compat: older/mobile clients can send stale caps for
            # protocols that are no longer in selected scope. Ignore them and
            # persist only scoped caps instead of hard-failing the save action.
            logger.info(
                "Ignoring out-of-scope allocation caps for %s: %s (allowed_scope=%s)",
                address,
                ", ".join(sorted(out_of_scope)),
                ", ".join(sorted(allowed_scope)),
            )

    scoped_caps = _scope_allocation_caps(normalized_caps, allowed_scope)
    if not _has_deployable_cap(scoped_caps, allowed_scope):
        raise HTTPException(
            status_code=400,
            detail="At least one selected market must have a cap above 0%",
        )

    effective_total_pct = _effective_cap_total_pct(scoped_caps, allowed_scope)
    idle_remainder_possible = effective_total_pct < 100

    try:
        db.table("session_keys").update(
            {
                "allocation_caps": scoped_caps,
            }
        ).eq("account_id", account_id).eq("is_active", True).execute()
    except Exception as exc:
        logger.exception(
            "Failed to update allocation caps for %s (account_id=%s): %s",
            address,
            account_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update allocation caps",
        ) from exc

    # Best-effort: apply updated caps without waiting for next scheduler tick.
    asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    return {
        "allocationCaps": scoped_caps,
        "effectiveCapTotalPct": effective_total_pct,
        "idleRemainderPossible": idle_remainder_possible,
        "allowedProtocols": allowed_scope,
        "updatedRows": active_count,
    }


@router.post("/{address}/deposit")
@limiter.limit("15/minute")
async def deposit_with_protocol_selection(
    request: Request,
    address: str,
    req: ProtocolSelectionDepositRequest,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Update protocol scope, record a deposit funding tx, and queue deployment."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did, is_active")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        raise HTTPException(status_code=404, detail="Account not found")
    verify_account_ownership(_auth, acct.data[0], db=db)
    account_row = acct.data[0]
    account_id = account_row["id"]
    if not account_row.get("is_active", True):
        db.table("accounts").update(
            {
                "is_active": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", account_id).execute()

    normalized_protocols = _normalize_allowed_protocols(req.allowed_protocols)
    if not normalized_protocols:
        raise HTTPException(
            status_code=400,
            detail="At least one valid protocol must be selected",
        )

    try:
        normalized_tx_hash = _normalize_tx_hash(req.funding_tx_hash)
        normalized_amount = _parse_deposit_amount_usdc(req.funding_amount_usdc)
        requested_caps = _normalize_allocation_caps(req.allocation_caps, strict=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    active_keys = (
        db.table("session_keys")
        .select("id, allocation_caps")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )
    active_count = len(active_keys.data or [])
    if active_count == 0:
        raise HTTPException(
            status_code=409,
            detail="No active session key found. Re-grant session key first",
        )

    try:
        excluded_funded_db = _find_excluded_funded_protocols(
            db,
            account_id,
            normalized_protocols,
        )
        excluded_funded_chain = await _find_excluded_funded_protocols_onchain(
            address,
            normalized_protocols,
        )
    except Exception as exc:
        logger.exception(
            "Failed funded-protocol validation for deposit endpoint %s (%s): %s",
            address,
            account_id,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to validate current allocations. Please retry.",
        ) from exc

    # On-chain balances are authoritative. Log DB drift but do not block on it.
    if excluded_funded_db and not excluded_funded_chain:
        logger.info(
            "Ignoring stale DB-funded exclusions for %s: %s",
            address,
            ", ".join(excluded_funded_db),
        )

    if excluded_funded_chain:
        raise HTTPException(
            status_code=409,
            detail=(
                "Some selected markets still hold funds: "
                f"{', '.join(excluded_funded_chain)}. "
                "Keep them enabled or withdraw first."
            ),
        )

    scoped_caps = _scope_allocation_caps(requested_caps, normalized_protocols)
    if requested_caps is None:
        try:
            existing_caps = _normalize_allocation_caps(
                active_keys.data[0].get("allocation_caps"),
                strict=False,
            )
            scoped_caps = _scope_allocation_caps(existing_caps, normalized_protocols)
        except Exception as exc:
            logger.warning(
                "Failed to scope existing allocation caps for %s: %s",
                address,
                exc,
            )

    if not _has_deployable_cap(scoped_caps, normalized_protocols):
        raise HTTPException(
            status_code=400,
            detail="At least one selected market must have a cap above 0%",
        )

    effective_total_pct = _effective_cap_total_pct(scoped_caps, normalized_protocols)
    idle_remainder_possible = effective_total_pct < 100

    try:
        db.table("session_keys").update(
            {
                "allowed_protocols": normalized_protocols,
                "allocation_caps": scoped_caps,
            }
        ).eq("account_id", account_id).eq("is_active", True).execute()
    except Exception as exc:
        logger.exception(
            "Failed to update protocol scope in deposit endpoint %s (%s): %s",
            address,
            account_id,
            exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to update selected protocols",
        ) from exc

    deposit_recorded = _record_funding_transfer(
        db=db,
        account_id=account_id,
        address=address,
        funding_tx_hash=normalized_tx_hash,
        funding_amount_usdc=str(normalized_amount),
        funding_source=req.funding_source,
        is_existing_account=True,
    )

    if req.trigger_rebalance:
        asyncio.create_task(_trigger_initial_rebalance(account_id, address))

    return {
        "allowedProtocols": normalized_protocols,
        "allocationCaps": scoped_caps,
        "effectiveCapTotalPct": effective_total_pct,
        "idleRemainderPossible": idle_remainder_possible,
        "updatedRows": active_count,
        "fundingTxHash": normalized_tx_hash,
        "fundingAmountUsdc": str(normalized_amount),
        "fundingRecorded": deposit_recorded,
        "rebalanceQueued": req.trigger_rebalance,
    }

