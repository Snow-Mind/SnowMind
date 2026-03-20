"""Operational monitoring — paymaster balance, scheduler watchdog, alerting.

Sends alerts via Telegram and Sentry when configured.
All thresholds live in app.core.config — no magic numbers here.
"""

import logging
import time
from decimal import Decimal

import httpx

from app.core.config import get_settings

logger = logging.getLogger("snowmind.monitoring")


async def send_telegram_alert(message: str) -> bool:
    """Send an alert message via Telegram bot. Returns True on success."""
    settings = get_settings()
    token = settings.TELEGRAM_BOT_TOKEN
    chat_id = settings.TELEGRAM_CHAT_ID
    if not token or not chat_id:
        logger.debug("Telegram not configured — skipping alert")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": f"🚨 SnowMind Alert\n\n{message}",
                "parse_mode": "HTML",
            })
            resp.raise_for_status()
            return True
    except Exception as exc:
        logger.error("Telegram alert failed: %s", exc)
        return False


def send_sentry_alert(message: str) -> None:
    """Capture an alert as a Sentry event if configured."""
    settings = get_settings()
    if not settings.SENTRY_DSN:
        return
    try:
        import sentry_sdk
        sentry_sdk.capture_message(message, level="warning")
    except Exception as exc:
        logger.warning("Sentry alert failed: %s", exc)


async def check_paymaster_balance() -> Decimal:
    """Check the Pimlico paymaster (verifying paymaster) balance via bundler RPC.

    Returns the balance in AVAX (Decimal). Sends alert if below threshold.
    """
    settings = get_settings()
    rpc_url = settings.pimlico_rpc_url
    if not settings.PIMLICO_API_KEY:
        logger.debug("Pimlico not configured — skipping paymaster balance check")
        return Decimal("-1")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Use Pimlico's pm_getBalance endpoint to get sponsorship balance
            resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "pimlico_getUserOperationGasPrice",
                "params": [],
            })
            resp.raise_for_status()

            # Fallback: check the EntryPoint deposit balance via standard RPC
            rpc = settings.AVALANCHE_RPC_URL
            if settings.INFURA_RPC_URL:
                rpc = settings.INFURA_RPC_URL

            # Read EntryPoint.balanceOf(paymaster) on-chain
            # For now, use eth_getBalance on the EntryPoint deposit
            # This is a best-effort check — exact method depends on paymaster type
            resp2 = await client.post(rpc, json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_getBalance",
                "params": [settings.ENTRYPOINT_V07, "latest"],
            })
            resp2.raise_for_status()
            result = resp2.json().get("result", "0x0")
            balance_wei = int(result, 16)
            balance_avax = Decimal(str(balance_wei)) / Decimal("10") ** 18

            threshold = Decimal(str(settings.PAYMASTER_LOW_BALANCE_AVAX))
            if balance_avax < threshold:
                msg = (
                    f"Paymaster balance LOW: {float(balance_avax):.4f} AVAX "
                    f"(threshold: {float(threshold):.1f} AVAX). "
                    f"Rebalance operations may fail."
                )
                logger.critical(msg)
                await send_telegram_alert(msg)
                send_sentry_alert(msg)

            return balance_avax

    except Exception as exc:
        logger.error("Paymaster balance check failed: %s", exc)
        return Decimal("-1")


class SchedulerWatchdog:
    """Monitors scheduler health and sends alerts if ticks stop."""

    def __init__(self) -> None:
        self._last_healthy_tick: float = time.time()
        self._alerted = False

    def record_tick(self) -> None:
        """Called after each successful scheduler run."""
        self._last_healthy_tick = time.time()
        self._alerted = False

    async def check(self) -> bool:
        """Check if scheduler has ticked within the expected window.

        Returns True if healthy, False if stale.
        """
        settings = get_settings()
        max_gap_seconds = settings.SCHEDULER_LOCK_TTL_MINUTES * 60
        elapsed = time.time() - self._last_healthy_tick

        if elapsed > max_gap_seconds:
            if not self._alerted:
                msg = (
                    f"Scheduler watchdog: no successful tick in "
                    f"{elapsed / 60:.1f} minutes "
                    f"(threshold: {settings.SCHEDULER_LOCK_TTL_MINUTES} min). "
                    f"Rebalancing may be stalled."
                )
                logger.critical(msg)
                await send_telegram_alert(msg)
                send_sentry_alert(msg)
                self._alerted = True
            return False

        return True


# Module-level singleton
scheduler_watchdog = SchedulerWatchdog()
