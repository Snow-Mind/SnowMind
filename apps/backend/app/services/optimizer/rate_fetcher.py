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

        Uses an asyncio.Semaphore to limit concurrent RPC calls and prevent
        Infura 429 rate-limiting.  For Spark: passes yesterday's
        convertToAssets snapshot to the adapter.
        """
        settings = self.settings
        semaphore = asyncio.Semaphore(settings.RPC_CONCURRENCY_LIMIT)

        async def _throttled_fetch(pid: str) -> tuple[str, ProtocolRate | Exception]:
            """Run a single adapter fetch under the concurrency semaphore."""
            async with semaphore:
                try:
                    adapter = ALL_ADAPTERS[pid]
                    if pid == "spark":
                        yesterday_snapshot = self._get_spark_yesterday_snapshot()
                        result = await adapter.get_rate(yesterday_snapshot=yesterday_snapshot)
                    else:
                        result = await adapter.get_rate()
                    return pid, result
                except Exception as exc:
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

    def _get_spark_yesterday_snapshot(self) -> Decimal | None:
        """
        Get yesterday's Spark convertToAssets(1e6) value from DB.

        Used for Spark APY calculation: gross_apy = (today - yesterday) / yesterday × 365
        """
        try:
            db = get_supabase()
            import datetime
            yesterday = (
                datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(days=1)
            ).isoformat()
            result = (
                db.table("spark_convert_snapshots")
                .select("convert_to_assets_value")
                .lte("snapshot_at", yesterday)
                .order("snapshot_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data:
                return Decimal(str(result.data[0]["convert_to_assets_value"]))
            return None
        except Exception as exc:
            logger.warning("Failed to get Spark yesterday snapshot: %s", exc)
            return None

    async def save_spark_daily_snapshot(self) -> None:
        """
        Save daily Spark convertToAssets(1e6) snapshot for APY calculation.

        Should be called once per day by the scheduler.
        """
        try:
            spark_adapter = ALL_ADAPTERS.get("spark")
            if not spark_adapter:
                return

            value = await spark_adapter.get_convert_to_assets_value()
            db = get_supabase()
            db.table("spark_convert_snapshots").insert({
                "convert_to_assets_value": str(value),
            }).execute()
            logger.info("Saved Spark convertToAssets snapshot: %d", value)
        except Exception as exc:
            logger.warning("Failed to save Spark daily snapshot: %s", exc)
