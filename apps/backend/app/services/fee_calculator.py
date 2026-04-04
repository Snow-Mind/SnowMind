"""
Agent fee calculator — 10% of profit, proportional on EVERY withdrawal.

Formula (from ARCHITECTURE.md):
    proportion = withdraw_amount / current_balance
    accrued_profit = max(0, current_balance - net_principal)
    attributable_profit = accrued_profit × proportion
    agent_fee = attributable_profit × 0.10
    user_receives = withdraw_amount - agent_fee
    net_principal -= (withdraw_amount - agent_fee)

Key rules:
    - Fee is charged on EVERY withdrawal (partial or full) — never only at exit
    - Fee is proportional to the amount being withdrawn
    - If account has no profit (loss), fee is zero
    - If account.fee_exempt = true (beta users), fee is always zero
    - Fee is called "agent fee", never "performance fee"
    - All math uses Python Decimal — never float
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from app.core.config import get_settings

logger = logging.getLogger("snowmind.fees")

_ZERO = Decimal("0")
_USDC_PRECISION = Decimal("0.000001")  # 6 decimal places


@dataclass
class FeeCalculation:
    """Result of a fee calculation for a withdrawal."""
    withdraw_amount: Decimal      # Amount the user requested to withdraw
    current_balance: Decimal      # Total balance at time of withdrawal
    net_principal: Decimal         # cumulative_deposited - cumulative_net_withdrawn
    accrued_profit: Decimal        # max(0, current_balance - net_principal)
    attributable_profit: Decimal   # profit × proportion
    agent_fee: Decimal             # attributable_profit × fee_rate
    user_receives: Decimal         # withdraw_amount - agent_fee
    new_net_principal: Decimal     # Updated net_principal after withdrawal
    fee_exempt: bool               # Whether fee was waived (beta user)
    fee_rate: Decimal              # The fee rate applied (0.10 for normal, 0 for exempt)


def calculate_agent_fee(
    withdraw_amount: Decimal,
    current_balance: Decimal,
    net_principal: Decimal,
    fee_exempt: bool,
    fee_rate: Decimal | None = None,
) -> FeeCalculation:
    """
    Calculate the proportional agent fee for a withdrawal.

    This is the core fee calculation that runs on EVERY withdrawal.
    Never charges fee on a loss. Never charges fee on fee-exempt accounts.

    Args:
        withdraw_amount: USDC amount being withdrawn (6 decimal precision)
        current_balance: Total current on-chain balance (across all protocols)
        net_principal: cumulative_deposited - cumulative_net_withdrawn
        fee_exempt: True if account is fee-exempt (beta user)
        fee_rate: Override fee rate (default: from settings)

    Returns:
        FeeCalculation with all computed values.
    """
    settings = get_settings()
    if fee_rate is None:
        fee_rate = Decimal(str(settings.AGENT_FEE_RATE))

    # Validate inputs
    if withdraw_amount <= _ZERO:
        raise ValueError("withdraw_amount must be positive")
    if current_balance <= _ZERO:
        raise ValueError("current_balance must be positive")
    if withdraw_amount > current_balance:
        raise ValueError(
            f"withdraw_amount ({withdraw_amount}) exceeds current_balance ({current_balance})"
        )

    # Fee-exempt accounts: zero fee always
    if fee_exempt:
        new_net_principal = net_principal - withdraw_amount
        return FeeCalculation(
            withdraw_amount=withdraw_amount,
            current_balance=current_balance,
            net_principal=net_principal,
            accrued_profit=max(_ZERO, current_balance - net_principal),
            attributable_profit=_ZERO,
            agent_fee=_ZERO,
            user_receives=withdraw_amount,
            new_net_principal=new_net_principal,
            fee_exempt=True,
            fee_rate=_ZERO,
        )

    # Proportional fee calculation
    proportion = withdraw_amount / current_balance
    accrued_profit = max(_ZERO, current_balance - net_principal)
    attributable_profit = accrued_profit * proportion
    agent_fee = (attributable_profit * fee_rate).quantize(_USDC_PRECISION)
    user_receives = withdraw_amount - agent_fee

    # Update net_principal: reduce by user_receives (what user actually gets)
    new_net_principal = net_principal - user_receives

    return FeeCalculation(
        withdraw_amount=withdraw_amount,
        current_balance=current_balance,
        net_principal=net_principal,
        accrued_profit=accrued_profit,
        attributable_profit=attributable_profit.quantize(_USDC_PRECISION),
        agent_fee=agent_fee,
        user_receives=user_receives.quantize(_USDC_PRECISION),
        new_net_principal=new_net_principal,
        fee_exempt=False,
        fee_rate=fee_rate,
    )


# ── Database helpers ─────────────────────────────────────────────────────────

def record_deposit(db, account_id: str, amount_usdc: Decimal) -> None:
    """Record a deposit — increments cumulative_deposited."""
    try:
        existing = (
            db.table("account_yield_tracking")
            .select("cumulative_deposited")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        now = datetime.now(timezone.utc).isoformat()
        if existing.data:
            new_total = Decimal(str(existing.data[0]["cumulative_deposited"])) + amount_usdc
            db.table("account_yield_tracking").update(
                {"cumulative_deposited": str(new_total), "updated_at": now}
            ).eq("account_id", account_id).execute()
        else:
            db.table("account_yield_tracking").insert({
                "account_id": account_id,
                "cumulative_deposited": str(amount_usdc),
                "cumulative_net_withdrawn": "0",
            }).execute()
        logger.info(
            "Deposit recorded for %s: $%.6f USDC",
            account_id,
            float(amount_usdc),
        )
    except Exception as exc:
        logger.error("Failed to record deposit for %s: %s", account_id, exc)
        raise


def record_withdrawal(
    db,
    account_id: str,
    fee_calc: FeeCalculation,
) -> None:
    """
    Record a withdrawal with fee in the yield tracking table.

    Updates cumulative_net_withdrawn by (withdraw_amount - agent_fee) = user_receives.
    This is the same formula as: net_principal -= user_receives.
    """
    try:
        existing = (
            db.table("account_yield_tracking")
            .select("cumulative_deposited, cumulative_net_withdrawn")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            # Legacy/self-heal path: if tracking row is missing, bootstrap from
            # the observed pre-withdrawal balance so future accounting remains
            # consistent and withdrawals are not lost from DB metrics.
            assumed_deposited = fee_calc.current_balance
            db.table("account_yield_tracking").insert({
                "account_id": account_id,
                "cumulative_deposited": str(assumed_deposited),
                "cumulative_net_withdrawn": str(fee_calc.user_receives),
            }).execute()
            logger.warning(
                "Yield tracking row missing for %s during withdrawal; bootstrapped with current balance",
                account_id,
            )
            return

        current_withdrawn = Decimal(str(existing.data[0]["cumulative_net_withdrawn"]))
        # user_receives = withdraw_amount - agent_fee
        # This is the net amount leaving the system (from user's principal perspective)
        new_withdrawn = current_withdrawn + fee_calc.user_receives

        now = datetime.now(timezone.utc).isoformat()
        db.table("account_yield_tracking").update({
            "cumulative_net_withdrawn": str(new_withdrawn),
            "updated_at": now,
        }).eq("account_id", account_id).execute()

        logger.info(
            "Withdrawal recorded for %s: withdrew=$%.6f, fee=$%.6f, user_receives=$%.6f",
            account_id,
            float(fee_calc.withdraw_amount),
            float(fee_calc.agent_fee),
            float(fee_calc.user_receives),
        )
    except Exception as exc:
        logger.error("Failed to record withdrawal for %s: %s", account_id, exc)
        raise


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
    except Exception as exc:
        logger.warning("Failed to fetch yield tracking for %s: %s", account_id, exc)
        return None


# ── Backward-compat helpers ───────────────────────────────────────────────

def record_partial_withdrawal(db, account_id: str, amount_usdc: Decimal) -> None:
    """Legacy helper: record a no-fee partial withdrawal."""
    fee_calc = FeeCalculation(
        withdraw_amount=amount_usdc,
        current_balance=amount_usdc,
        net_principal=amount_usdc,
        accrued_profit=_ZERO,
        attributable_profit=_ZERO,
        agent_fee=_ZERO,
        user_receives=amount_usdc,
        new_net_principal=_ZERO,
        fee_exempt=True,
        fee_rate=_ZERO,
    )
    record_withdrawal(db, account_id, fee_calc)


def calculate_withdrawal_fee(
    current_value_usd: Decimal,
    total_deposited_usdc: Decimal,
    total_withdrawn_usdc: Decimal,
) -> dict:
    """Legacy compatibility API used by older withdrawal paths."""
    net_principal = total_deposited_usdc - total_withdrawn_usdc
    fee_calc = calculate_agent_fee(
        withdraw_amount=current_value_usd,
        current_balance=current_value_usd,
        net_principal=net_principal,
        fee_exempt=False,
    )
    return {
        "profit_usd": fee_calc.accrued_profit,
        "fee_usd": fee_calc.agent_fee,
        "net_withdrawal_usd": fee_calc.user_receives,
        "fee_pct": fee_calc.fee_rate,
    }


def record_withdrawal_fee(
    db,
    account_id: str,
    withdrawn_usdc: Decimal,
    fee_usdc: Decimal,
) -> None:
    """Legacy compatibility API used by older withdrawal paths."""
    fee_calc = FeeCalculation(
        withdraw_amount=withdrawn_usdc,
        current_balance=withdrawn_usdc,
        net_principal=withdrawn_usdc,
        accrued_profit=fee_usdc / Decimal("0.10") if fee_usdc > _ZERO else _ZERO,
        attributable_profit=fee_usdc / Decimal("0.10") if fee_usdc > _ZERO else _ZERO,
        agent_fee=fee_usdc,
        user_receives=withdrawn_usdc - fee_usdc,
        new_net_principal=_ZERO,
        fee_exempt=False,
        fee_rate=Decimal("0.10"),
    )
    record_withdrawal(db, account_id, fee_calc)
