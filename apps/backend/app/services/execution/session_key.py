"""AES-256-GCM encrypted session key management.

SECURITY: Raw key material is NEVER logged. All functions that handle
plaintext keys are marked with the ``_sensitive`` suffix or explicitly
suppress logging output.
"""

import base64
import json
import logging
import os
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import TypedDict
from uuid import UUID

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from supabase import Client

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

# 12 bytes recommended for AES-GCM nonce
_NONCE_BYTES = 12
_KMS_ENVELOPE_PREFIX = "kms:v1:"


class ActiveSessionKey(TypedDict):
    serialized_permission: str
    allowed_protocols: list[str]


def _kms_key_id_or_none() -> str | None:
    """Return a usable KMS key id, or ``None`` when not configured."""
    key_id = getattr(get_settings(), "KMS_KEY_ID", None)
    if isinstance(key_id, str):
        key_id = key_id.strip()
        return key_id or None
    return None


@lru_cache
def _get_kms_client():
    """Create and cache an AWS KMS client."""
    key_id = _kms_key_id_or_none()
    if not key_id:
        raise RuntimeError("KMS_KEY_ID must be configured for session key encryption")
    region = (
        os.getenv("AWS_REGION")
        or os.getenv("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    return boto3.client("kms", region_name=region)


def _get_legacy_aes_key() -> bytes:
    """Backward-compatible env-key path for local tests/dev."""
    raw = get_settings().SESSION_KEY_ENCRYPTION_KEY
    if not raw:
        raise RuntimeError("SESSION_KEY_ENCRYPTION_KEY is not configured")
    key = bytes.fromhex(raw)
    if len(key) != 32:
        raise ValueError("SESSION_KEY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)")
    return key


def _encode_envelope(ciphertext: bytes, nonce: bytes, encrypted_data_key: bytes) -> str:
    payload = {
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "encrypted_data_key": base64.b64encode(encrypted_data_key).decode("ascii"),
    }
    packed = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return _KMS_ENVELOPE_PREFIX + base64.b64encode(packed).decode("ascii")


def _decode_envelope(encrypted: str) -> tuple[bytes, bytes, bytes]:
    if not encrypted.startswith(_KMS_ENVELOPE_PREFIX):
        raise ValueError(
            "Unsupported session key envelope format. Expected KMS envelope payload."
        )
    payload_b64 = encrypted[len(_KMS_ENVELOPE_PREFIX):]
    payload_raw = base64.b64decode(payload_b64)
    payload = json.loads(payload_raw.decode("utf-8"))
    return (
        base64.b64decode(payload["ciphertext"]),
        base64.b64decode(payload["nonce"]),
        base64.b64decode(payload["encrypted_data_key"]),
    )


def encrypt_session_key(raw_key: str) -> str:
    """Encrypt *raw_key* using AWS KMS envelope encryption.

    Process:
      1) KMS generates an ephemeral AES-256 data key.
      2) AES-GCM encrypts the serialized permission with that data key.
      3) Store ciphertext + nonce + KMS-encrypted data key.

    Returns a compact versioned envelope string.
    """
    key_id = _kms_key_id_or_none()
    if not key_id:
        # Backward-compat fallback for tests/local runs.
        key = _get_legacy_aes_key()
        nonce = os.urandom(_NONCE_BYTES)
        aes = AESGCM(key)
        ct = aes.encrypt(nonce, raw_key.encode("utf-8"), None)
        return base64.b64encode(nonce + ct).decode("ascii")

    kms = _get_kms_client()
    data_key = kms.generate_data_key(KeyId=key_id, KeySpec="AES_256")
    plaintext_key = data_key["Plaintext"]
    encrypted_data_key = data_key["CiphertextBlob"]

    nonce = os.urandom(_NONCE_BYTES)
    aes = AESGCM(plaintext_key)
    ciphertext = aes.encrypt(nonce, raw_key.encode("utf-8"), None)

    # Best-effort cleanup of plaintext data key from local scope.
    del plaintext_key

    return _encode_envelope(ciphertext, nonce, encrypted_data_key)


def decrypt_session_key(encrypted: str) -> str:
    """Decrypt a value produced by :func:`encrypt_session_key`.

    Returns the raw key **in memory only** — callers must not log or persist
    the return value.
    """
    if not encrypted.startswith(_KMS_ENVELOPE_PREFIX):
        key = _get_legacy_aes_key()
        blob = base64.b64decode(encrypted)
        nonce = blob[:_NONCE_BYTES]
        ct = blob[_NONCE_BYTES:]
        aes = AESGCM(key)
        return aes.decrypt(nonce, ct, None).decode("utf-8")

    ciphertext, nonce, encrypted_data_key = _decode_envelope(encrypted)

    kms = _get_kms_client()
    resp = kms.decrypt(CiphertextBlob=encrypted_data_key)
    plaintext_key = resp["Plaintext"]

    aes = AESGCM(plaintext_key)
    raw = aes.decrypt(nonce, ciphertext, None).decode("utf-8")
    del plaintext_key
    return raw


def store_session_key(
    db: Client,
    account_id: UUID,
    session_key_data: dict,
) -> str:
    """Encrypt and persist a session key for *account_id*.

    ``session_key_data`` must contain at minimum:
      - ``serializedPermission`` or ``raw_key`` (ZeroDev serialized permission — will be encrypted)
      - ``sessionKeyAddress`` or ``key_address`` (the session key's own address)
      - ``expiresAt`` or ``expires_at``  (ISO-8601 timestamp or unix epoch)

    Returns the UUID of the new ``session_keys`` row.
    """
    # Accept both frontend camelCase and direct snake_case fields
    raw_key = (
        session_key_data.get("serializedPermission")
        or session_key_data.get("raw_key")
        or ""
    )
    if not raw_key:
        raise ValueError("session_key_data must contain 'serializedPermission' or 'raw_key'")

    key_address = (
        session_key_data.get("sessionKeyAddress")
        or session_key_data.get("key_address")
        or ""
    )

    # Handle expiresAt as either ISO string or unix timestamp
    expires_raw = session_key_data.get("expiresAt") or session_key_data.get("expires_at")
    if isinstance(expires_raw, (int, float)):
        from datetime import datetime, timezone
        expires_at = datetime.fromtimestamp(expires_raw, tz=timezone.utc).isoformat()
    else:
        expires_at = str(expires_raw) if expires_raw else None

    encrypted = encrypt_session_key(raw_key)

    row = (
        db.table("session_keys")
        .insert(
            {
                "account_id": str(account_id),
                "serialized_permission": encrypted,
                "key_address": key_address,
                "expires_at": expires_at,
                "is_active": True,
                "allowed_protocols": session_key_data.get("allowed_protocols")
                    or session_key_data.get("allowedProtocols")
                    or ["aave", "benqi", "spark"],
                "max_amount_per_tx": session_key_data.get("max_amount_per_tx", "0"),
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
    record = get_active_session_key_record(db, account_id)
    if not record:
        return None
    return record["serialized_permission"]


def get_active_session_key_record(db: Client, account_id: UUID) -> ActiveSessionKey | None:
    """Fetch active session key plus protocol scope metadata.

    Returns ``None`` when no active (and non-expired) key exists.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    result = (
        db.table("session_keys")
        .select("serialized_permission, expires_at, allowed_protocols")
        .eq("account_id", str(account_id))
        .eq("is_active", True)
        .gte("expires_at", now_iso)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None

    row = result.data[0]
    raw_allowed = row.get("allowed_protocols")
    allowed_protocols = (
        [str(p) for p in raw_allowed]
        if isinstance(raw_allowed, list) and raw_allowed
        else ["aave", "benqi", "spark"]
    )

    return {
        "serialized_permission": decrypt_session_key(row["serialized_permission"]),
        "allowed_protocols": allowed_protocols,
    }


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
