"""Observability bootstrap (Sentry, tracing) for SnowMind backend."""

import logging
import os

from app.core.config import get_settings

logger = logging.getLogger("snowmind.observability")

_sentry_initialized = False


def _clamp_rate(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def init_sentry() -> bool:
    """Initialize Sentry SDK once when DSN is configured.

    Returns True when Sentry is active, False when disabled or init failed.
    """
    global _sentry_initialized

    if _sentry_initialized:
        return True

    settings = get_settings()
    dsn = (settings.SENTRY_DSN or "").strip()
    if not dsn:
        logger.info("Sentry disabled: SENTRY_DSN is not configured")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.asyncio import AsyncioIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        environment = (
            (settings.SENTRY_ENVIRONMENT or "").strip()
            or ("development" if settings.DEBUG else "production")
        )
        release = (
            os.getenv("RAILWAY_GIT_COMMIT_SHA")
            or os.getenv("GITHUB_SHA")
            or os.getenv("RELEASE_SHA")
            or None
        )

        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=release,
            integrations=[
                FastApiIntegration(transaction_style="endpoint"),
                AsyncioIntegration(),
            ],
            traces_sample_rate=_clamp_rate(settings.SENTRY_TRACES_SAMPLE_RATE),
            profiles_sample_rate=_clamp_rate(settings.SENTRY_PROFILES_SAMPLE_RATE),
            send_default_pii=bool(settings.SENTRY_SEND_PII),
            max_breadcrumbs=100,
        )
        _sentry_initialized = True
        logger.info(
            "Sentry initialized [environment=%s, traces_sample_rate=%.3f]",
            environment,
            _clamp_rate(settings.SENTRY_TRACES_SAMPLE_RATE),
        )
        return True
    except ImportError as exc:
        logger.warning("Sentry SDK not installed; observability disabled: %s", exc)
        return False
    except Exception as exc:
        logger.warning("Failed to initialize Sentry: %s", exc)
        return False
