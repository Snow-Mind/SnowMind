"""Time-Weighted Average Price rate smoother.

Flash-loan defence: outlier snapshots (>50 % deviation from window mean)
are excluded automatically.  A minimum of 2 snapshots is required before
the TWAP is considered reliable.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from supabase import Client

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

# Outlier detection: if a snapshot deviates more than this fraction of
# the window mean it is excluded (flash-loan defence).
_OUTLIER_DEVIATION = Decimal("0.50")

# Spike detection: if new_rate > this multiple of recent average → spike.
_SPIKE_MULTIPLE = Decimal("2")

# Consecutive-read confirmation: successive reads must be within this
# fraction of each other to count as "confirmed".
_CONFIRMATION_TOLERANCE = Decimal("0.10")


class TWAPOracle:
    """Database-backed TWAP with outlier detection and spike defence."""

    def __init__(self, db: Client, window_minutes: int | None = None) -> None:
        self._db = db
        settings = get_settings()
        self.window = window_minutes or settings.TWAP_WINDOW_MINUTES

    # ── Core TWAP ────────────────────────────────────────────────────────────

    async def get_twap(self, protocol_id: str) -> Decimal | None:
        """Return the TWAP rate for *protocol_id* over the configured window.

        1. Load snapshots from ``rate_snapshots`` for the last *window* minutes.
        2. Require at least 2 snapshots (single reads are unreliable).
        3. Exclude any snapshot deviating >50 % from the simple average
           (flash-loan defence).
        4. Compute a linearly time-weighted average: more-recent snapshots
           get slightly higher weight.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=self.window)).isoformat()

        rows = (
            self._db.table("rate_snapshots")
            .select("apy, snapshot_at")
            .eq("protocol_id", protocol_id)
            .gte("snapshot_at", cutoff)
            .order("snapshot_at", desc=False)
            .execute()
        )

        snapshots: list[tuple[float, Decimal]] = []
        for r in (rows.data or []):
            ts = datetime.fromisoformat(r["snapshot_at"]).timestamp()
            snapshots.append((ts, Decimal(str(r["apy"]))))

        if len(snapshots) < 2:
            return None  # not enough data — wait for more reads

        # ── Step 1: simple mean for outlier detection ────────────────────
        simple_mean = sum(apy for _, apy in snapshots) / len(snapshots)

        # ── Step 2: exclude outliers (|apy - mean| / mean > 50 %) ────────
        filtered: list[tuple[float, Decimal]] = []
        for ts, apy in snapshots:
            if simple_mean == 0:
                filtered.append((ts, apy))
                continue
            deviation = abs(apy - simple_mean) / simple_mean
            if deviation > _OUTLIER_DEVIATION:
                logger.warning(
                    "TWAP outlier excluded — %s apy=%.6f mean=%.6f dev=%.2f",
                    protocol_id,
                    apy,
                    simple_mean,
                    deviation,
                )
            else:
                filtered.append((ts, apy))

        if len(filtered) < 2:
            return None  # all but one excluded — unreliable

        # ── Step 3: time-weighted average (linear weight by recency) ─────
        t_min = filtered[0][0]
        t_max = filtered[-1][0]
        span = t_max - t_min if t_max > t_min else Decimal(1)

        weighted_sum = Decimal(0)
        weight_total = Decimal(0)
        for ts, apy in filtered:
            # Weight: 1.0 for the oldest, 2.0 for the newest
            w = Decimal(1) + Decimal(str((ts - t_min) / float(span)))
            weighted_sum += apy * w
            weight_total += w

        return weighted_sum / weight_total if weight_total else None

    # ── Confirmation gate ────────────────────────────────────────────────────

    async def has_confirmation(
        self, protocol_id: str, min_reads: int = 2
    ) -> bool:
        """True when the last *min_reads* consecutive snapshots agree
        within 10 % of each other.
        """
        rows = (
            self._db.table("rate_snapshots")
            .select("apy")
            .eq("protocol_id", protocol_id)
            .order("snapshot_at", desc=True)
            .limit(min_reads)
            .execute()
        )

        reads = [Decimal(str(r["apy"])) for r in (rows.data or [])]
        if len(reads) < min_reads:
            return False

        # All pairs must be within tolerance
        for i in range(len(reads) - 1):
            a, b = reads[i], reads[i + 1]
            ref = max(a, b)
            if ref == 0:
                continue
            if abs(a - b) / ref > _CONFIRMATION_TOLERANCE:
                return False
        return True

    # ── Spike detection ──────────────────────────────────────────────────────

    async def detect_rate_spike(
        self, protocol_id: str, new_rate: Decimal
    ) -> bool:
        """Return True if *new_rate* is a likely flash-loan spike.

        A spike is declared when *new_rate* exceeds 2× the average of the
        last 3 readings.
        """
        rows = (
            self._db.table("rate_snapshots")
            .select("apy")
            .eq("protocol_id", protocol_id)
            .order("snapshot_at", desc=True)
            .limit(3)
            .execute()
        )

        recent = [Decimal(str(r["apy"])) for r in (rows.data or [])]
        if len(recent) < 3:
            return False  # not enough history to judge

        avg = sum(recent) / len(recent)
        if avg <= 0:
            return new_rate > 0

        if new_rate > avg * _SPIKE_MULTIPLE:
            logger.warning(
                "Rate spike detected — %s new=%.6f avg_3=%.6f (>2×)",
                protocol_id,
                new_rate,
                avg,
            )
            return True
        return False

    # ── Snapshot persistence ─────────────────────────────────────────────────

    async def record_snapshot(
        self, protocol_id: str, apy: Decimal, source: str = "on_chain"
    ) -> None:
        """Persist a rate snapshot for later TWAP queries."""
        self._db.table("rate_snapshots").insert(
            {
                "protocol_id": protocol_id,
                "apy": str(apy),
                "snapshot_at": datetime.now(timezone.utc).isoformat(),
                "source": source,
            }
        ).execute()
