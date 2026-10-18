// Wage watch: compare what was paid with what the contract says. Pure arithmetic, no model.
// Ported from backend/app/services/wage.py.

import type { Flag, Money, WageCheckRequest, WageCheckResult } from "@/lib/types";
import { formatAmount } from "./text";

const SHORTFALL_TOLERANCE = 0.02;
const LATE_GRACE_DAYS = 3;

/** Pay is due on `payDay` of the month after the work month, capped at that month's last day. */
export function expectedPayDate(periodMonth: string, payDay: number): string {
  let [year, month] = periodMonth.split("-").map(Number);
  if (month === 12) {
    year += 1;
    month = 1;
  } else month += 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(payDay, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function checkWage(req: WageCheckRequest): WageCheckResult {
  const flags: Flag[] = [];
  const contract = req.contract_salary;
  const paid = req.paid;
  const comparable = contract.currency === paid.currency && (contract.period ?? "month") === (paid.period ?? "month");
  let shortfall: Money | null = null;
  let shortfallPct: number | null = null;

  if (comparable && contract.amount > 0) {
    const gap = Math.round((contract.amount - paid.amount) * 100) / 100;
    if (gap > contract.amount * SHORTFALL_TOLERANCE) {
      shortfall = { amount: gap, currency: contract.currency, period: contract.period ?? "month" };
      shortfallPct = Math.round((1000 * gap) / contract.amount) / 10;
      flags.push({
        code: "WAGE_SHORT",
        severity: shortfallPct >= 10 ? "high" : "medium",
        title: "Paid less than the contract",
        explanation: `You were paid ${formatAmount(paid.amount)} ${paid.currency} but the contract says ${formatAmount(contract.amount)} ${contract.currency}: ${formatAmount(gap)} short (${shortfallPct}%).`,
        evidence: [],
        sources: [],
        params: { paid: `${formatAmount(paid.amount)} ${paid.currency}`, contract: `${formatAmount(contract.amount)} ${contract.currency}`, gap: `${formatAmount(gap)} ${contract.currency}`, pct: shortfallPct },
      });
    }
  } else if (!comparable) {
    flags.push({
      code: "WAGE_NOT_COMPARABLE",
      severity: "info",
      title: "Can't compare automatically",
      explanation: "The payslip and contract use a different currency or pay period.",
      evidence: [],
      sources: [],
    });
  }

  let daysLate: number | null = null;
  if (req.expected_pay_day && req.paid_on && req.period_month) {
    const due = expectedPayDate(req.period_month, req.expected_pay_day);
    daysLate = dayNumber(req.paid_on) - dayNumber(due);
    if (daysLate > LATE_GRACE_DAYS) {
      flags.push({
        code: "WAGE_LATE",
        severity: daysLate > 30 ? "high" : "medium",
        title: "Salary paid late",
        explanation: `Pay was due on ${due} and arrived ${daysLate} days late.`,
        evidence: [],
        sources: [],
        params: { due, days: daysLate },
      });
    }
    daysLate = Math.max(daysLate, 0);
  }

  return {
    comparable,
    shortfall,
    shortfall_pct: shortfallPct,
    days_late: daysLate,
    flags,
    recommend_case: flags.some((f) => (f.code === "WAGE_SHORT" || f.code === "WAGE_LATE") && f.severity === "high"),
  };
}
