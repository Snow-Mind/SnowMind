"""Unit tests for production rebalance interval safety guard."""

from app.core.config import Settings


def test_rebalance_interval_guard_clamps_in_production(monkeypatch) -> None:
    """Production cadence is fixed to hourly scheduler ticks."""
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("REBALANCE_CHECK_INTERVAL", "360")

    settings = Settings()

    assert settings.REBALANCE_CHECK_INTERVAL == 3_600


def test_rebalance_interval_guard_allows_debug_override(monkeypatch) -> None:
    """Debug environments may use shorter intervals for local development."""
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("REBALANCE_CHECK_INTERVAL", "360")

    settings = Settings()

    assert settings.REBALANCE_CHECK_INTERVAL == 360


def test_rebalance_interval_blank_string_falls_back_safely(monkeypatch) -> None:
    """Blank env strings should behave like unset and never crash startup."""
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("REBALANCE_CHECK_INTERVAL", "")

    settings = Settings()

    assert settings.REBALANCE_CHECK_INTERVAL == 3_600
