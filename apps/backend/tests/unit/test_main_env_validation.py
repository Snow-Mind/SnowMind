"""Unit tests for main.py environment validation."""

from unittest.mock import patch

import pytest


def test_validate_environment_requires_encryption_material_in_debug() -> None:
    """DEBUG mode must not bypass session-key encryption material checks."""
    from main import _validate_environment

    class _Settings:
        DEBUG = True
        SESSION_KEY_ENCRYPTION_KEY = ""
        KMS_KEY_ID = ""
        SUPABASE_URL = ""
        JWT_SECRET = "jwt"
        BACKEND_API_KEY = "api"
        PRIVY_APP_ID = "privy"
        INTERNAL_SERVICE_KEY = "internal"

    with patch("main.settings", _Settings()):
        with pytest.raises(SystemExit, match="Set KMS_KEY_ID or SESSION_KEY_ENCRYPTION_KEY"):
            _validate_environment()
