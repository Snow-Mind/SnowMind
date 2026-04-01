"""Unit tests for scheduler watchdog stale-threshold behavior."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.monitoring import SchedulerWatchdog


@pytest.mark.asyncio
async def test_watchdog_does_not_alert_within_interval_plus_grace(monkeypatch) -> None:
    watchdog = SchedulerWatchdog()
    base_time = 1_000_000.0
    watchdog._last_healthy_tick = base_time

    settings = SimpleNamespace(
        REBALANCE_CHECK_INTERVAL=14_400,
        SCHEDULER_LOCK_TTL_MINUTES=35,
    )

    send_telegram = AsyncMock(return_value=True)
    send_sentry = MagicMock()

    monkeypatch.setattr("app.services.monitoring.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.monitoring.send_telegram_alert", send_telegram)
    monkeypatch.setattr("app.services.monitoring.send_sentry_alert", send_sentry)
    monkeypatch.setattr("app.services.monitoring.time.time", lambda: base_time + (239 * 60))

    healthy = await watchdog.check()

    assert healthy is True
    send_telegram.assert_not_called()
    send_sentry.assert_not_called()


@pytest.mark.asyncio
async def test_watchdog_alerts_when_gap_exceeds_interval_plus_grace(monkeypatch) -> None:
    watchdog = SchedulerWatchdog()
    base_time = 2_000_000.0
    watchdog._last_healthy_tick = base_time

    settings = SimpleNamespace(
        REBALANCE_CHECK_INTERVAL=14_400,
        SCHEDULER_LOCK_TTL_MINUTES=35,
    )

    send_telegram = AsyncMock(return_value=True)
    send_sentry = MagicMock()

    monkeypatch.setattr("app.services.monitoring.get_settings", lambda: settings)
    monkeypatch.setattr("app.services.monitoring.send_telegram_alert", send_telegram)
    monkeypatch.setattr("app.services.monitoring.send_sentry_alert", send_sentry)

    threshold = settings.REBALANCE_CHECK_INTERVAL + (settings.SCHEDULER_LOCK_TTL_MINUTES * 60)
    monkeypatch.setattr("app.services.monitoring.time.time", lambda: base_time + threshold + 1)

    healthy = await watchdog.check()

    assert healthy is False
    send_telegram.assert_called_once()
    send_sentry.assert_called_once()
