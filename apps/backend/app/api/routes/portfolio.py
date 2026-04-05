"""Portfolio state and rebalance history endpoints."""

import asyncio
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from supabase import Client

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.security import require_privy_auth, verify_account_ownership
from app.core.validators import validate_eth_address
from app.models.allocation import AllocationResponse, PortfolioResponse
from app.services.protocols import get_adapter, ACTIVE_ADAPTERS
from app.services.protocols.base import get_shared_async_web3
from app.models.rebalance_log import RebalanceHistoryResponse, RebalanceLogResponse

logger = logging.getLogger("snowmind")

router = APIRouter()  # All portfolio reads are public

# Protocol display names
_NAMES = {
    "benqi": "Benqi",
    "aave_v3": "Aave V3",
    "aave": "Aave V3",  # Legacy alias kept for backward-compatible display
    "euler_v2": "Euler V2",
    "spark": "Spark Savings",
    "silo_savusd_usdc": "Silo savUSD/USDC",
    "silo_susdp_usdc": "Silo sUSDp/USDC",
}

# ERC-20 balanceOf ABI
_ERC20_ABI = [
    {
        "name": "balanceOf",
        "type": "function",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
    }
]

_PROTOCOL_BALANCE_DUST_USDC = Decimal("0.01")
_BALANCE_RECONCILE_EPSILON_USDC = Decimal("0.000001")
_USDC_TRANSFER_TOPIC_PREFIX = "ddf252ad"
_PRINCIPAL_RECONCILE_DRIFT_USDC = Decimal("0.50")
_PRINCIPAL_RECONCILE_UNDERCOUNT_DRIFT_USDC = Decimal("0.01")
_PRINCIPAL_RECONCILE_UNDERCOUNT_LOOKBACK_MINUTES = 180
_PRINCIPAL_RECONCILE_IMPROVEMENT_EPSILON_USDC = Decimal("0.01")
_PRINCIPAL_RECONCILE_MAX_TX = 5000
_PRINCIPAL_RECONCILE_PAGE_SIZE = 500
_PRINCIPAL_RECONCILE_COOLDOWN_SECONDS = 300
_SNOWTRACE_PAGE_SIZE = 1000
_SNOWTRACE_MAX_PAGES = 20
_SNOWTRACE_TIMEOUT_SECONDS = 20.0

# Short-lived in-memory cache to dampen duplicate dashboard polling.
_portfolio_cache: dict[str, tuple[float, dict]] = {}
_principal_reconcile_cooldowns: dict[str, float] = {}


def _canonical_protocol_id(protocol_id: str) -> str:
    if protocol_id == "aave":
        return "aave_v3"
    return protocol_id


def _should_refresh_amount(existing_amount: Decimal, onchain_amount: Decimal) -> bool:
    """Return True when on-chain amount changed beyond micro-USDC noise."""
    return abs(onchain_amount - existing_amount) > _BALANCE_RECONCILE_EPSILON_USDC


def _portfolio_cache_get(cache_key: str) -> PortfolioResponse | None:
    cached = _portfolio_cache.get(cache_key)
    if not cached:
        return None
    expires_at, payload = cached
    if expires_at <= time.monotonic():
        _portfolio_cache.pop(cache_key, None)
        return None
    return PortfolioResponse.model_validate(payload)


