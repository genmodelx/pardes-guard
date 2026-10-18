"""Offline stand-in for Gemini. Deterministic, so tests and local UI work don't need credentials.

It understands plain-text contracts written as "Field: value" lines (see backend/data/eval/contracts),
which is enough to exercise every rule end to end. Images, PDFs and audio return a low-confidence
empty reading, exactly what the real pipeline must handle for an unreadable photo.
"""

from __future__ import annotations

import re

from app.llm.base import DocumentReading, RequirementProposal, StatementReading
from app.schemas import Case, CheckContext, CountryPack, LadderStep, Money, Verdict, VisaRoute
from app.services.security import ValidatedFile

_MONEY = re.compile(r"([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3})(?:\s*(?:per|/|a)\s*(month|week|day|hour))?", re.IGNORECASE)


def _field(text: str, *names: str) -> str | None:
    for name in names:
        m = re.search(rf"^\s*{re.escape(name)}\s*[:=]\s*(.+?)\s*$", text, re.IGNORECASE | re.MULTILINE)
        if m:
            return m.group(1).strip()
    return None


def _money(value: str | None) -> Money | None:
    if not value:
        return None
    m = _MONEY.search(value)
    if not m:
        return None
    return Money(amount=float(m.group(1).replace(",", "")), currency=m.group(2).upper(), period=(m.group(3) or "month").lower())  # type: ignore[arg-type]


def _yesno(value: str | None) -> bool | None:
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("yes", "provided", "included", "true", "free", "employer"):
        return True
    if v in ("no", "not provided", "excluded", "false", "worker pays", "worker"):
        return False
    return None


def _number(value: str | None) -> float | None:
    if not value:
        return None
    m = re.search(r"\d+(?:\.\d+)?", value)
    return float(m.group(0)) if m else None


class FakeLLM:
    name = "fake"

    async def read_document(self, file: ValidatedFile, context: CheckContext) -> DocumentReading:
        if file.mime_type != "text/plain":
            return DocumentReading(doc_type="other", confidence=0.2)
        text = file.data.decode("utf-8", errors="replace")
        doc_type = (_field(text, "Document", "Type") or "contract").lower().replace(" ", "_")
        if doc_type not in ("contract", "offer_letter", "visa", "job_ad", "payslip", "receipt"):
            doc_type = "other"
        passport_line = _field(text, "Passport")
        passport_held = None
        if passport_line:
            passport_held = bool(re.search(r"(employer|sponsor|agent|company).*(keep|hold|retain)|(keep|hold|retain).*(employer|sponsor|agent|company)", passport_line, re.I))
        phones = [p.strip() for p in (_field(text, "Recruiter phone", "Phone") or "").split(",") if p.strip()]
        clauses = [c.strip() for c in re.findall(r"^\s*Clause\s*:\s*(.+)$", text, re.I | re.M)]
        months = _number(_field(text, "Duration", "Contract months"))
        return DocumentReading(
            doc_type=doc_type,  # type: ignore[arg-type]
            language=(_field(text, "Language") or "en")[:2].lower(),
            employer_name=_field(text, "Employer"),
            employer_address=_field(text, "Employer address", "Address"),
            recruiter_name=_field(text, "Recruiter"),
            recruiter_license_no=_field(text, "Licence", "License", "Recruiter licence"),
            recruiter_phones=phones,
            job_title=_field(text, "Job", "Job title", "Position"),
            visa_type=(_field(text, "Visa type") or None),
            visa_occupation=_field(text, "Visa occupation", "Profession"),
            destination_country=(_field(text, "Country") or context.destination_country or None),
            salary=_money(_field(text, "Salary", "Basic salary", "Paid")),
            weekly_hours=_number(_field(text, "Hours", "Working hours")),
            contract_months=int(months) if months is not None else None,
            accommodation_provided=_yesno(_field(text, "Accommodation")),
            food_provided=_yesno(_field(text, "Food")),
            medical_covered=_yesno(_field(text, "Medical")),
            return_ticket_provided=_yesno(_field(text, "Return ticket", "Ticket")),
            passport_held_by_employer=passport_held,
            fee_amount=_money(_field(text, "Fee")),
            fee_account=_field(text, "Fee account", "Account"),
            notable_clauses=clauses[:6],
            raw_text_excerpt=text[:600],
            confidence=0.9,
        )

    async def read_statement(self, audio: ValidatedFile | None, text: str | None, context: CheckContext) -> StatementReading:
        if not text:
            return StatementReading(transcript=None)
        return StatementReading(
            transcript=text,
            language="en",
            promised_salary=_money(_field(text, "Promised salary", "Salary")),
            fee_asked=_money(_field(text, "Fee", "Fee asked")),
            fee_paid_cash_only=_yesno(_field(text, "Cash only")),
            receipt_given=_yesno(_field(text, "Receipt")),
            recruiter_name=_field(text, "Recruiter"),
            recruiter_phone=_field(text, "Recruiter phone", "Phone"),
            recruiter_license_no=_field(text, "Licence", "License"),
            promised_job_title=_field(text, "Promised job", "Job"),
        )

    async def explain_verdict(self, verdict: Verdict, language: str) -> str:
        if verdict.level == "green":
            lead = "No serious warning signs were found."
        elif verdict.level == "amber":
            lead = "Some things need checking before you go ahead."
        else:
            lead = "There are serious warning signs."
        reasons = "; ".join(verdict.top_reasons) or "nothing major"
        step = verdict.next_steps[0] if verdict.next_steps else ""
        return f"{lead} Main points: {reasons}. {step} Check with the official office before paying or signing."

    async def draft_letter(self, case: Case, step: LadderStep, language: str) -> str:
        return step.draft or f"{step.name}\n\n{case.summary}"

    async def research_requirements(self, pack: CountryPack, route: VisaRoute) -> list[RequirementProposal]:
        return []

    async def speak(self, text: str, language: str) -> bytes | None:
        return None
