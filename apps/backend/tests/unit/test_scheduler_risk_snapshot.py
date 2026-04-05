from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.workers.scheduler import SnowMindScheduler


def _make_daily_risk_table(rows: list[dict]) -> MagicMock:
    table = MagicMock()
    table.select.return_value = table
    table.eq.return_value = table
    table.limit.return_value = table
    table.execute.return_value = SimpleNamespace(data=rows)
    return table


@pytest.mark.asyncio
async def test_seed_daily_risk_snapshot_runs_when_today_missing() -> None:
    scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
    scheduler.db = MagicMock()
    scheduler.db.table.return_value = _make_daily_risk_table([])
    scheduler._snapshot_daily_risk_scores = AsyncMock()

    await scheduler._seed_daily_risk_snapshot_if_needed()

    scheduler._snapshot_daily_risk_scores.assert_awaited_once()


@pytest.mark.asyncio
async def test_seed_daily_risk_snapshot_skips_when_today_exists() -> None:
    scheduler = SnowMindScheduler.__new__(SnowMindScheduler)
    scheduler.db = MagicMock()
    scheduler.db.table.return_value = _make_daily_risk_table([{"id": "row"}])
    scheduler._snapshot_daily_risk_scores = AsyncMock()

    await scheduler._seed_daily_risk_snapshot_if_needed()

    scheduler._snapshot_daily_risk_scores.assert_not_awaited()
