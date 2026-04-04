"""AES-256-GCM encrypted session key management.

SECURITY: Raw key material is NEVER logged. All functions that handle
plaintext keys are marked with the ``_sensitive`` suffix or explicitly
suppress logging output.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
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
    key_id: str
    key_address: str | None
    expires_at: str | None
    created_at: str | None
    serialized_permission: str
    session_private_key: str
    allowed_protocols: list[str]
    allocation_caps: dict[str, int] | None
    max_amount_per_tx: str


_DEFAULT_ALLOWED_PROTOCOLS = [
    "aave_v3",
    "benqi",
    "spark",
    "euler_v2",
    "silo_savusd_usdc",
    "silo_susdp_usdc",
]


def _normalize_allocation_caps(raw_caps: object) -> dict[str, int] | None:
    if not isinstance(raw_caps, dict):
        return None

    normalized: dict[str, int] = {}
    for raw_pid, raw_value in raw_caps.items():
        pid = str(raw_pid).strip().lower()
        if pid == "aave":
            pid = "aave_v3"
        if pid not in _DEFAULT_ALLOWED_PROTOCOLS:
            continue

        if isinstance(raw_value, bool):
            continue

        parsed: int | None = None
        if isinstance(raw_value, int):
            parsed = raw_value
        elif isinstance(raw_value, float) and raw_value.is_integer():
            parsed = int(raw_value)
        elif isinstance(raw_value, str):
            stripped = raw_value.strip()
            if stripped.isdigit() or (stripped.startswith("-") and stripped[1:].isdigit()):
                parsed = int(stripped)

        if parsed is None or parsed < 0 or parsed > 100:
            continue
        normalized[pid] = parsed

    return normalized or None


def _kms_key_id_or_none() -> str | None:
    """Return a usable KMS key id, or ``None`` when not configured."""
    key_id = getattr(get_settings(), "KMS_KEY_ID", None)
    if isinstance(key_id, str):
        key_id = key_id.strip()
        return key_id or None
    return None


_NUMERIC_RE = re.compile(r"^\d+(?:\.\d+)?$")


def _parse_session_key_expiry(expires_raw: object) -> datetime | None:
    """Parse heterogeneous expiry formats into timezone-aware UTC datetimes."""
    if expires_raw is None:
        return None

    try:
        if isinstance(expires_raw, (int, float)):
            ts = float(expires_raw)
            # Treat millisecond unix timestamps defensively.
            if ts > 1e11:
                ts /= 1000.0
            return datetime.fromtimestamp(ts, tz=timezone.utc)

        raw = str(expires_raw).strip()
        if not raw:
            return None

        if _NUMERIC_RE.match(raw):
            ts = float(raw)
            if ts > 1e11:
                ts /= 1000.0
            return datetime.fromtimestamp(ts, tz=timezone.utc)

        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"

        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def is_session_key_expiry_valid(expires_raw: object, now: datetime | None = None) -> bool:
    """Return True when *expires_raw* parses and is not expired."""
    expiry = _parse_session_key_expiry(expires_raw)
    if expiry is None:
        return False
    if now is None:
        now = datetime.now(timezone.utc)
    return expiry >= now


def _select_latest_active_key_row(db: Client, account_id: UUID) -> dict | None:
    """Return the newest non-expired active session-key row for an account."""
    now = datetime.now(timezone.utc)
    try:
        rows = (
            db.table("session_keys")
            .select(
                "id, key_address, serialized_permission, expires_at, allowed_protocols, "
                "allocation_caps, max_amount_per_tx, created_at"
            )
            .eq("account_id", str(account_id))
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
    except Exception as exc:
        # Backward-compatible fallback during rolling deploys before migration.
        if "allocation_caps" not in str(exc).lower():
            raise
        rows = (
            db.table("session_keys")
            .select(
                "id, key_address, serialized_permission, expires_at, allowed_protocols, "
                "max_amount_per_tx, created_at"
            )
            .eq("account_id", str(account_id))
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )

    if not rows.data:
        return None

    for row in rows.data:
        if is_session_key_expiry_valid(row.get("expires_at"), now):
            return row

    latest = rows.data[0]
    logger.warning(
        "No non-expired active session key for %s. Latest active key expires_at=%s",
        account_id,
        latest.get("expires_at"),
    )
    return None


@lru_cache
def _get_kms_client():
    """Create and cache an AWS KMS client.

    Returns the client object; callers must handle authentication errors
    at call-time (e.g. ``NoCredentialsError`` from ``generate_data_key``).
    """
    region = (
        os.getenv("AWS_REGION")
        or os.getenv("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    return boto3.client("kms", region_name=region)


def _get_legacy_aes_key() -> bytes:
    """Return the 32-byte AES-256 key for local session-key encryption.

    Priority:
      1. ``SESSION_KEY_ENCRYPTION_KEY`` env var (64 hex chars → 32 bytes).
      2. Auto-derived from ``SUPABASE_SERVICE_KEY`` via HMAC-SHA256 so
         Railway deploys that forget to set the dedicated env var still
         have a stable, deterministic encryption key.
      3. RuntimeError if neither is available.
    """
    settings = get_settings()
    raw = settings.SESSION_KEY_ENCRYPTION_KEY
    if raw:
        key = bytes.fromhex(raw)
        if len(key) != 32:
            raise ValueError("SESSION_KEY_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)")
        return key

    # Auto-derive from SUPABASE_SERVICE_KEY — deterministic, stable across restarts
    supabase_key = settings.SUPABASE_SERVICE_KEY
    if supabase_key:
        if not settings.DEBUG:
            raise RuntimeError(
                "SESSION_KEY_ENCRYPTION_KEY must be set when KMS_KEY_ID is not configured"
            )

        derived = hmac.new(
            key=supabase_key.encode("utf-8"),
            msg=b"snowmind-session-key-encryption-v1",
            digestmod=hashlib.sha256,
        ).digest()
        if not getattr(_get_legacy_aes_key, "_warned", False):
            logger.warning(
                "SESSION_KEY_ENCRYPTION_KEY not set — auto-derived from SUPABASE_SERVICE_KEY. "
                "Set SESSION_KEY_ENCRYPTION_KEY in production for explicit control."
            )
            _get_legacy_aes_key._warned = True  # type: ignore[attr-defined]
        return derived  # 32 bytes from SHA-256

    raise RuntimeError(
        "Neither SESSION_KEY_ENCRYPTION_KEY nor SUPABASE_SERVICE_KEY is configured. "
        "Cannot encrypt session keys."
    )


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


def _encrypt_local_aes(raw_key: str) -> str:
    """Encrypt using local AES-256-GCM with SESSION_KEY_ENCRYPTION_KEY."""
    key = _get_legacy_aes_key()
    nonce = os.urandom(_NONCE_BYTES)
    aes = AESGCM(key)
    ct = aes.encrypt(nonce, raw_key.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def encrypt_session_key(raw_key: str) -> str:
    """Encrypt *raw_key* using AWS KMS envelope encryption with local fallback.

    Strategy:
      1) If KMS_KEY_ID is configured, attempt KMS envelope encryption.
      2) If KMS fails (missing credentials, network, etc.), fall back to
         local AES-256-GCM using SESSION_KEY_ENCRYPTION_KEY.
      3) If KMS_KEY_ID is NOT set, use local AES directly.

    Returns a compact versioned envelope string (KMS) or base64 blob (local).
    """
    key_id = _kms_key_id_or_none()
    if not key_id:
        return _encrypt_local_aes(raw_key)

    try:
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
    except Exception as exc:
        if not get_settings().DEBUG:
            logger.error(
                "KMS envelope encryption failed in non-debug mode (%s): %s",
                type(exc).__name__,
                exc,
            )
            raise RuntimeError(
                "KMS session-key encryption failed; refusing insecure fallback"
            ) from exc

        logger.warning(
            "KMS envelope encryption failed (%s), falling back to local AES: %s",
            type(exc).__name__,
            exc,
        )
        return _encrypt_local_aes(raw_key)


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
    *,
    force: bool = False,
) -> str:
    """Encrypt and persist a session key for *account_id*.

    ``session_key_data`` must contain at minimum:
      - ``serializedPermission`` or ``raw_key`` (ZeroDev serialized permission — will be encrypted)
      - ``sessionKeyAddress`` or ``key_address`` (the session key's own address)
      - ``expiresAt`` or ``expires_at``  (ISO-8601 timestamp or unix epoch)

    Renewal guard: rejects the request if the current active key still has
    more than 24 hours until expiry to prevent unnecessary key churn.
    If the incoming key address differs from the currently active key address,
    treat it as an explicit re-grant and bypass the renewal guard.
    Pass ``force=True`` to always bypass the guard.

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

    # Session private key — required for correct ZeroDev deserialization.
    # Stored alongside the approval in an encrypted JSON envelope.
    session_private_key = (
        session_key_data.get("sessionPrivateKey")
        or session_key_data.get("session_private_key")
        or ""
    )

    # Build JSON envelope containing both approval and private key
    envelope = json.dumps({
        "approval": raw_key,
        "sessionPrivateKey": session_private_key,
    }, separators=(",", ":"))

    key_address = (
        session_key_data.get("sessionKeyAddress")
        or session_key_data.get("key_address")
        or ""
    )

    # ── Renewal guard — reject if current key has >24h remaining ─────
    if not force:
        now = datetime.now(timezone.utc)
        now_z = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        existing = (
            db.table("session_keys")
            .select("expires_at, key_address")
            .eq("account_id", str(account_id))
            .eq("is_active", True)
            .gte("expires_at", now_z)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if existing.data:
            existing_row = existing.data[0]
            existing_expires = datetime.fromisoformat(existing_row["expires_at"])
            # Ensure timezone-aware comparison
            if existing_expires.tzinfo is None:
                existing_expires = existing_expires.replace(tzinfo=timezone.utc)
            remaining = existing_expires - now
            if remaining > timedelta(hours=24):
                existing_key_address = str(existing_row.get("key_address") or "").strip().lower()
                incoming_key_address = str(key_address).strip().lower()
                is_explicit_regrant = (
                    bool(existing_key_address)
                    and bool(incoming_key_address)
                    and existing_key_address != incoming_key_address
                )
                if not is_explicit_regrant:
                    raise ValueError(
                        f"Active session key still has {remaining.total_seconds() / 3600:.1f}h remaining "
                        f"(>24h). Renewal not needed yet."
                    )
                logger.info(
                    "Bypassing renewal guard for account %s — incoming key address differs "
                    "(old=%s new=%s)",
                    account_id,
                    existing_key_address,
                    incoming_key_address,
                )

    # Handle expiresAt as either ISO string or unix timestamp
    expires_raw = session_key_data.get("expiresAt") or session_key_data.get("expires_at")
    if isinstance(expires_raw, (int, float)):
        expires_at = datetime.fromtimestamp(expires_raw, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        expires_at = str(expires_raw) if expires_raw else None
        # Normalize any +00:00 suffix to Z for consistent PostgREST queries
        if expires_at and expires_at.endswith("+00:00"):
            expires_at = expires_at.replace("+00:00", "Z")

    encrypted = encrypt_session_key(envelope)

    # Deactivate ALL existing active keys for this account before inserting.
    # Multiple active keys cause race conditions when concurrent rebalance
    # attempts pick up different keys with different permissionHashes.
    try:
        deactivate_result = db.table("session_keys").update(
            {"is_active": False}
        ).eq("account_id", str(account_id)).eq("is_active", True).execute()
        deactivated_count = len(deactivate_result.data) if deactivate_result.data else 0
        if deactivated_count > 0:
            logger.info(
                "Deactivated %d old session key(s) for account %s before storing new key",
                deactivated_count, account_id,
            )
    except Exception as exc:
        logger.warning("Failed to deactivate old session keys for %s: %s", account_id, exc)

    row_payload = {
        "account_id": str(account_id),
        "serialized_permission": encrypted,
        "key_address": key_address,
        "expires_at": expires_at,
        "is_active": True,
        "allowed_protocols": session_key_data.get("allowed_protocols")
            or session_key_data.get("allowedProtocols")
            or ["aave_v3", "benqi", "spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"],
        "allocation_caps": _normalize_allocation_caps(
            session_key_data.get("allocation_caps")
            if "allocation_caps" in session_key_data
            else session_key_data.get("allocationCaps")
        ),
        "max_amount_per_tx": session_key_data.get("max_amount_per_tx", "0"),
    }

    try:
        row = (
            db.table("session_keys")
            .insert(row_payload)
            .execute()
        )
    except Exception as exc:
        # Backward-compatible fallback during rolling deploys before migration.
        if "allocation_caps" not in str(exc).lower():
            raise
        row_payload.pop("allocation_caps", None)
        row = (
            db.table("session_keys")
            .insert(row_payload)
            .execute()
        )
    new_id = row.data[0]["id"]
    logger.info("Session key stored for account %s (key_id=%s)", account_id, new_id)
    return new_id


def get_active_session_key(db: Client, account_id: UUID) -> str | None:
    """Fetch, decrypt, and return the active session key approval for *account_id*.

    Returns ``None`` when no active (and non-expired) key exists.
    Returns only the serialized permission (approval) string for backward compat.
    """
    record = get_active_session_key_record(db, account_id)
    if not record:
        return None
    return record["serialized_permission"]


def get_active_session_key_metadata(db: Client, account_id: UUID) -> dict | None:
    """Return latest non-expired active key metadata without decrypting secrets."""
    row = _select_latest_active_key_row(db, account_id)
    if not row:
        return None

    raw_allowed = row.get("allowed_protocols")
    allowed_protocols = (
        [str(p) for p in raw_allowed]
        if isinstance(raw_allowed, list) and raw_allowed
        else ["aave_v3", "benqi", "spark", "euler_v2", "silo_savusd_usdc", "silo_susdp_usdc"]
    )
    allocation_caps = _normalize_allocation_caps(row.get("allocation_caps"))

    return {
        "id": row.get("id"),
        "key_address": row.get("key_address"),
        "expires_at": row.get("expires_at"),
        "created_at": row.get("created_at"),
        "allowed_protocols": allowed_protocols,
        "allocation_caps": allocation_caps,
        "max_amount_per_tx": str(row.get("max_amount_per_tx") or "0"),
        "serialized_permission": row.get("serialized_permission"),
    }


def get_active_session_key_record(db: Client, account_id: UUID) -> ActiveSessionKey | None:
    """Fetch active session key plus protocol scope metadata.

    Returns ``None`` when no active (and non-expired) key exists.
    """
    metadata = get_active_session_key_metadata(db, account_id)
    if not metadata:
        return None

    row = metadata
    allowed_protocols = metadata["allowed_protocols"]

    try:
        decrypted = decrypt_session_key(row["serialized_permission"])
    except Exception as exc:
        key_id = row.get("id")
        logger.error(
            "Failed to decrypt active session key for account %s (key_id=%s): %s (%s)",
            account_id,
            key_id,
            exc,
            type(exc).__name__,
        )

        # Fail-safe: deactivate this unusable key so scheduler stops retrying.
        try:
            if key_id:
                db.table("session_keys").update({"is_active": False}).eq("id", key_id).execute()
        except Exception as deact_exc:
            logger.warning(
                "Failed to deactivate unreadable session key %s for %s: %s",
                key_id,
                account_id,
                deact_exc,
            )

        raise ValueError(
            "Active session key cannot be decrypted. User must re-grant session key."
        ) from exc

    # Parse JSON envelope format: {"approval": "...", "sessionPrivateKey": "0x..."}
    # Backward compat: legacy keys stored as plain strings (no JSON envelope)
    session_private_key = ""
    serialized_permission = decrypted
    try:
        parsed = json.loads(decrypted)
        if isinstance(parsed, dict) and "approval" in parsed:
            serialized_permission = parsed["approval"]
            session_private_key = parsed.get("sessionPrivateKey", "")
    except (json.JSONDecodeError, TypeError):
        # Legacy format: plain serialized permission string
        pass

    return {
        "key_id": str(row.get("id") or ""),
        "key_address": row.get("key_address"),
        "expires_at": row.get("expires_at"),
        "created_at": row.get("created_at"),
        "serialized_permission": serialized_permission,
        "session_private_key": session_private_key,
        "allowed_protocols": allowed_protocols,
        "allocation_caps": _normalize_allocation_caps(row.get("allocation_caps")),
        "max_amount_per_tx": str(row.get("max_amount_per_tx") or "0"),
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


def get_deactivated_session_key_records(
    db: Client, account_id: UUID, limit: int = 5
) -> list[dict]:
    """Fetch recently deactivated session keys for an account.

    Used for PERMISSION_RECOVERY_NEEDED: when a re-granted session key
    can't install its permission (duplicate permissionHash), we try
    previously deactivated keys whose permission may still be installed
    on-chain.

    Returns up to *limit* dicts (most recent first), each with keys:
      ``key_id``, ``serialized_permission``, ``session_private_key``,
      ``allowed_protocols``.
    Keys that fail decryption or lack a ``session_private_key`` are
    silently skipped.
    """
    try:
        result = (
            db.table("session_keys")
            .select("id, serialized_permission, expires_at, allowed_protocols, allocation_caps")
            .eq("account_id", str(account_id))
            .eq("is_active", False)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if "allocation_caps" not in str(exc).lower():
            raise
        result = (
            db.table("session_keys")
            .select("id, serialized_permission, expires_at, allowed_protocols")
            .eq("account_id", str(account_id))
            .eq("is_active", False)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    if not result.data:
        return []

    records: list[dict] = []
    for row in result.data:
        try:
            decrypted = decrypt_session_key(row["serialized_permission"])
            session_private_key = ""
            serialized_permission = decrypted
            try:
                parsed = json.loads(decrypted)
                if isinstance(parsed, dict) and "approval" in parsed:
                    serialized_permission = parsed["approval"]
                    session_private_key = parsed.get("sessionPrivateKey", "")
            except (json.JSONDecodeError, TypeError):
                pass

            if not session_private_key:
                continue  # Legacy key without private key — unusable

            raw_allowed = row.get("allowed_protocols")
            allowed_protocols = (
                [str(p) for p in raw_allowed]
                if isinstance(raw_allowed, list) and raw_allowed
                else ["aave_v3", "benqi", "spark", "euler_v2",
                      "silo_savusd_usdc", "silo_susdp_usdc"]
            )
            records.append({
                "key_id": row["id"],
                "serialized_permission": serialized_permission,
                "session_private_key": session_private_key,
                "allowed_protocols": allowed_protocols,
                "allocation_caps": _normalize_allocation_caps(row.get("allocation_caps")),
            })
        except Exception:
            logger.debug(
                "Skipping deactivated key %s — decryption failed",
                row.get("id", "?"),
            )
    return records


def reactivate_session_key(db: Client, account_id: UUID, key_id: str) -> bool:
    """Reactivate a specific deactivated session key by its row id.

    First deactivates all currently active keys for the account, then
    reactivates the specified key.  Returns True on success.
    """
    # Deactivate any currently active keys
    db.table("session_keys").update({"is_active": False}).eq(
        "account_id", str(account_id)
    ).eq("is_active", True).execute()

    # Reactivate the specific key
    result = (
        db.table("session_keys")
        .update({"is_active": True})
        .eq("id", key_id)
        .eq("account_id", str(account_id))
        .execute()
    )
    success = bool(result.data)
    if success:
        logger.info(
            "Reactivated session key %s for account %s", key_id, account_id
        )
    return success


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
    now_z = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    warning_cutoff = (now + timedelta(days=_EXPIRY_WARNING_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

    result = (
        db.table("session_keys")
        .select("account_id, expires_at")
        .eq("is_active", True)
        .gte("expires_at", now_z)            # not yet expired
        .lte("expires_at", warning_cutoff)   # but expiring soon
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
