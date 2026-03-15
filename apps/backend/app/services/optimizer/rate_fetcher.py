"""On-chain APY rate fetcher with TWAP smoothing."""

import asyncio
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

import httpx

from app.core.config import get_settings
from app.services.protocols import ALL_ADAPTERS, ACTIVE_ADAPTERS
from app.services.protocols.base import ProtocolRate

logger = logging.getLogger("snowmind")


# DefiLlama pool IDs for mainnet Avalanche USDC vaults.
# Used on testnet so the optimizer makes decisions based on real mainnet APYs
# while still depositing into mock contracts.
MAINNET_POOL_IDS: dict[str, str] = {
    "aave_v3": "c4b05318-88af-4536-a834-f5fc8940d2d3",   # Aave V3 Avalanche USDC
    "benqi":   "ff59b165-64e0-4868-a6db-6049b5135358",   # Benqi Avalanche USDC
    "euler_v2": "e1db168e-7c9d-4285-9d3f-ba83a9ecf105",  # Euler V2 Avalanche USDC
    "spark":   "e96cbd55-a0a0-446a-89ba-ada6e2991d50",   # Spark Savings Avalanche USDC
}


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

    # Cache mainnet APYs for 5 minutes (DefiLlama updates ~every 10 min)
    _mainnet_cache: dict[str, Decimal] = {}
    _mainnet_cache_ts: float = 0.0
    MAINNET_CACHE_TTL = 300.0

    def __init__(self) -> None:
        self.settings = get_settings()

    async def _fetch_mainnet_apys(self) -> dict[str, Decimal]:
        """Fetch real mainnet APYs from DefiLlama for testnet decision-making."""
        now = time.time()
        if self._mainnet_cache and (now - self._mainnet_cache_ts) < self.MAINNET_CACHE_TTL:
            return self._mainnet_cache

        try:
            pool_ids = set(MAINNET_POOL_IDS.values())
            async with httpx.AsyncClient(timeout=15.0) as client:
                results: dict[str, Decimal] = {}
                for pid, pool_id in MAINNET_POOL_IDS.items():
                    try:
                        resp = await client.get(f"https://yields.llama.fi/chart/{pool_id}")
                        resp.raise_for_status()
                        data = resp.json()
                        points = data.get("data") or []
                        if points:
                            latest_apy = points[-1].get("apy", points[-1].get("apyBase", 0))
                            results[pid] = Decimal(str(latest_apy)) / Decimal("100")
                    except Exception as e:
                        logger.warning("DefiLlama mainnet fetch failed for %s: %s", pid, e)

                if results:
                    RateFetcher._mainnet_cache = results
                    RateFetcher._mainnet_cache_ts = now
                    logger.info(
                        "Mainnet APYs from DefiLlama: %s",
                        {k: f"{float(v)*100:.2f}%" for k, v in results.items()},
                    )
                return results
        except Exception as e:
            logger.warning("DefiLlama mainnet APY fetch failed: %s", e)
            return self._mainnet_cache  # Return stale cache on failure

    async def _overlay_mainnet_apys(
        self, results: dict[str, ProtocolRate]
    ) -> dict[str, ProtocolRate]:
        """On testnet, replace mock APYs with real mainnet APYs from DefiLlama."""
        if not self.settings.IS_TESTNET:
            return results

        mainnet_apys = await self._fetch_mainnet_apys()
        if not mainnet_apys:
            return results

        for pid, rate in results.items():
            if pid in mainnet_apys:
                logger.info(
                    "Testnet APY overlay: %s mock=%.2f%% → mainnet=%.2f%%",
                    pid, float(rate.apy * 100), float(mainnet_apys[pid] * 100),
                )
                results[pid] = ProtocolRate(
                    protocol_id=pid,
                    apy=mainnet_apys[pid],
                    tvl_usd=rate.tvl_usd,
                    utilization_rate=rate.utilization_rate,
                    fetched_at=rate.fetched_at,
                )
        return results

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

        # On testnet, overlay real mainnet APYs for realistic optimizer decisions
        results = await self._overlay_mainnet_apys(results)

        return results

    async def fetch_active_rates(self) -> dict[str, ProtocolRate]:
        """Fetch from ACTIVE adapters only (for waterfall input).

        Filters out protocols with TVL below MIN_PROTOCOL_TVL_USD to avoid
        illiquid or highly-utilized pools.
        """
        tasks = {}
        for pid, adapter in ACTIVE_ADAPTERS.items():
            if circuit_breaker.is_open(pid):
                continue
            tasks[pid] = adapter.get_rate()

        completed = await asyncio.gather(
            *tasks.values(), return_exceptions=True
        )

        min_tvl = Decimal(str(self.settings.MIN_PROTOCOL_TVL_USD))
        results: dict[str, ProtocolRate] = {}
        for pid, result in zip(tasks.keys(), completed):
            if isinstance(result, Exception):
                logger.warning("Rate fetch failed for %s: %s", pid, result)
                circuit_breaker.record_failure(pid)
            else:
                circuit_breaker.record_success(pid)
                twap_buffer.add(result)
                # Skip protocols with TVL below minimum (illiquid / high utilization)
                if result.tvl_usd > Decimal("0") and result.tvl_usd < min_tvl:
                    logger.warning(
                        "Skipping %s — TVL $%.0f below minimum $%.0f",
                        pid, float(result.tvl_usd), float(min_tvl),
                    )
                    continue
                results[pid] = result

        # On testnet, overlay real mainnet APYs for realistic optimizer decisions
        results = await self._overlay_mainnet_apys(results)

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
