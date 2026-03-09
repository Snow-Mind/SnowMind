"""Supabase client initialisation and FastAPI dependency."""

import logging

from supabase import Client, create_client

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

_client: Client | None = None


def get_supabase() -> Client:
    """Singleton Supabase client.  Re-uses across requests."""
    global _client
    if _client is None:
        s = get_settings()
        if not s.SUPABASE_URL or not s.SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set"
            )
        _client = create_client(s.SUPABASE_URL, s.SUPABASE_SERVICE_KEY)
        logger.info("Supabase client initialised")
    return _client


def get_db() -> Client:
    """FastAPI dependency — yields the Supabase client."""
    return get_supabase()


def reset_client() -> None:
    """For testing — force fresh client on next call."""
    global _client
    _client = None
