"""On-chain APY rate fetcher with TWAP smoothing."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from app.core.config import get_settings
from app.services.protocols import ALL_ADAPTERS, ACTIVE_ADAPTERS
from app.services.protocols.base import ProtocolRate

logger = logging.getLogger("snowmind")


# ── Circuit breaker ──────────────────────────────────────────────────────────

@dataclass
class _CircuitBreaker:
    """Track consecutive failures per protocol to exclude flaky adapters."""

    MAX_FAILURES: int = 3
    _failures: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def record_failure(self, protocol_id: str) -> None:
        self._failures[protocol_id] += 1
        if self._failures[protocol_id] >= self.MAX_FAILURES:
            logger.error(
                "Circuit OPEN for %s (%d consecutive failures)",
                protocol_id,
                self._failures[protocol_id],
            )

    def record_success(self, protocol_id: str) -> None:
        self._failures[protocol_id] = 0

    def is_open(self, protocol_id: str) -> bool:
        return self._failures[protocol_id] >= self.MAX_FAILURES


circuit_breaker = _CircuitBreaker()


# ── TWAP ring buffer ─────────────────────────────────────────────────────────

@dataclass
class _TWAPBuffer:
    """Store recent rate samples for time-weighted averaging."""

    _samples: dict[str, list[tuple[float, ProtocolRate]]] = field(
        default_factory=lambda: defaultdict(list)
    )
    window_seconds: float = 900.0  # 15 min default

    def add(self, rate: ProtocolRate) -> None:
        now = time.time()
        buf = self._samples[rate.protocol_id]
        buf.append((now, rate))
        # Evict stale samples
        cutoff = now - self.window_seconds
        self._samples[rate.protocol_id] = [
            (t, r) for t, r in buf if t >= cutoff
        ]

    def get_twap(self, protocol_id: str) -> ProtocolRate | None:
        buf = self._samples.get(protocol_id, [])
        if not buf:
            return None
        # Simple average of APYs in the window
        total_apy = sum((r.apy for _, r in buf), Decimal(0))
        avg_apy = total_apy / len(buf)
        latest = buf[-1][1]
        return ProtocolRate(
            protocol_id=protocol_id,
            apy=avg_apy,
            tvl_usd=latest.tvl_usd,
            utilization_rate=latest.utilization_rate,
            fetched_at=latest.fetched_at,
        )

    def sample_count(self, protocol_id: str) -> int:
        return len(self._samples.get(protocol_id, []))


twap_buffer = _TWAPBuffer()


# ── Public API ───────────────────────────────────────────────────────────────

class RateFetcher:
    """Fetch live protocol rates with circuit-breaking and TWAP smoothing."""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def fetch_all_rates(self) -> dict[str, ProtocolRate]:
        """Fetch from ALL adapters concurrently (including coming-soon for UI)."""
        tasks = {}
        for pid, adapter in ALL_ADAPTERS.items():
            if circuit_breaker.is_open(pid):
                logger.warning("Skipping %s — circuit breaker open", pid)
                continue
            tasks[pid] = adapter.get_rate()

        completed = await asyncio.gather(
            *tasks.values(), return_exceptions=True
        )

        results: dict[str, ProtocolRate] = {}
        for pid, result in zip(tasks.keys(), completed):
            if isinstance(result, Exception):
                logger.warning("Rate fetch failed for %s: %s", pid, result)
                circuit_breaker.record_failure(pid)
            else:
                results[pid] = result
                circuit_breaker.record_success(pid)
                twap_buffer.add(result)
        return results

    async def fetch_active_rates(self) -> dict[str, ProtocolRate]:
        """Fetch from ACTIVE adapters only (for MILP input)."""
        tasks = {}
        for pid, adapter in ACTIVE_ADAPTERS.items():
            if circuit_breaker.is_open(pid):
                continue
            tasks[pid] = adapter.get_rate()

        completed = await asyncio.gather(
            *tasks.values(), return_exceptions=True
        )

        results: dict[str, ProtocolRate] = {}
        for pid, result in zip(tasks.keys(), completed):
            if isinstance(result, Exception):
                logger.warning("Rate fetch failed for %s: %s", pid, result)
                circuit_breaker.record_failure(pid)
            else:
                results[pid] = result
                circuit_breaker.record_success(pid)
                twap_buffer.add(result)
        return results

    def get_twap_rates(self) -> dict[str, ProtocolRate]:
        """Return TWAP-smoothed rates for all protocols with samples."""
        rates: dict[str, ProtocolRate] = {}
        for pid in ACTIVE_ADAPTERS:
            twap = twap_buffer.get_twap(pid)
            if twap:
                rates[pid] = twap
        return rates

    def validate_rate(self, rate: ProtocolRate) -> bool:
        """Reject rates above the sanity bound (25 % APY)."""
        max_apy = Decimal(str(self.settings.MAX_APY_SANITY_BOUND))
        if rate.apy > max_apy:
            logger.warning(
                "Rate anomaly: %s APY=%s > bound %s",
                rate.protocol_id,
                rate.apy,
                max_apy,
            )
            return False
        return True
