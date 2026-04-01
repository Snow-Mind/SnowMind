"""Unit tests for production rebalance interval safety guard."""

from app.core.config import Settings


def test_rebalance_interval_guard_clamps_in_production(monkeypatch) -> None:
    """Non-debug environments must never run scheduler faster than 4 hours."""
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("REBALANCE_CHECK_INTERVAL", "360")

    settings = Settings()

    assert settings.REBALANCE_CHECK_INTERVAL == 14_400


def test_rebalance_interval_guard_allows_debug_override(monkeypatch) -> None:
    """Debug environments may use shorter intervals for local development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("REBALANCE_CHECK_INTERVAL", "360")

    settings = Settings()

    assert settings.REBALANCE_CHECK_INTERVAL == 360
