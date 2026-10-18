"""Wage watch: compare what was paid with what the contract says. Pure arithmetic, no model."""

from __future__ import annotations

import calendar
from datetime import date

from app.schemas import Flag, Money, WageCheckRequest, WageCheckResult

SHORTFALL_TOLERANCE = 0.02  # ignore rounding differences under 2%
LATE_GRACE_DAYS = 3


def _expected_pay_date(period_month: str, pay_day: int) -> date:
    """Pay is due on `pay_day` of the month after the work month (capped at the month's last day)."""
    year, month = (int(x) for x in period_month.split("-"))
    year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(pay_day, last))


def check_wage(req: WageCheckRequest) -> WageCheckResult:
    flags: list[Flag] = []
    contract, paid = req.contract_salary, req.paid
    comparable = contract.currency == paid.currency and contract.period == paid.period

    shortfall: Money | None = None
    shortfall_pct: float | None = None
    if comparable and contract.amount > 0:
        gap = round(contract.amount - paid.amount, 2)
        if gap > contract.amount * SHORTFALL_TOLERANCE:
            shortfall = Money(amount=gap, currency=contract.currency, period=contract.period)
            shortfall_pct = round(100 * gap / contract.amount, 1)
            flags.append(
                Flag(
                    code="WAGE_SHORT",
                    severity="high" if shortfall_pct >= 10 else "medium",
                    title="Paid less than the contract",
                    explanation=(
                        f"You were paid {paid.amount:,.0f} {paid.currency} but the contract says "
                        f"{contract.amount:,.0f} {contract.currency}: {gap:,.0f} short ({shortfall_pct}%)."
                    ),
                )
            )
    elif not comparable:
        flags.append(
            Flag(
                code="WAGE_NOT_COMPARABLE",
                severity="info",
                title="Can't compare automatically",
                explanation="The payslip and contract use a different currency or pay period.",
            )
        )

    days_late: int | None = None
    if req.expected_pay_day and req.paid_on and req.period_month:
        due = _expected_pay_date(req.period_month, req.expected_pay_day)
        days_late = (req.paid_on - due).days
        if days_late > LATE_GRACE_DAYS:
            flags.append(
                Flag(
                    code="WAGE_LATE",
                    severity="high" if days_late > 30 else "medium",
                    title="Salary paid late",
                    explanation=f"Pay was due on {due.isoformat()} and arrived {days_late} days late.",
                )
            )
        days_late = max(days_late, 0)

    recommend = any(f.code in ("WAGE_SHORT", "WAGE_LATE") and f.severity == "high" for f in flags)
    return WageCheckResult(
        comparable=comparable,
        shortfall=shortfall,
        shortfall_pct=shortfall_pct,
        days_late=days_late,
        flags=flags,
        recommend_case=recommend,
    )
