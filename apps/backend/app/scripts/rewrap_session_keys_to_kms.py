"""Re-wrap legacy local-encrypted session key blobs into KMS envelopes.

Usage:
  python -m app.scripts.rewrap_session_keys_to_kms --dry-run
  python -m app.scripts.rewrap_session_keys_to_kms --limit 500

Notes:
- Requires KMS_KEY_ID and valid AWS credentials in environment.
- Does NOT log key material.
- Safe to re-run; rows already in kms:v1 format are skipped.
"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Iterable

from app.core.config import get_settings
from app.core.database import get_supabase
from app.services.execution.session_key import decrypt_session_key, encrypt_session_key

logger = logging.getLogger("snowmind.scripts.rewrap_kms")
_KMS_PREFIX = "kms:v1:"


def _iter_rows(rows: Iterable[dict]) -> Iterable[dict]:
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_id = row.get("id")
        blob = row.get("serialized_permission")
        if not row_id or not isinstance(blob, str):
            continue
        yield row


def run(*, dry_run: bool, limit: int) -> int:
    settings = get_settings()
    if not settings.KMS_KEY_ID:
        logger.error("KMS_KEY_ID is not configured. Aborting re-wrap.")
        return 2

    db = get_supabase()
    rows = (
        db.table("session_keys")
        .select("id, serialized_permission")
        .order("created_at", desc=False)
        .limit(limit)
        .execute()
        .data
        or []
    )

    scanned = 0
    updated = 0
    skipped = 0
    failed = 0

    for row in _iter_rows(rows):
        scanned += 1
        row_id = row["id"]
        encrypted_blob = row["serialized_permission"]

        if encrypted_blob.startswith(_KMS_PREFIX):
            skipped += 1
            continue

        try:
            plaintext = decrypt_session_key(encrypted_blob)
            rewrapped = encrypt_session_key(plaintext)
            if not rewrapped.startswith(_KMS_PREFIX):
                raise RuntimeError("Re-wrapped blob is not KMS envelope")

            if not dry_run:
                db.table("session_keys").update(
                    {"serialized_permission": rewrapped}
                ).eq("id", row_id).execute()
            updated += 1
        except Exception as exc:
            failed += 1
            logger.error("Failed to re-wrap session key row %s: %s", row_id, exc)

    logger.info(
        "Re-wrap complete. scanned=%d updated=%d skipped=%d failed=%d dry_run=%s",
        scanned,
        updated,
        skipped,
        failed,
        dry_run,
    )

    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-wrap legacy session key blobs to AWS KMS envelopes")
    parser.add_argument("--dry-run", action="store_true", help="Validate conversion without writing updates")
    parser.add_argument("--limit", type=int, default=10000, help="Maximum rows to scan")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.limit <= 0:
        logger.error("--limit must be positive")
        return 2

    return run(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
