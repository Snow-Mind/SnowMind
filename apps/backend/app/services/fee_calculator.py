"""Profit fee calculator — 10% of yield on withdrawal (Giza-style).

Tracks cumulative deposits and withdrawals per account so profit can be
computed at any point as:
    profit = current_value - (total_deposited - total_withdrawn)
    fee    = max(profit, 0) * PROFIT_FEE_PCT
"""

import logging
from datetime import datetime, timezone
from decimal import Decimal

from app.core.config import get_settings

logger = logging.getLogger("snowmind")

_ZERO = Decimal("0")


def calculate_withdrawal_fee(
    current_value_usd: Decimal,
    total_deposited_usdc: Decimal,
    total_withdrawn_usdc: Decimal,
) -> dict:
    """Calculate the 10% profit fee for a full withdrawal.

    Returns a dict with:
        profit_usd: Total profit (yield earned)
        fee_usd: The fee to collect (10% of profit)
        net_withdrawal_usd: What the user receives
    """
    settings = get_settings()
    fee_pct = Decimal(str(settings.PROFIT_FEE_PCT))

    # Net principal still in the system
    net_principal = total_deposited_usdc - total_withdrawn_usdc
    profit = current_value_usd - net_principal

    if profit <= _ZERO:
        # No profit — no fee
        return {
            "profit_usd": _ZERO,
            "fee_usd": _ZERO,
            "net_withdrawal_usd": current_value_usd,
            "fee_pct": fee_pct,
        }

    fee = (profit * fee_pct).quantize(Decimal("0.01"))

    # Cap fee at fee_pct of current_value to prevent disproportionate fees
    # (edge case: user partial-withdrew more than principal, net_principal is
    # negative, and fee would be unreasonably large vs remaining balance)
    max_fee = (current_value_usd * fee_pct).quantize(Decimal("0.01"))
    fee = min(fee, max_fee)

    net = current_value_usd - fee

    return {
        "profit_usd": profit.quantize(Decimal("0.01")),
        "fee_usd": fee,
        "net_withdrawal_usd": net.quantize(Decimal("0.01")),
        "fee_pct": fee_pct,
    }


def record_deposit(db, account_id: str, amount_usdc: Decimal) -> None:
    """Record a deposit in the yield tracking table."""
    try:
        existing = (
            db.table("account_yield_tracking")
            .select("total_deposited_usdc")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            new_total = Decimal(str(existing.data[0]["total_deposited_usdc"])) + amount_usdc
            db.table("account_yield_tracking").update(
                {"total_deposited_usdc": str(new_total), "updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("account_id", account_id).execute()
        else:
            db.table("account_yield_tracking").insert({
                "account_id": account_id,
                "total_deposited_usdc": str(amount_usdc),
                "total_withdrawn_usdc": "0",
                "total_fees_collected_usdc": "0",
            }).execute()
    except Exception as exc:
        logger.warning("Failed to record deposit for %s: %s", account_id, exc)


def record_partial_withdrawal(db, account_id: str, amount_usdc: Decimal) -> None:
    """Record a partial withdrawal (no fee charged).

    Increments cumulative_withdrawn so the final full-withdrawal profit
    calculation remains correct.
    """
    try:
        existing = (
            db.table("account_yield_tracking")
            .select("total_withdrawn_usdc")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            new_total = Decimal(str(existing.data[0]["total_withdrawn_usdc"])) + amount_usdc
            db.table("account_yield_tracking").update(
                {"total_withdrawn_usdc": str(new_total), "updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("account_id", account_id).execute()
        else:
            logger.warning(
                "No yield tracking row for %s during partial withdrawal",
                account_id,
            )
    except Exception as exc:
        logger.warning("Failed to record partial withdrawal for %s: %s", account_id, exc)


def record_withdrawal_fee(
    db,
    account_id: str,
    withdrawn_usdc: Decimal,
    fee_usdc: Decimal,
) -> None:
    """Record a withdrawal and fee collection in the yield tracking table."""
    try:
        existing = (
            db.table("account_yield_tracking")
            .select("total_withdrawn_usdc, total_fees_collected_usdc")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            row = existing.data[0]
            new_withdrawn = Decimal(str(row["total_withdrawn_usdc"])) + withdrawn_usdc
            new_fees = Decimal(str(row["total_fees_collected_usdc"])) + fee_usdc
            db.table("account_yield_tracking").update({
                "total_withdrawn_usdc": str(new_withdrawn),
                "total_fees_collected_usdc": str(new_fees),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("account_id", account_id).execute()
    except Exception as exc:
        logger.warning("Failed to record withdrawal fee for %s: %s", account_id, exc)


def get_yield_tracking(db, account_id: str) -> dict | None:
    """Fetch the yield tracking record for an account."""
    try:
        result = (
            db.table("account_yield_tracking")
            .select("*")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception:
        return None
