"""AES-256-GCM encrypted session key management.

SECURITY: Raw key material is NEVER logged. All functions that handle
plaintext keys are marked with the ``_sensitive`` suffix or explicitly
suppress logging output.
"""

import base64
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from supabase import Client

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

# 12 bytes recommended for AES-GCM nonce
_NONCE_BYTES = 12


def _get_aes_key() -> bytes:
    """Derive the 32-byte AES key from the hex-encoded env var."""
    raw = get_settings().SESSION_KEY_ENCRYPTION_KEY
    if not raw:
        raise RuntimeError("SESSION_KEY_ENCRYPTION_KEY is not configured")
    key = bytes.fromhex(raw)
    if len(key) != 32:
        raise ValueError("SESSION_KEY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)")
    return key


def encrypt_session_key(raw_key: str) -> str:
    """Encrypt *raw_key* with AES-256-GCM.

    Returns ``base64(nonce ‖ ciphertext ‖ tag)``.
    """
    key = _get_aes_key()
    nonce = os.urandom(_NONCE_BYTES)
    aes = AESGCM(key)
    ct = aes.encrypt(nonce, raw_key.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_session_key(encrypted: str) -> str:
    """Decrypt a value produced by :func:`encrypt_session_key`.

    Returns the raw key **in memory only** — callers must not log or persist
    the return value.
    """
    key = _get_aes_key()
    blob = base64.b64decode(encrypted)
    nonce = blob[:_NONCE_BYTES]
    ct = blob[_NONCE_BYTES:]
    aes = AESGCM(key)
    return aes.decrypt(nonce, ct, None).decode("utf-8")


def store_session_key(
    db: Client,
    account_id: UUID,
    session_key_data: dict,
) -> str:
    """Encrypt and persist a session key for *account_id*.

    ``session_key_data`` must contain at minimum:
      - ``raw_key``           (plaintext private key — will be encrypted)
      - ``key_address``       (the session key's own address)
      - ``expires_at``        (ISO-8601 timestamp)
      - ``allowed_protocols`` (list[str])
      - ``max_amount_per_tx`` (str, BigInt as string)

    Returns the UUID of the new ``session_keys`` row.
    """
    encrypted = encrypt_session_key(session_key_data["raw_key"])

    row = (
        db.table("session_keys")
        .insert(
            {
                "account_id": str(account_id),
                "serialized_permission": encrypted,
                "key_address": session_key_data["key_address"],
                "expires_at": session_key_data["expires_at"],
                "is_active": True,
                "allowed_protocols": session_key_data["allowed_protocols"],
                "max_amount_per_tx": session_key_data["max_amount_per_tx"],
            }
        )
        .execute()
    )
    new_id = row.data[0]["id"]
    logger.info("Session key stored for account %s (key_id=%s)", account_id, new_id)
    return new_id


def get_active_session_key(db: Client, account_id: UUID) -> str | None:
    """Fetch, decrypt, and return the active session key for *account_id*.

    Returns ``None`` when no active (and non-expired) key exists.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    result = (
        db.table("session_keys")
        .select("serialized_permission, expires_at")
        .eq("account_id", str(account_id))
        .eq("is_active", True)
        .gte("expires_at", now_iso)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None

    return decrypt_session_key(result.data[0]["serialized_permission"])


def revoke_session_key(db: Client, account_id: UUID) -> int:
    """Mark all active session keys for *account_id* as inactive.

    Returns the number of rows updated.
    """
    result = (
        db.table("session_keys")
        .update({"is_active": False})
        .eq("account_id", str(account_id))
        .eq("is_active", True)
        .execute()
    )
    count = len(result.data) if result.data else 0
    logger.info("Revoked %d session key(s) for account %s", count, account_id)
    return count


# ── Session-key monitoring ───────────────────────────────────────────────────

# Operational constants
_EXPIRY_WARNING_DAYS = 7
_MAX_OPERATIONS_PER_DAY = 50
_UNUSUAL_HOUR_START = 3  # UTC
_UNUSUAL_HOUR_END = 5    # UTC


async def check_expiring_keys(db: Client) -> list[str]:
    """Return account IDs whose session keys expire within 7 days.

    Intended for daily scheduler checks — post-MVP can trigger notifications.
    """
    now = datetime.now(timezone.utc)
    warning_cutoff = (now + timedelta(days=_EXPIRY_WARNING_DAYS)).isoformat()
    now_iso = now.isoformat()

    result = (
        db.table("session_keys")
        .select("account_id, expires_at")
        .eq("is_active", True)
        .gte("expires_at", now_iso)        # not yet expired
        .lte("expires_at", warning_cutoff)  # but expiring soon
        .execute()
    )

    account_ids = list({row["account_id"] for row in (result.data or [])})
    if account_ids:
        logger.warning(
            "%d account(s) have session keys expiring within %d days",
            len(account_ids),
            _EXPIRY_WARNING_DAYS,
        )
    return account_ids


async def log_key_usage(
    db: Client,
    account_id: str,
    operation: str,
    protocol_id: str,
    amount: Decimal,
) -> None:
    """Persist an audit entry for every session-key operation.

    Table: ``session_key_audit``
    (id, account_id, operation, protocol_id, amount, timestamp)
    """
    db.table("session_key_audit").insert(
        {
            "account_id": account_id,
            "operation": operation,
            "protocol_id": protocol_id,
            "amount": str(amount),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()


async def detect_unusual_activity(db: Client, account_id: str) -> bool:
    """Analyse the last 24 h of audit logs for anomalies.

    Flags:
    - More than ``_MAX_OPERATIONS_PER_DAY`` operations in 24 h.
    - Operations during ``03:00–05:00 UTC`` (low Avalanche activity).

    Returns ``True`` if an anomaly is detected (caller should alert).
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(hours=24)
    ).isoformat()

    result = (
        db.table("session_key_audit")
        .select("timestamp")
        .eq("account_id", account_id)
        .gte("timestamp", cutoff)
        .execute()
    )

    rows = result.data or []
    anomalies: list[str] = []

    # ── Volume check ─────────────────────────────────────────────────────
    if len(rows) > _MAX_OPERATIONS_PER_DAY:
        anomalies.append(
            f"High op volume: {len(rows)} in 24 h (max {_MAX_OPERATIONS_PER_DAY})"
        )

    # ── Unusual-hour check ───────────────────────────────────────────────
    for row in rows:
        ts = datetime.fromisoformat(row["timestamp"])
        if _UNUSUAL_HOUR_START <= ts.hour < _UNUSUAL_HOUR_END:
            anomalies.append(
                f"Operation at unusual hour: {ts.isoformat()}"
            )
            break  # one example is enough

    if anomalies:
        for msg in anomalies:
            logger.warning("Session-key anomaly [%s]: %s", account_id, msg)
        return True
    return False