def _portfolio_cache_put(cache_key: str, response: PortfolioResponse, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    _portfolio_cache[cache_key] = (
        time.monotonic() + ttl_seconds,
        response.model_dump(),
    )


def _topic_to_address(topic_hex: str) -> str:
    normalized = topic_hex.lower().replace("0x", "")
    return f"0x{normalized[-40:]}"


def _usdc_to_decimal(raw: str | int) -> Decimal:
    return Decimal(str(raw)) / Decimal("1000000")


async def _collect_principal_from_rebalance_receipts(
    db: Client,
    account_id: str,
    smart_address: str,
    owner_address: str,
    usdc_address: str,
) -> tuple[Decimal, Decimal] | None:
    """Infer principal flow from executed tx receipts stored in rebalance logs."""
    try:
        tx_count_resp = (
            db.table("rebalance_logs")
            .select("id", count="exact")
            .eq("account_id", account_id)
            .eq("status", "executed")
            .not_.is_("tx_hash", "null")
            .execute()
        )
        tx_count = tx_count_resp.count or 0
        if tx_count == 0:
            return None
        if tx_count > _PRINCIPAL_RECONCILE_MAX_TX:
            logger.warning(
                "Skipping receipt-based reconciliation for %s: tx_count=%d exceeds limit=%d",
                smart_address,
                tx_count,
                _PRINCIPAL_RECONCILE_MAX_TX,
            )
            return None
    except Exception as exc:
        logger.warning(
            "Failed to load tx history for receipt reconciliation (%s): %s",
            smart_address,
            exc,
        )
        return None

    tx_hashes: list[str] = []
    fetched = 0
    while fetched < tx_count:
        page_end = min(fetched + _PRINCIPAL_RECONCILE_PAGE_SIZE - 1, tx_count - 1)
        try:
            rows = (
                db.table("rebalance_logs")
                .select("tx_hash")
                .eq("account_id", account_id)
                .eq("status", "executed")
                .not_.is_("tx_hash", "null")
                .order("created_at", desc=False)
                .range(fetched, page_end)
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "Failed to page tx history for receipt reconciliation (%s): %s",
                smart_address,
                exc,
            )
            return None

        page_hashes = [
            str(row.get("tx_hash"))
            for row in (rows.data or [])
            if row.get("tx_hash")
        ]
        if not page_hashes:
            break

        tx_hashes.extend(page_hashes)
        fetched += len(page_hashes)

    if not tx_hashes:
        return None

    w3 = get_shared_async_web3()
    smart_l = smart_address.lower()
    owner_l = owner_address.lower()
    usdc_l = usdc_address.lower()

    cumulative_deposited = Decimal("0")
    cumulative_withdrawn = Decimal("0")

    for tx_hash in tx_hashes:
        try:
            receipt = await w3.eth.get_transaction_receipt(tx_hash)
        except Exception:
            continue

        for entry in receipt.get("logs", []):
            token_address = str(entry.get("address", "")).lower()
            if token_address != usdc_l:
                continue

            topics = [topic.hex().lower() for topic in entry.get("topics", [])]
            if len(topics) < 3 or not topics[0].startswith(_USDC_TRANSFER_TOPIC_PREFIX):
                continue

            source = _topic_to_address(topics[1])
            destination = _topic_to_address(topics[2])
            amount_raw = int(entry.get("data", b"0x00").hex(), 16)
            amount_usdc = _usdc_to_decimal(amount_raw)

            if source == owner_l and destination == smart_l:
                cumulative_deposited += amount_usdc
            elif source == smart_l and destination == owner_l:
                cumulative_withdrawn += amount_usdc

    if cumulative_deposited <= Decimal("0") and cumulative_withdrawn <= Decimal("0"):
        return None
    return cumulative_deposited, cumulative_withdrawn


async def _collect_principal_from_snowtrace(
    smart_address: str,
    owner_address: str,
    usdc_address: str,
) -> tuple[Decimal, Decimal] | None:
    """Collect lifetime owner<->smart USDC transfers from Snowtrace API."""
    settings = get_settings()
    api_key = (settings.SNOWTRACE_API_KEY or "").strip()
    if not api_key:
        return None

    smart_l = smart_address.lower()
    owner_l = owner_address.lower()
    contract_address = usdc_address.lower()
    base_url = settings.SNOWTRACE_API_URL.strip()

    cumulative_deposited = Decimal("0")
    cumulative_withdrawn = Decimal("0")

    async with httpx.AsyncClient(timeout=_SNOWTRACE_TIMEOUT_SECONDS) as client:
        for page in range(1, _SNOWTRACE_MAX_PAGES + 1):
            try:
                response = await client.get(
                    base_url,
                    params={
                        "module": "account",
                        "action": "tokentx",
                        "contractaddress": contract_address,
                        "address": smart_l,
                        "page": page,
                        "offset": _SNOWTRACE_PAGE_SIZE,
                        "sort": "asc",
                        "apikey": api_key,
                    },
                )
                response.raise_for_status()
                payload = response.json()
            except Exception as exc:
                logger.warning(
                    "Snowtrace principal fetch failed for %s page=%d: %s",
                    smart_address,
                    page,
                    exc,
                )
                return None

            status = str(payload.get("status", "")).strip()
            message = str(payload.get("message", "")).strip().lower()
            rows = payload.get("result") or []
            if status != "1":
                if message in {"no transactions found", "notok"} and not rows:
                    break
                logger.warning(
                    "Snowtrace returned non-success for %s page=%d: status=%s message=%s",
                    smart_address,
                    page,
                    status,
                    payload.get("message"),
                )
                return None

            if not isinstance(rows, list) or not rows:
                break

            for row in rows:
                source = str(row.get("from", "")).lower()
                destination = str(row.get("to", "")).lower()
                amount_raw = row.get("value", "0")
                try:
                    amount_usdc = _usdc_to_decimal(amount_raw)
                except Exception:
                    continue

                if source == owner_l and destination == smart_l:
                    cumulative_deposited += amount_usdc
                elif source == smart_l and destination == owner_l:
                    cumulative_withdrawn += amount_usdc

            if len(rows) < _SNOWTRACE_PAGE_SIZE:
                break

            if page == _SNOWTRACE_MAX_PAGES:
                logger.warning(
                    "Snowtrace principal fetch hit page limit for %s; skipping partial reconciliation",
                    smart_address,
                )
                return None

    if cumulative_deposited <= Decimal("0") and cumulative_withdrawn <= Decimal("0"):
        return None
    return cumulative_deposited, cumulative_withdrawn


async def _reconcile_principal_tracking_from_chain(
    db: Client,
    account_id: str,
    smart_address: str,
    owner_address: str,
    persist: bool = True,
) -> Decimal | None:
    """Rebuild principal ledger from on-chain USDC transfers between owner and smart account.

    This is a legacy recovery path for accounts that have stale/incomplete
    historical tracking rows. It is throttled per account to avoid repeated
    expensive receipt scans under dashboard polling.
    """
    cooldown_key = f"{account_id}:{smart_address.lower()}:{owner_address.lower()}"
    now_mono = time.monotonic()
    next_allowed = _principal_reconcile_cooldowns.get(cooldown_key, 0.0)
    if now_mono < next_allowed:
        return None
    _principal_reconcile_cooldowns[cooldown_key] = (
        now_mono + _PRINCIPAL_RECONCILE_COOLDOWN_SECONDS
    )

    try:
        settings = get_settings()
        usdc_address = settings.USDC_ADDRESS

        cumulative_deposited: Decimal | None = None
        cumulative_withdrawn: Decimal | None = None
        source_used = "receipt_logs"

        snowtrace_totals = await _collect_principal_from_snowtrace(
            smart_address=smart_address,
            owner_address=owner_address,
            usdc_address=usdc_address,
        )
        if snowtrace_totals is not None:
            cumulative_deposited, cumulative_withdrawn = snowtrace_totals
            source_used = "snowtrace"
        else:
            receipt_totals = await _collect_principal_from_rebalance_receipts(
                db=db,
                account_id=account_id,
                smart_address=smart_address,
                owner_address=owner_address,
                usdc_address=usdc_address,
            )
            if receipt_totals is None:
                return None
            cumulative_deposited, cumulative_withdrawn = receipt_totals

        deposited_q = cumulative_deposited.quantize(Decimal("0.000001"))
        withdrawn_q = cumulative_withdrawn.quantize(Decimal("0.000001"))

        if persist:
            db.table("account_yield_tracking").upsert(
                {
                    "account_id": account_id,
                    "cumulative_deposited": str(deposited_q),
                    "cumulative_net_withdrawn": str(withdrawn_q),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="account_id",
            ).execute()

        reconciled_net_principal = max(deposited_q - withdrawn_q, Decimal("0"))
        logger.warning(
            "Reconciled principal tracking for %s from %s (persist=%s): deposited=%s withdrawn=%s net=%s",
            smart_address,
            source_used,
            persist,
            deposited_q,
            withdrawn_q,
            reconciled_net_principal,
        )
        return reconciled_net_principal
    except Exception as exc:
        logger.warning(
            "Principal reconciliation from chain failed for %s: %s",
            smart_address,
            exc,
        )
        return None


async def _get_idle_usdc(address: str) -> Decimal:
    """Read the on-chain USDC balance sitting idle in the smart account.

    Retries on both 429 (rate-limit) and -32603 (RPC internal error).
    """
    import asyncio

    for attempt in range(3):
        try:
            settings = get_settings()
            w3 = get_shared_async_web3()
            usdc = w3.eth.contract(
                address=w3.to_checksum_address(settings.USDC_ADDRESS),
                abi=_ERC20_ABI,
            )
            balance_wei = await usdc.functions.balanceOf(
                w3.to_checksum_address(address)
            ).call()
            return Decimal(str(balance_wei)) / Decimal("1000000")
        except Exception as exc:
            err_str = str(exc)
            if attempt < 2:
                if "429" in err_str or "Too Many Requests" in err_str:
                    from app.core.rpc import get_rpc_manager
                    get_rpc_manager().report_rate_limit()
                elif "-32603" in err_str or "Internal error" in err_str:
                    await asyncio.sleep(0.5 * (2 ** attempt))
                else:
                    logger.warning("Failed to read idle USDC for %s: %s", address, exc)
                    return Decimal("0")
                continue
            logger.warning("Failed to read idle USDC for %s after %d attempts: %s", address, attempt + 1, exc)
            return Decimal("0")
    return Decimal("0")


async def _get_protocol_balance(address: str, protocol_id: str) -> Decimal | None:
    """Read on-chain underlying balance for a protocol."""
    for attempt in range(2):
        try:
            settings = get_settings()
            adapter = get_adapter(protocol_id)
            balance_wei = await adapter.get_user_balance(address, settings.USDC_ADDRESS)
            return Decimal(str(balance_wei)) / Decimal("1000000")
        except Exception as exc:
            err_str = str(exc)
            if attempt == 0 and ("429" in err_str or "Too Many Requests" in err_str):
                from app.core.rpc import get_rpc_manager
                get_rpc_manager().report_rate_limit()
                continue  # retry with rotated provider
            logger.warning("On-chain balance read failed for %s/%s: %s", protocol_id, address, exc)
            return None
    return None


async def _get_live_apys() -> dict[str, Decimal]:
    """Get display APYs aligned with /optimizer/rates behavior.

    Uses the same smoothing/fallback policy as rates endpoint:
      1. Prefer TWAP APY when available.
      2. Fall back to fresh spot APY from fetch_all_rates.
      3. Fall back to last cached TWAP snapshot when live fetch is missing.
      4. Apply same display safety cap (25%).

    This keeps portfolio allocations, optimizer preview, and dashboard rate cards
    consistent under transient RPC failures.
    """
    from app.services.optimizer.rate_fetcher import RateFetcher, twap_buffer
    try:
        fetcher = RateFetcher()
        rates = await fetcher.fetch_all_rates()
        apys: dict[str, Decimal] = {}

        for pid in ACTIVE_ADAPTERS.keys():
            rate = rates.get(pid)
            if rate is not None:
                display_apy = rate.apy
                twap_apy = twap_buffer.get_twap_effective_apy(pid)
                if twap_apy is not None and twap_apy > Decimal("0"):
                    display_apy = twap_apy
                apys[pid] = min(display_apy, Decimal("0.25"))
                continue

            cached = twap_buffer.get_latest(pid)
            if cached is not None:
                apys[pid] = min(cached.effective_apy, Decimal("0.25"))

        return apys
    except Exception as exc:
        logger.warning("Rate fetcher failed in portfolio: %s", exc)
        return {}


# ── GET /portfolio/{address} ──────────────────────────────

@router.get("/{address}", response_model=PortfolioResponse)
@limiter.limit("60/minute")
async def get_portfolio(
    request: Request,
    address: str,
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Return current portfolio state for a smart account."""
    address = validate_eth_address(address)
    # Find account — return empty portfolio for unregistered addresses
    # (prevents 404 spam from frontend polling before registration completes)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        idle_usdc = await _get_idle_usdc(address)
        allocations: list[AllocationResponse] = []
        if idle_usdc > Decimal("0.01"):
            allocations.append(
                AllocationResponse(
                    protocol_id="idle",
                    name="Idle USDC (Wallet)",
                    amount_usdc=idle_usdc,
                    allocation_pct=Decimal("1"),
                    current_apy=Decimal("0"),
                )
            )
        return PortfolioResponse(
            total_deposited_usd=idle_usdc,
            total_yield_usd=Decimal("0"),
            allocations=allocations,
            last_rebalance_at=None,
        )

    verify_account_ownership(_auth, acct.data[0], db=db)
    account_id = acct.data[0]["id"]
    owner_address = str(acct.data[0].get("owner_address") or "")

    cache_ttl = max(0, int(get_settings().PORTFOLIO_CACHE_TTL_SECONDS))
    cache_key = f"{str(account_id)}:{address.lower()}"
    cached_response = _portfolio_cache_get(cache_key)
    if cached_response is not None:
        return cached_response

    # Principal baseline from the same ledger used by withdrawal fee logic.
    tracked_net_principal: Decimal | None = None
    try:
        tracking = (
            db.table("account_yield_tracking")
            .select("cumulative_deposited, cumulative_net_withdrawn")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if tracking.data:
            cumulative_deposited = Decimal(str(tracking.data[0].get("cumulative_deposited") or 0))
            cumulative_withdrawn = Decimal(str(tracking.data[0].get("cumulative_net_withdrawn") or 0))
            tracked_net_principal = max(cumulative_deposited - cumulative_withdrawn, Decimal("0"))
    except Exception as exc:
        logger.warning("Failed to read yield tracking for %s: %s", address, exc)

    # Fetch allocations
    allocs = (
        db.table("allocations")
        .select("protocol_id, amount_usdc, allocation_pct, apy_at_allocation")
        .eq("account_id", account_id)
        .execute()
    )

    allocations: list[AllocationResponse] = []
    total_current_value = Decimal(0)
    db_protocol_ids: set[str] = set()
    for row in allocs.data or []:
        raw_protocol_id = str(row.get("protocol_id") or "")
        if not raw_protocol_id:
            continue

        protocol_id = _canonical_protocol_id(raw_protocol_id)
        amt = Decimal(str(row.get("amount_usdc") or 0))
        if amt <= Decimal("0"):
            continue

        total_current_value += amt
        db_protocol_ids.add(protocol_id)

        row_apy = Decimal(str(row.get("apy_at_allocation") or 0))
        row_pct = Decimal(str(row.get("allocation_pct") or 0))

        existing = next((a for a in allocations if a.protocol_id == protocol_id), None)
        if existing is None:
            allocations.append(
                AllocationResponse(
                    protocol_id=protocol_id,
                    name=_NAMES.get(protocol_id, protocol_id),
                    amount_usdc=amt,
                    allocation_pct=row_pct,
                    current_apy=row_apy,
                )
            )
            continue

        previous_amount = existing.amount_usdc
        combined_amount = previous_amount + amt
        if combined_amount > Decimal("0"):
            existing.current_apy = (
                (existing.current_apy * previous_amount) + (row_apy * amt)
            ) / combined_amount
        existing.amount_usdc = combined_amount
        existing.allocation_pct = existing.allocation_pct + row_pct

    # ── Parallel on-chain reads: protocol balances + idle USDC ────────────
    # APYs come from the rate_fetcher cache (uses 24h snapshots for vaults).
    protocol_ids = list(ACTIVE_ADAPTERS.keys())

    balance_tasks = [_get_protocol_balance(address, pid) for pid in protocol_ids]
    idle_task = _get_idle_usdc(address)
    apy_task = _get_live_apys()

    # Run balance reads + APY fetch concurrently
    balance_results = await asyncio.gather(*balance_tasks, idle_task, apy_task)
    onchain_balances = dict(zip(protocol_ids, balance_results[:len(protocol_ids)]))
    idle_usdc = balance_results[len(protocol_ids)]
    live_apys = balance_results[len(protocol_ids) + 1]

    # Reconcile DB allocations against on-chain reality:
    #   - If on-chain > 0 and DB differs significantly → use on-chain
    #   - If on-chain > 0 and not in DB → add as discovered allocation
    #   - If on-chain ≈ 0 but DB > 0 → zero out the stale DB entry
    for pid in protocol_ids:
        onchain_balance = onchain_balances[pid]
        existing = next((a for a in allocations if a.protocol_id == pid), None)

        # Keep last known amount when this protocol read failed.
        if onchain_balance is None:
            continue

        if onchain_balance > _PROTOCOL_BALANCE_DUST_USDC:
            if existing:
                if _should_refresh_amount(existing.amount_usdc, onchain_balance):
                    total_current_value -= existing.amount_usdc
                    existing.amount_usdc = onchain_balance
                    total_current_value += onchain_balance
            else:
                allocations.append(
                    AllocationResponse(
                        protocol_id=pid,
                        name=_NAMES.get(pid, pid),
                        amount_usdc=onchain_balance,
                        allocation_pct=Decimal("0"),
                        current_apy=live_apys.get(pid, Decimal("0")),
                    )
                )
                total_current_value += onchain_balance
        else:
            if existing and existing.amount_usdc > _PROTOCOL_BALANCE_DUST_USDC:
                total_current_value -= existing.amount_usdc
                existing.amount_usdc = Decimal("0")

    # Remove zero-balance allocations so they don't clutter the response
    allocations = [a for a in allocations if a.amount_usdc > Decimal("0.01")]

    # Apply live APYs (already fetched in parallel above)
    for alloc in allocations:
        apy = live_apys.get(alloc.protocol_id, Decimal("0"))
        if apy > Decimal("0"):
            alloc.current_apy = apy

    # Add idle USDC if present
    if idle_usdc > Decimal("0.01"):
        total_current_value += idle_usdc
        allocations.append(
            AllocationResponse(
                protocol_id="idle",
                name="Idle USDC (Wallet)",
                amount_usdc=idle_usdc,
                allocation_pct=Decimal("0"),
                current_apy=Decimal("0"),
            )
        )

    # Recalculate allocation_pct for all entries
    if total_current_value > 0:
        for alloc in allocations:
            alloc.allocation_pct = alloc.amount_usdc / total_current_value

    # Last rebalance timestamp
    last_rb = (
        db.table("rebalance_logs")
        .select("created_at")
        .eq("account_id", account_id)
        .eq("status", "executed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    last_ts = last_rb.data[0]["created_at"] if last_rb.data else None

    # Expose principal and yield consistently:
    #   current value = net principal + net earned
    # Reconcile from chain transfer history when principal tracking drifts.
    # Overcount trigger: tracked principal far above current value.
    # Undercount trigger: tracked principal below current value shortly after
    # a fresh owner->smart funding transfer (common onboarding drift signal).
    reconcile_principal = False
    if tracked_net_principal is not None and owner_address:
        principal_overcount = (tracked_net_principal - total_current_value) > _PRINCIPAL_RECONCILE_DRIFT_USDC
        principal_undercount = (total_current_value - tracked_net_principal) > _PRINCIPAL_RECONCILE_UNDERCOUNT_DRIFT_USDC

        recent_funding_transfer = False
        if principal_undercount:
            try:
                latest_funding = (
                    db.table("rebalance_logs")
                    .select("created_at")
                    .eq("account_id", account_id)
                    .eq("status", "executed")
                    .eq("from_protocol", "user_wallet")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                if latest_funding.data:
                    funding_at = datetime.fromisoformat(
                        str(latest_funding.data[0]["created_at"]).replace("Z", "+00:00")
                    )
                    minutes_since_funding = (
                        datetime.now(timezone.utc) - funding_at
                    ).total_seconds() / 60
                    recent_funding_transfer = (
                        minutes_since_funding <= _PRINCIPAL_RECONCILE_UNDERCOUNT_LOOKBACK_MINUTES
                    )
            except Exception as exc:
                logger.warning(
                    "Failed to evaluate funding-transfer principal drift trigger for %s: %s",
                    address,
                    exc,
                )

        reconcile_principal = principal_overcount or (principal_undercount and recent_funding_transfer)

    if reconcile_principal:
        reconciled_principal = await _reconcile_principal_tracking_from_chain(
            db,
            account_id=str(account_id),
            smart_address=address,
            owner_address=owner_address,
        )
        if reconciled_principal is not None:
            before_drift = abs(tracked_net_principal - total_current_value)
            after_drift = abs(reconciled_principal - total_current_value)
            if (
                after_drift
                + _PRINCIPAL_RECONCILE_IMPROVEMENT_EPSILON_USDC
                < before_drift
            ):
                tracked_net_principal = reconciled_principal
            else:
                logger.warning(
                    "Skipping reconciled principal for %s: before_drift=%s after_drift=%s",
                    address,
                    before_drift,
                    after_drift,
                )

    net_principal = tracked_net_principal if tracked_net_principal is not None else total_current_value
    total_yield = total_current_value - net_principal

    response = PortfolioResponse(
        total_deposited_usd=net_principal,
        total_yield_usd=total_yield,
        allocations=allocations,
        last_rebalance_at=last_ts,
    )
    _portfolio_cache_put(cache_key, response, cache_ttl)
    return response


# ── GET /portfolio/{address}/history ─────────────────────

@router.get("/{address}/history", response_model=RebalanceHistoryResponse)
@limiter.limit("30/minute")
async def get_rebalance_history(
    request: Request,
    address: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Client = Depends(get_db),
    _auth: dict = Depends(require_privy_auth),
):
    """Paginated rebalance log history."""
    address = validate_eth_address(address)
    acct = (
        db.table("accounts")
        .select("id, owner_address, privy_did")
        .eq("address", address)
        .limit(1)
        .execute()
    )
    if not acct.data:
        return RebalanceHistoryResponse(logs=[], total=0)

    verify_account_ownership(_auth, acct.data[0], db=db)
    account_id = acct.data[0]["id"]

    # Total count
    count_result = (
        db.table("rebalance_logs")
        .select("id", count="exact")
        .eq("account_id", account_id)
        .execute()
    )
    total = count_result.count if count_result.count is not None else 0

    # Page
    rows = (
        db.table("rebalance_logs")
        .select("id, status, proposed_allocations, executed_allocations, apr_improvement, gas_cost_usd, tx_hash, created_at")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    logs = [
        RebalanceLogResponse(
            id=r["id"],
            status=r["status"],
            proposed_allocations=r.get("proposed_allocations"),
            executed_allocations=r.get("executed_allocations"),
            apr_improvement=r.get("apr_improvement"),
            gas_cost_usd=r.get("gas_cost_usd"),
            tx_hash=r.get("tx_hash"),
            created_at=r["created_at"],
        )
        for r in (rows.data or [])
    ]

    return RebalanceHistoryResponse(logs=logs, total=total)
