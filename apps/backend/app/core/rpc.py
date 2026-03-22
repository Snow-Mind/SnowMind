"""
Multi-provider RPC client with 3-tier fallback and exponential backoff.

Provider priority:
  1. Infura Avalanche (primary)
  2. Alchemy Avalanche (fallback — auto-switch on 3 consecutive failures)
  3. Public Avalanche RPC (emergency — last resort)

All RPC calls should go through `get_web3()` which returns a healthy Web3 instance.
The provider rotation is transparent to callers.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from web3 import AsyncWeb3
from web3.providers import AsyncHTTPProvider

from app.core.config import get_settings

logger = logging.getLogger("snowmind.rpc")

# ── Constants ────────────────────────────────────────────────────────────────

MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 0.5
MAX_BACKOFF_SECONDS = 8.0
CONSECUTIVE_FAILURES_FOR_ROTATION = 3
HEALTH_CHECK_INTERVAL_SECONDS = 60
PUBLIC_AVALANCHE_RPC = "https://api.avax.network/ext/bc/C/rpc"
RATE_LIMIT_COOLDOWN_SECONDS = 60  # Re-enable rate-limited providers after cooldown


class ProviderTier(Enum):
    """RPC provider priority tiers."""
    PRIMARY = "primary"      # Infura
    FALLBACK = "fallback"    # Alchemy
    EMERGENCY = "emergency"  # Public RPC


@dataclass
class ProviderHealth:
    """Tracks health metrics for a single RPC provider."""
    url: str
    tier: ProviderTier
    consecutive_failures: int = 0
    total_requests: int = 0
    total_failures: int = 0
    last_failure_at: float = 0.0
    last_success_at: float = 0.0
    is_available: bool = True

    def record_success(self) -> None:
        """Record a successful RPC call. Resets consecutive failure counter."""
        self.consecutive_failures = 0
        self.total_requests += 1
        self.last_success_at = time.time()
        self.is_available = True

    def record_failure(self) -> None:
        """Record a failed RPC call. May trigger provider rotation."""
        self.consecutive_failures += 1
        self.total_failures += 1
        self.total_requests += 1
        self.last_failure_at = time.time()
        if self.consecutive_failures >= CONSECUTIVE_FAILURES_FOR_ROTATION:
            self.is_available = False
            logger.warning(
                "RPC provider %s marked unavailable after %d consecutive failures",
                self.tier.value,
                self.consecutive_failures,
            )


class RPCManager:
    """
    Manages a 3-tier RPC provider pool with automatic failover.

    Usage:
        rpc = get_rpc_manager()
        w3 = rpc.get_web3()  # Returns Web3 instance connected to healthiest provider
        result = await rpc.call_with_fallback(some_contract_call)
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._providers: list[ProviderHealth] = []
        self._web3_instances: dict[str, AsyncWeb3] = {}
        self._active_provider_url: str = ""
        self._lock = asyncio.Lock()

        # Build provider list in priority order
        # Tier 1: Infura (primary)
        if settings.INFURA_RPC_URL:
            self._providers.append(ProviderHealth(
                url=settings.INFURA_RPC_URL,
                tier=ProviderTier.PRIMARY,
            ))

        # Tier 2: Alchemy (fallback)
        if settings.ALCHEMY_RPC_URL:
            self._providers.append(ProviderHealth(
                url=settings.ALCHEMY_RPC_URL,
                tier=ProviderTier.FALLBACK,
            ))

        # Tier 3: Public Avalanche RPC (emergency / always available)
        public_url = settings.AVALANCHE_RPC_URL or PUBLIC_AVALANCHE_RPC
        self._providers.append(ProviderHealth(
            url=public_url,
            tier=ProviderTier.EMERGENCY,
        ))

        if not self._providers:
            raise RuntimeError("No RPC providers configured")

        # Set initial active provider
        self._active_provider_url = self._providers[0].url
        logger.info(
            "RPC manager initialized with %d providers. Active: %s",
            len(self._providers),
            self._providers[0].tier.value,
        )

    def _get_or_create_web3(self, url: str) -> AsyncWeb3:
        """Get or create an AsyncWeb3 instance for a given URL."""
        if url not in self._web3_instances:
            provider = AsyncHTTPProvider(
                url,
                request_kwargs={"timeout": 15},
            )
            self._web3_instances[url] = AsyncWeb3(provider)
        return self._web3_instances[url]

    def _get_active_provider(self) -> ProviderHealth:
        """Get the currently active provider health record."""
        for p in self._providers:
            if p.url == self._active_provider_url:
                return p
        return self._providers[0]

    def _get_next_available_provider(self) -> ProviderHealth | None:
        """Find the next available provider in priority order.

        Re-enables providers that were rate-limited after a cooldown period.
        """
        now = time.time()
        for p in self._providers:
            # Re-enable providers after cooldown (e.g. 429 rate-limit recovery)
            if not p.is_available and p.last_failure_at > 0:
                if now - p.last_failure_at > RATE_LIMIT_COOLDOWN_SECONDS:
                    p.is_available = True
                    p.consecutive_failures = 0
                    logger.info(
                        "RPC provider %s re-enabled after cooldown",
                        p.tier.value,
                    )

        for p in self._providers:
            if p.is_available and p.url != self._active_provider_url:
                return p
        # If all are unavailable, try emergency as last resort
        for p in self._providers:
            if p.tier == ProviderTier.EMERGENCY:
                p.is_available = True  # Always allow emergency
                return p
        return None

    def _rotate_provider(self) -> bool:
        """
        Rotate to the next available provider.

        Returns True if rotation succeeded, False if no alternatives.
        """
        next_provider = self._get_next_available_provider()
        if next_provider is None:
            logger.error("All RPC providers exhausted — no rotation possible")
            return False

        old_tier = self._get_active_provider().tier.value
        self._active_provider_url = next_provider.url
        logger.warning(
            "RPC provider rotated: %s → %s",
            old_tier,
            next_provider.tier.value,
        )
        return True

    def get_web3(self) -> AsyncWeb3:
        """
        Get an AsyncWeb3 instance connected to the healthiest available provider.

        This is the primary interface for callers. The returned Web3 instance
        is connected to whichever provider is currently active.  If the active
        provider has been marked unavailable (e.g. by report_rate_limit()),
        this automatically rotates to the next healthy provider.
        """
        active = self._get_active_provider()
        if not active.is_available:
            next_p = self._get_next_available_provider()
            if next_p:
                self._active_provider_url = next_p.url
                logger.info(
                    "get_web3() auto-rotated from unavailable %s to %s",
                    active.tier.value,
                    next_p.tier.value,
                )
        return self._get_or_create_web3(self._active_provider_url)

    def get_active_tier(self) -> ProviderTier:
        """Return the tier of the currently active provider."""
        return self._get_active_provider().tier

    def report_rate_limit(self) -> None:
        """Report a 429 rate-limit error from a direct web3 call.

        Protocol adapters and route handlers call this when they detect a 429
        from contract calls that bypass ``call_with_fallback()``.  Marks the
        active provider unavailable and rotates to the next healthy one.
        """
        active = self._get_active_provider()
        if not active.is_available:
            return  # already handled
        active.record_failure()
        active.is_available = False
        logger.warning(
            "429 rate-limit reported for %s — marking unavailable and rotating",
            active.tier.value,
        )
        self._rotate_provider()

    async def call_with_fallback(
        self,
        call_fn: Any,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """
        Execute an async RPC call with exponential backoff and provider rotation.

        If the active provider fails MAX_RETRIES times, rotates to the next
        available provider and retries. This is transparent to the caller.

        Args:
            call_fn: An async callable that performs the RPC operation.
            *args, **kwargs: Arguments passed to call_fn.

        Returns:
            The result of the successful call.

        Raises:
            Exception: If all providers and retries are exhausted.
        """
        last_exception: Exception | None = None
        providers_tried = 0
        max_provider_attempts = len(self._providers)

        while providers_tried < max_provider_attempts:
            active = self._get_active_provider()
            backoff = INITIAL_BACKOFF_SECONDS

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    result = await call_fn(*args, **kwargs)
                    active.record_success()
                    return result
                except Exception as e:
                    active.record_failure()
                    last_exception = e
                    err_str = str(e)[:200]
                    logger.warning(
                        "RPC call failed (provider=%s, attempt=%d/%d): %s",
                        active.tier.value,
                        attempt,
                        MAX_RETRIES,
                        err_str,
                    )

                    # Immediate rotation on rate-limit (429) — don't waste retries
                    if "429" in err_str or "Too Many Requests" in err_str:
                        logger.warning(
                            "Rate-limited (429) on provider %s — rotating immediately",
                            active.tier.value,
                        )
                        active.is_available = False
                        break

                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(min(backoff, MAX_BACKOFF_SECONDS))
                        backoff *= 2

            # All retries exhausted for this provider — rotate
            logger.error(
                "All %d retries exhausted for provider %s. Rotating.",
                MAX_RETRIES,
                active.tier.value,
            )
            if not self._rotate_provider():
                break
            providers_tried += 1

        raise RuntimeError(
            f"All RPC providers exhausted after {providers_tried + 1} provider attempts. "
            f"Last error: {last_exception}"
        )

    async def check_health(self) -> dict[str, Any]:
        """
        Check health of all configured providers.

        Returns a dict with status of each provider for monitoring/alerting.
        """
        results: dict[str, Any] = {}
        for p in self._providers:
            w3 = self._get_or_create_web3(p.url)
            try:
                block = await w3.eth.block_number
                p.record_success()
                results[p.tier.value] = {
                    "status": "healthy",
                    "block_number": block,
                    "consecutive_failures": 0,
                }
            except Exception as e:
                p.record_failure()
                results[p.tier.value] = {
                    "status": "unhealthy",
                    "error": str(e)[:200],
                    "consecutive_failures": p.consecutive_failures,
                }

        results["active_provider"] = self._get_active_provider().tier.value
        return results

    def reset_all_providers(self) -> None:
        """Reset all providers to available state. For recovery after outages."""
        for p in self._providers:
            p.consecutive_failures = 0
            p.is_available = True
        self._active_provider_url = self._providers[0].url
        logger.info("All RPC providers reset to available state")

    def get_provider_stats(self) -> list[dict[str, Any]]:
        """Return stats for all providers. Used by health endpoint."""
        return [
            {
                "tier": p.tier.value,
                "is_available": p.is_available,
                "consecutive_failures": p.consecutive_failures,
                "total_requests": p.total_requests,
                "total_failures": p.total_failures,
                "last_failure_at": p.last_failure_at,
                "last_success_at": p.last_success_at,
            }
            for p in self._providers
        ]


# ── Module-level singleton ───────────────────────────────────────────────────

_rpc_manager: RPCManager | None = None


def get_rpc_manager() -> RPCManager:
    """Get or create the global RPCManager singleton."""
    global _rpc_manager
    if _rpc_manager is None:
        _rpc_manager = RPCManager()
    return _rpc_manager


def get_web3() -> AsyncWeb3:
    """Convenience function — returns the active Web3 instance."""
    return get_rpc_manager().get_web3()


def reset_rpc_manager() -> None:
    """For testing — force fresh RPCManager on next call."""
    global _rpc_manager
    _rpc_manager = None
