"""Backfill account principal tracking from on-chain owner<->smart USDC transfers.

Usage:
  python -m app.scripts.backfill_account_principal_tracking --dry-run
  python -m app.scripts.backfill_account_principal_tracking --limit 5000 --batch-size 200
  python -m app.scripts.backfill_account_principal_tracking --account-id <uuid>
    python -m app.scripts.backfill_account_principal_tracking --smart-address <0x...>

What it repairs:
- account_yield_tracking drift where cumulative_deposited/cumulative_net_withdrawn
  no longer reflect lifetime owner<->smart account transfer history.

Data sources:
- Snowtrace tokentx API (authoritative when SNOWTRACE_API_KEY is configured)
- Fallback: executed tx receipts referenced in rebalance_logs

Safety:
- Idempotent and safe to re-run.
- Dry-run mode computes and reports reconciled net principal without writing.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from decimal import Decimal

from app.api.routes.portfolio import _reconcile_principal_tracking_from_chain
from app.core.database import get_supabase

logger = logging.getLogger("snowmind.scripts.backfill_account_principal_tracking")


def _read_current_net_principal(db, account_id: str) -> Decimal:
    """Read current tracked net principal for an account (deposited - withdrawn)."""
    try:
        row = (
            db.table("account_yield_tracking")
            .select("cumulative_deposited,cumulative_net_withdrawn")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if not row.data:
            return Decimal("0")
        deposited = Decimal(str(row.data[0].get("cumulative_deposited") or 0))
        withdrawn = Decimal(str(row.data[0].get("cumulative_net_withdrawn") or 0))
        return max(deposited - withdrawn, Decimal("0"))
    except Exception as exc:
        logger.warning("Failed to read existing tracking for %s: %s", account_id, exc)
        return Decimal("0")


async def run(
    *,
    dry_run: bool,
    limit: int,
    batch_size: int,
    account_id: str | None,
    smart_address: str | None,
) -> int:
    db = get_supabase()

    scanned = 0
    reconciled = 0
    skipped = 0
    failed = 0

    offset = 0
    while scanned < limit:
        page_size = min(batch_size, limit - scanned)
        query = (
            db.table("accounts")
            .select("id,address,owner_address")
            .order("created_at", desc=False)
            .range(offset, offset + page_size - 1)
        )
        if account_id:
            query = query.eq("id", account_id)
        if smart_address:
            query = query.eq("address", smart_address)

        rows = query.execute().data or []
        if not rows:
            break

        for row in rows:
            scanned += 1
            account_id_value = str(row.get("id") or "")
            smart_address = str(row.get("address") or "")
            owner_address = str(row.get("owner_address") or "")

            if not account_id_value or not smart_address or not owner_address:
                skipped += 1
                continue

            before_net = _read_current_net_principal(db, account_id_value)
            try:
                after_net = await _reconcile_principal_tracking_from_chain(
                    db=db,
                    account_id=account_id_value,
                    smart_address=smart_address,
                    owner_address=owner_address,
                    persist=not dry_run,
                )
            except Exception as exc:
                failed += 1
                logger.error(
                    "Principal backfill failed for account_id=%s smart=%s: %s",
                    account_id_value,
                    smart_address,
                    exc,
                )
                continue

            if after_net is None:
                skipped += 1
                continue

            delta = after_net - before_net
            if delta.copy_abs() > Decimal("0.01"):
                reconciled += 1
                logger.info(
                    "%s reconcile account_id=%s smart=%s before_net=%s after_net=%s delta=%s",
                    "DRY-RUN" if dry_run else "APPLIED",
                    account_id_value,
                    smart_address,
                    before_net.quantize(Decimal("0.000001")),
                    after_net.quantize(Decimal("0.000001")),
                    delta.quantize(Decimal("0.000001")),
                )
            else:
                skipped += 1

        if len(rows) < page_size or account_id:
            break
        offset += len(rows)

    logger.info(
        "Principal backfill complete: scanned=%d reconciled=%d skipped=%d failed=%d dry_run=%s account_id=%s smart_address=%s",
        scanned,
        reconciled,
        skipped,
        failed,
        dry_run,
        account_id or "*",
        smart_address or "*",
    )
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill account_yield_tracking principal from chain transfers")
    parser.add_argument("--dry-run", action="store_true", help="Compute reconciled values without writing")
    parser.add_argument("--limit", type=int, default=5000, help="Maximum accounts to scan")
    parser.add_argument("--batch-size", type=int, default=200, help="Accounts per page")
    parser.add_argument("--account-id", type=str, default=None, help="Optional single-account scope")
    parser.add_argument("--smart-address", type=str, default=None, help="Optional smart-account address scope")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.limit <= 0:
        logger.error("--limit must be positive")
        return 2
    if args.batch_size <= 0:
        logger.error("--batch-size must be positive")
        return 2
    if args.account_id and args.smart_address:
        logger.error("Use either --account-id or --smart-address, not both")
        return 2

    return asyncio.run(
        run(
            dry_run=args.dry_run,
            limit=args.limit,
            batch_size=args.batch_size,
            account_id=args.account_id,
            smart_address=args.smart_address,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
