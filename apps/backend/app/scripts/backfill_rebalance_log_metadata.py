"""Backfill legacy executed rebalance log metadata.

Usage:
  python -m app.scripts.backfill_rebalance_log_metadata --dry-run
  python -m app.scripts.backfill_rebalance_log_metadata --limit 20000 --batch-size 500
  python -m app.scripts.backfill_rebalance_log_metadata --account-id <uuid>

What it repairs (idempotent):
- amount_moved when missing or non-numeric but allocations are present
- from_protocol when missing on executed rows
- to_protocol when missing on executed rows

Safety:
- Only touches rows with status=executed.
- Only fills missing/invalid metadata; never overwrites valid fields.
- Safe to re-run.
"""

from __future__ import annotations

import argparse
import json
import logging
from decimal import Decimal
from typing import Any

from app.core.database import get_supabase

logger = logging.getLogger("snowmind.scripts.backfill_rebalance_log_metadata")


def _parse_decimal(value: object) -> Decimal | None:
    """Parse numbers from legacy DB payloads (strings may include '$' and commas)."""
    try:
        if isinstance(value, Decimal):
            numeric = value
        elif isinstance(value, (int, float)):
            numeric = Decimal(str(value))
        elif isinstance(value, str):
            cleaned = value.replace(",", "").replace("$", "").strip()
            if not cleaned:
                return None
            numeric = Decimal(cleaned)
        else:
            return None
    except Exception:
        return None

    if numeric <= Decimal("0"):
        return None
    return numeric


def _normalize_allocations(payload: object) -> dict[str, Decimal]:
    """Normalize executed/proposed allocation maps into positive Decimal amounts."""
    candidate = payload
    if isinstance(candidate, str):
        try:
            candidate = json.loads(candidate)
        except Exception:
            return {}

    if not isinstance(candidate, dict):
        return {}

    normalized: dict[str, Decimal] = {}
    for protocol_id, raw_amount in candidate.items():
        amount = _parse_decimal(raw_amount)
        if amount is None:
            continue
        normalized[str(protocol_id)] = amount
    return normalized


def _dominant_protocol(allocations: dict[str, Decimal]) -> str | None:
    if not allocations:
        return None
    return max(allocations.items(), key=lambda item: item[1])[0]


def _normalize_protocol(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _compute_patch(row: dict[str, Any]) -> dict[str, str]:
    """Compute a minimal idempotent patch for one rebalance_logs row."""
    if str(row.get("status") or "").strip().lower() != "executed":
        return {}

    from_protocol = _normalize_protocol(row.get("from_protocol"))
    to_protocol = _normalize_protocol(row.get("to_protocol"))
    skip_reason = str(row.get("skip_reason") or "").lower()

    executed_allocations = _normalize_allocations(row.get("executed_allocations"))
    proposed_allocations = _normalize_allocations(row.get("proposed_allocations"))
    allocations = executed_allocations or proposed_allocations

    allocation_total = sum(allocations.values(), Decimal("0"))
    dominant = _dominant_protocol(allocations)

    patch: dict[str, str] = {}

    existing_amount = _parse_decimal(row.get("amount_moved"))
    if existing_amount is None and allocation_total > Decimal("0"):
        patch["amount_moved"] = str(allocation_total.quantize(Decimal("0.000001")))

    from_l = (from_protocol or "").lower()
    to_l = (to_protocol or "").lower()
    inferred_deposit = (
        "initial funding transfer" in skip_reason
        or from_l == "user_wallet"
        or (to_l == "idle" and "fund" in skip_reason)
    )
    inferred_withdraw = (
        from_l == "withdrawal"
        or to_l in {"user_eoa", "user_wallet"}
        or ("withdraw" in skip_reason and "initial funding transfer" not in skip_reason)
    )

    if from_protocol is None:
        if inferred_deposit:
            patch["from_protocol"] = "user_wallet"
        elif inferred_withdraw:
            patch["from_protocol"] = "withdrawal"
        elif dominant and dominant.lower() != "idle":
            patch["from_protocol"] = "rebalance"

    if to_protocol is None:
        if inferred_deposit:
            patch["to_protocol"] = "idle"
        elif inferred_withdraw:
            patch["to_protocol"] = "user_eoa"
        elif dominant and dominant.lower() != "idle":
            patch["to_protocol"] = dominant

    return patch


def run(*, dry_run: bool, limit: int, batch_size: int, account_id: str | None) -> int:
    db = get_supabase()

    scanned = 0
    patched = 0
    updated = 0
    failed = 0

    offset = 0
    while scanned < limit:
        page_size = min(batch_size, limit - scanned)
        query = (
            db.table("rebalance_logs")
            .select(
                "id,status,skip_reason,from_protocol,to_protocol,amount_moved,"
                "proposed_allocations,executed_allocations,created_at"
            )
            .eq("status", "executed")
            .order("created_at", desc=False)
            .range(offset, offset + page_size - 1)
        )
        if account_id:
            query = query.eq("account_id", account_id)

        rows = query.execute().data or []
        if not rows:
            break

        for row in rows:
            if not isinstance(row, dict):
                continue

            scanned += 1
            row_id = row.get("id")
            patch = _compute_patch(row)
            if not patch:
                continue

            patched += 1
            if dry_run:
                logger.info("DRY-RUN patch for rebalance_logs id=%s patch=%s", row_id, patch)
                continue

            try:
                db.table("rebalance_logs").update(patch).eq("id", row_id).execute()
                updated += 1
            except Exception as exc:
                failed += 1
                logger.error("Failed to patch rebalance_logs id=%s: %r", row_id, exc)

        if len(rows) < page_size:
            break
        offset += len(rows)

    logger.info(
        "Backfill complete: scanned=%d patched=%d updated=%d failed=%d dry_run=%s account_id=%s",
        scanned,
        patched,
        updated,
        failed,
        dry_run,
        account_id or "*",
    )
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill missing rebalance_logs transaction metadata")
    parser.add_argument("--dry-run", action="store_true", help="Print row patches without writing updates")
    parser.add_argument("--limit", type=int, default=50000, help="Maximum executed rows to scan")
    parser.add_argument("--batch-size", type=int, default=500, help="Rows per page")
    parser.add_argument("--account-id", type=str, default=None, help="Optional single-account backfill scope")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.limit <= 0:
        logger.error("--limit must be positive")
        return 2
    if args.batch_size <= 0:
        logger.error("--batch-size must be positive")
        return 2

    return run(
        dry_run=args.dry_run,
        limit=args.limit,
        batch_size=args.batch_size,
        account_id=args.account_id,
    )


if __name__ == "__main__":
    raise SystemExit(main())