"""
On-chain APY rate fetcher with TWAP smoothing and DB persistence.

TWAP (Time-Weighted Average Price) is used for all allocation decisions:
  - Buffer: 3 most recent snapshots (taken every 30 minutes)
  - Cold-start guard: Until 3 snapshots accumulated, use spot rate but flag it
  - Persistence: Snapshots saved to DB (survives restarts)
  - Spark: Uses convertToAssets(1e6) daily snapshot delta for APY

DefiLlama is used ONLY as a soft cross-validation signal, NOT as a rate source.
"""

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.protocols import ALL_ADAPTERS
from app.services.protocols.base import ProtocolRate

logger = logging.getLogger("snowmind.rate_fetcher")

# ── Response-level cache for rate fetches ────────────────────────────────────
# Prevents Infura 429 storms when /rates is polled rapidly by the frontend.
_rate_cache: dict[str, ProtocolRate] = {}
_rate_cache_timestamp: float = 0.0
_RATE_CACHE_TTL_SECONDS: float = 45.0  # Serve cached rates for 45s

# ERC-4626 vault adapters that use 24h convertToAssets snapshots for stable APY
_VAULT_SNAPSHOT_PROTOCOLS = {"spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"}


# ── Circuit breaker ──────────────────────────────────────────────────────────

@dataclass
class CircuitBreaker:
    """Track consecutive failures per protocol with half-open recovery.

    Once a protocol hits CIRCUIT_BREAKER_THRESHOLD consecutive failures,
    the circuit opens.  After CIRCUIT_BREAKER_COOLDOWN_SECONDS, it enters
    a 'half-open' state where a single test request is allowed through.
    If that succeeds, the circuit closes.  If it fails, cooldown resets.
    """

    _failures: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    _last_failure_at: dict[str, float] = field(default_factory=lambda: defaultdict(float))

    def record_failure(self, protocol_id: str) -> None:
        self._failures[protocol_id] += 1
        self._last_failure_at[protocol_id] = time.time()
        if self._failures[protocol_id] >= get_settings().CIRCUIT_BREAKER_THRESHOLD:
            logger.error(
                "Circuit OPEN for %s (%d consecutive failures)",
                protocol_id,
                self._failures[protocol_id],
            )

    def record_success(self, protocol_id: str) -> None:
        if self._failures[protocol_id] >= get_settings().CIRCUIT_BREAKER_THRESHOLD:
            logger.info("Circuit CLOSED for %s after successful half-open probe", protocol_id)
        self._failures[protocol_id] = 0

    def is_open(self, protocol_id: str) -> bool:
        threshold = get_settings().CIRCUIT_BREAKER_THRESHOLD
        if self._failures[protocol_id] < threshold:
            return False
        # Half-open: allow one retry after cooldown period
        cooldown = get_settings().CIRCUIT_BREAKER_COOLDOWN_SECONDS
        elapsed = time.time() - self._last_failure_at.get(protocol_id, 0.0)
        if elapsed >= cooldown:
            logger.info(
                "Circuit half-open for %s — allowing probe after %.0fs cooldown",
                protocol_id,
                elapsed,
            )
            return False
        return True

    def get_failure_count(self, protocol_id: str) -> int:
        return self._failures[protocol_id]


circuit_breaker = CircuitBreaker()


# ── TWAP Buffer with DB persistence ─────────────────────────────────────────

@dataclass
class TWAPSnapshot:
    """A single TWAP snapshot."""
    protocol_id: str
    apy: Decimal
    effective_apy: Decimal
    tvl_usd: Decimal
    utilization_rate: Decimal | None
    fetched_at: float


class TWAPBuffer:
    """
    Store recent rate samples for time-weighted averaging.

    Snapshots are persisted to Supabase so TWAP survives restarts.
    The buffer keeps the N most recent snapshots per protocol (default: 3).
    """

    def __init__(self, max_snapshots: int = 3) -> None:
        self.max_snapshots = max_snapshots
        self._samples: dict[str, list[TWAPSnapshot]] = defaultdict(list)
        self._loaded_from_db = False

    def add(self, rate: ProtocolRate) -> None:
        """Add a new snapshot and persist to DB."""
        snapshot = TWAPSnapshot(
            protocol_id=rate.protocol_id,
            apy=rate.apy,
            effective_apy=rate.effective_apy,
            tvl_usd=rate.tvl_usd,
            utilization_rate=rate.utilization_rate,
            fetched_at=rate.fetched_at,
        )
        buf = self._samples[rate.protocol_id]
        buf.append(snapshot)
        # Keep only the most recent N snapshots
        if len(buf) > self.max_snapshots:
            self._samples[rate.protocol_id] = buf[-self.max_snapshots:]

        # Persist to DB
        self._persist_snapshot(snapshot)

    def get_twap_effective_apy(self, protocol_id: str) -> Decimal | None:
        """
        Get the TWAP of effective APY for a protocol.

        Returns None if no samples available.
        """
        buf = self._samples.get(protocol_id, [])
        if not buf:
            return None
        total = sum((s.effective_apy for s in buf), Decimal(0))
        return total / len(buf)

    def get_latest(self, protocol_id: str) -> TWAPSnapshot | None:
        """Get the most recent snapshot for a protocol."""
        buf = self._samples.get(protocol_id, [])
        return buf[-1] if buf else None

    def has_cold_start(self, protocol_id: str) -> bool:
        """True if fewer than max_snapshots have been collected."""
        return len(self._samples.get(protocol_id, [])) < self.max_snapshots

    def sample_count(self, protocol_id: str) -> int:
        return len(self._samples.get(protocol_id, []))

    def load_from_db(self) -> None:
        """Load persisted TWAP snapshots from DB on startup."""
        if self._loaded_from_db:
            return
        try:
            db = get_supabase()
            for pid in ALL_ADAPTERS:
                result = (
                    db.table("twap_snapshots")
                    .select("*")
                    .eq("protocol_id", pid)
                    .order("fetched_at", desc=True)
                    .limit(self.max_snapshots)
                    .execute()
                )
                if result.data:
                    # Reverse to chronological order
                    for row in reversed(result.data):
                        self._samples[pid].append(TWAPSnapshot(
                            protocol_id=row["protocol_id"],
                            apy=Decimal(str(row["apy"])),
                            effective_apy=Decimal(str(row["effective_apy"])),
                            tvl_usd=Decimal(str(row["tvl_usd"])),
                            utilization_rate=(
                                Decimal(str(row["utilization_rate"]))
                                if row.get("utilization_rate") is not None
                                else None
                            ),
                            fetched_at=float(row["fetched_at"]),
                        ))
                    logger.info(
                        "Loaded %d TWAP snapshots for %s from DB",
                        len(result.data),
                        pid,
                    )
            self._loaded_from_db = True
        except Exception as exc:
            logger.warning("Failed to load TWAP snapshots from DB: %s", exc)

    def _persist_snapshot(self, snapshot: TWAPSnapshot) -> None:
        """Persist a snapshot to DB."""
        try:
            db = get_supabase()
            db.table("twap_snapshots").insert({
                "protocol_id": snapshot.protocol_id,
                "apy": str(snapshot.apy),
                "effective_apy": str(snapshot.effective_apy),
                "tvl_usd": str(snapshot.tvl_usd),
                "utilization_rate": str(snapshot.utilization_rate) if snapshot.utilization_rate is not None else None,
                "fetched_at": snapshot.fetched_at,
            }).execute()
        except Exception as exc:
            logger.warning(
                "Failed to persist TWAP snapshot for %s: %s",
                snapshot.protocol_id,
                exc,
            )


twap_buffer = TWAPBuffer(max_snapshots=get_settings().TWAP_SNAPSHOT_COUNT)


# ── Public API ───────────────────────────────────────────────────────────────

class RateFetcher:
    """Fetch live protocol rates with circuit-breaking and TWAP smoothing."""

    def __init__(self) -> None:
        self.settings = get_settings()
        # Ensure DB snapshots are loaded on first use
        twap_buffer.load_from_db()
        # Seed share-price-growth adapters with DB-persisted APY to avoid
        # 30-minute cold-start 0% APY after Railway deploys/restarts
        self._seed_cached_apy_from_db()

    def _seed_cached_apy_from_db(self) -> None:
        """Seed _cached_apy on share-price-growth adapters from DB TWAP snapshots.

        After a server restart, Euler/Silo/Spark adapters start with _cached_apy=0.
        The share-price-growth algorithm needs ≥2 readings >60s apart (i.e. ~30 min
        with the current scheduler interval) before computing a non-zero APY.

        This method uses the last known effective_apy from the DB-persisted TWAP
        buffer to populate _cached_apy so the first get_rate() call after restart
        returns a reasonable APY immediately.
        """
        share_price_protocols = ["euler_v2", "silo_savusd_usdc", "silo_susdp_usdc", "spark"]
        for pid in share_price_protocols:
            adapter = ALL_ADAPTERS.get(pid)
            if adapter is None:
                continue
            if not hasattr(adapter, "_cached_apy"):
                continue
            if adapter._cached_apy != Decimal("0"):
                continue  # Already seeded or computed — don't overwrite
            latest = twap_buffer.get_latest(pid)
            if latest and latest.effective_apy > Decimal("0"):
                adapter._cached_apy = latest.effective_apy
                logger.info(
                    "Seeded %s cached APY from DB: %.4f%%",
                    pid,
                    float(latest.effective_apy * Decimal("100")),
                )

    async def fetch_all_rates(self) -> dict[str, ProtocolRate]:
        """
        Fetch from ALL active adapters with concurrency throttling.

        Returns cached results if within the TTL window to prevent Infura 429
        storms when the /rates endpoint is polled rapidly by the frontend.

        Uses an asyncio.Semaphore to limit concurrent RPC calls and prevent
        Infura 429 rate-limiting.  For Spark: passes yesterday's
        convertToAssets snapshot to the adapter.
        """
        global _rate_cache, _rate_cache_timestamp

        # Return cached rates if still fresh
        now = time.time()
        if _rate_cache and (now - _rate_cache_timestamp) < _RATE_CACHE_TTL_SECONDS:
            logger.debug(
                "Returning cached rates (age=%.0fs, ttl=%.0fs)",
                now - _rate_cache_timestamp,
                _RATE_CACHE_TTL_SECONDS,
            )
            return dict(_rate_cache)

        settings = self.settings
        semaphore = asyncio.Semaphore(settings.RPC_CONCURRENCY_LIMIT)

        async def _do_fetch(pid: str) -> ProtocolRate:
            """Execute a single adapter's get_rate() call."""
            adapter = ALL_ADAPTERS[pid]
            # Pass 24h convertToAssets snapshot to all ERC-4626 vault adapters
            if pid in _VAULT_SNAPSHOT_PROTOCOLS:
                snapshot_data = self._get_vault_yesterday_snapshot(pid)
                if snapshot_data is not None:
                    yesterday_value, snapshot_at = snapshot_data
                    return await adapter.get_rate(
                        yesterday_snapshot=yesterday_value,
                        snapshot_at=snapshot_at,
                    )
                else:
                    return await adapter.get_rate(yesterday_snapshot=None)
            else:
                return await adapter.get_rate()

        async def _throttled_fetch(pid: str) -> tuple[str, ProtocolRate | Exception]:
            """Run a single adapter fetch under the concurrency semaphore.

            On 429 rate-limit errors, notifies the RPCManager to rotate
            providers and retries once with the new provider.
            """
            async with semaphore:
                try:
                    result = await _do_fetch(pid)
                    return pid, result
                except Exception as exc:
                    err_str = str(exc)
                    if "429" in err_str or "Too Many Requests" in err_str:
                        from app.core.rpc import get_rpc_manager
                        get_rpc_manager().report_rate_limit()
                        try:
                            result = await _do_fetch(pid)
                            return pid, result
                        except Exception as retry_exc:
                            return pid, retry_exc
                    return pid, exc

        pids_to_fetch = [
            pid for pid in ALL_ADAPTERS
            if not circuit_breaker.is_open(pid)
        ]
        for pid in ALL_ADAPTERS:
            if circuit_breaker.is_open(pid):
                logger.warning("Skipping %s — circuit breaker open", pid)

        if not pids_to_fetch:
            return {}

        raw_results = await asyncio.gather(
            *[_throttled_fetch(pid) for pid in pids_to_fetch]
        )

        results: dict[str, ProtocolRate] = {}
        for pid, result in raw_results:
            if isinstance(result, Exception):
                logger.warning("Rate fetch failed for %s: %s", pid, result)
                circuit_breaker.record_failure(pid)
            else:
                results[pid] = result
                circuit_breaker.record_success(pid)
                twap_buffer.add(result)

        # Update response cache
        if results:
            _rate_cache.clear()
            _rate_cache.update(results)
            _rate_cache_timestamp = time.time()

        return results

    async def fetch_active_rates(self) -> dict[str, ProtocolRate]:
        """Backward-compatible alias retained for legacy scheduler/routes."""
        return await self.fetch_all_rates()

    def get_twap_effective_apys(self) -> dict[str, Decimal]:
        """Return TWAP-smoothed effective APYs for all protocols with samples."""
        rates: dict[str, Decimal] = {}
        for pid in ALL_ADAPTERS:
            twap = twap_buffer.get_twap_effective_apy(pid)
            if twap is not None:
                rates[pid] = twap
        return rates

    def get_latest_rates(self) -> dict[str, TWAPSnapshot]:
        """Return the most recent snapshot for each protocol."""
        latest: dict[str, TWAPSnapshot] = {}
        for pid in ALL_ADAPTERS:
            snap = twap_buffer.get_latest(pid)
            if snap:
                latest[pid] = snap
        return latest

    def get_cold_start_protocols(self) -> list[str]:
        """Return list of protocols still in cold-start (< 3 snapshots)."""
        return [
            pid for pid in ALL_ADAPTERS
            if twap_buffer.has_cold_start(pid) and not circuit_breaker.is_open(pid)
        ]

    @staticmethod
    def validate_rate(rate: ProtocolRate) -> bool:
        """Return True if a fetched rate is sane enough for allocation decisions.

        Rejects negative APY, absurdly high APY (>200%), and negative TVL.
        Allows 0% APY (e.g. Spark base layer when no snapshot delta is available).
        """
        if rate.apy < Decimal("0"):
            return False
        if rate.apy > Decimal("2.0"):  # 200% — likely a data error
            logger.warning("Rate for %s rejected: APY=%s exceeds 200%%", rate.protocol_id, rate.apy)
            return False
        if rate.tvl_usd < Decimal("0"):
            return False
        return True

    def get_circuit_breaker_failures(self) -> dict[str, int]:
        """Return failure counts for all protocols (used by health checker)."""
        return {
            pid: circuit_breaker.get_failure_count(pid)
            for pid in ALL_ADAPTERS
        }

    def _get_vault_yesterday_snapshot(self, protocol_id: str) -> tuple[Decimal, str] | None:
        """
        Get yesterday's convertToAssets(1e18) value and timestamp from DB.

        Returns (value, snapshot_at_iso) tuple so callers can compute the
        actual elapsed time instead of assuming exactly 24h.
        """
        try:
            db = get_supabase()
            import datetime
            result = (
                db.table("spark_convert_snapshots")
                .select("convert_to_assets_value, snapshot_at")
                .eq("protocol_id", protocol_id)
                .order("snapshot_at", desc=True)
                .limit(6)
                .execute()
            )

            rows = result.data or []
            if rows:
                now_dt = datetime.datetime.now(datetime.timezone.utc)
                target_age_seconds = Decimal("86400")
                min_age_seconds = Decimal("21600")  # ignore very fresh snapshots (< 6h)

                best_row: dict[str, Any] | None = None
                best_diff: Decimal | None = None

                for row in rows:
                    snapshot_at_raw = row.get("snapshot_at")
                    if not snapshot_at_raw:
                        continue
                    try:
                        snap_dt = datetime.datetime.fromisoformat(
                            str(snapshot_at_raw).replace("Z", "+00:00")
                        )
                    except (TypeError, ValueError):
                        continue

                    age_seconds = Decimal(str((now_dt - snap_dt).total_seconds()))
                    if age_seconds < min_age_seconds:
                        continue

                    diff = abs(age_seconds - target_age_seconds)
                    if best_row is None or best_diff is None or diff < best_diff:
                        best_row = row
                        best_diff = diff

                chosen = best_row or rows[0]
                value = Decimal(str(chosen["convert_to_assets_value"]))
                snapshot_at = str(chosen["snapshot_at"])
                return (value, snapshot_at)
            return None
        except Exception as exc:
            logger.warning("Failed to get %s yesterday snapshot: %s", protocol_id, exc)
            return None

    async def save_vault_daily_snapshot(self, protocol_id: str) -> None:
        """
        Save daily convertToAssets(1e18) snapshot for any ERC-4626 vault.

        Should be called once per day by the scheduler for each vault adapter.
        """
        try:
            adapter = ALL_ADAPTERS.get(protocol_id)
            if not adapter or not hasattr(adapter, "get_convert_to_assets_value"):
                return

            value = await adapter.get_convert_to_assets_value()
            db = get_supabase()
            db.table("spark_convert_snapshots").insert({
                "protocol_id": protocol_id,
                "convert_to_assets_value": str(value),
            }).execute()
            logger.info("Saved %s convertToAssets snapshot: %d", protocol_id, value)
        except Exception as exc:
            logger.warning("Failed to save %s daily snapshot: %s", protocol_id, exc)
