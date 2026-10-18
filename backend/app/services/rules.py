"""Deterministic red-flag rules.

Gemini reads documents; this module decides what counts as a warning sign. Keeping the decisions in
code makes every flag reproducible, testable and explainable, and keeps arithmetic out of the model.
"""

from __future__ import annotations

import re

from dataclasses import dataclass, field

from rapidfuzz import fuzz

from app.schemas import (
    SEVERITY_ORDER,
    CheckContext,
    CountryPack,
    Evidence,
    ExtractedDocument,
    Flag,
    Money,
    RecruiterCheck,
    SourceRef,
    VerdictLevel,
    WorkerStatement,
)
from app.services.forensics import find_match
from app.services.privacy import normalize_name

# Generic red-flag visa types used when the destination pack has none.
DEFAULT_RED_FLAG_VISAS = {"visit", "tourist", "transit", "umrah", "hajj", "visitor"}
UNUSUALLY_LONG_WEEK = 60.0
SALARY_TOLERANCE = 0.98  # 2% rounding tolerance before flagging a salary gap


@dataclass
class RuleInput:
    documents: list[ExtractedDocument]
    statement: WorkerStatement | None
    context: CheckContext
    origin: CountryPack | None
    destination: CountryPack | None
    recruiter: RecruiterCheck | None = None
    known_fake_layouts: set[str] = field(default_factory=set)


def _ev(doc: ExtractedDocument, field_name: str, value: object) -> Evidence:
    return Evidence(doc_id=doc.doc_id, field=field_name, value=str(value))


def _monthly(m: Money) -> Money | None:
    factors = {"month": 1.0, "week": 52 / 12, "day": 26.0, "hour": None, "once": None}
    factor = factors[m.period]
    if factor is None:
        return None
    return Money(amount=round(m.amount * factor, 2), currency=m.currency, period="month")


def _pack_sources(pack: CountryPack | None) -> list[SourceRef]:
    if pack is None:
        return []
    return (pack.labour_rules.sources or pack.official_sources)[:2]


def _employment_docs(docs: list[ExtractedDocument]) -> list[ExtractedDocument]:
    return [d for d in docs if d.doc_type in ("contract", "offer_letter", "visa")]


def evaluate(inp: RuleInput) -> list[Flag]:
    flags: list[Flag] = []
    flags += _visa_type(inp)
    flags += _employer_consistency(inp)
    flags += _job_consistency(inp)
    flags += _salary(inp)
    flags += _passport(inp)
    flags += _hours(inp)
    flags += _essentials(inp)
    flags += _fees(inp)
    flags += _recruiter(inp)
    flags += _layout(inp)
    flags += _injection(inp)
    flags += _guaranteed_visa(inp)
    flags += _low_confidence(inp)
    flags += _unread(inp)
    # Stable order: most severe first, then by code.
    flags.sort(key=lambda f: (-SEVERITY_ORDER[f.severity], f.code))
    return flags


def _visa_type(inp: RuleInput) -> list[Flag]:
    if inp.context.purpose != "work":
        return []
    red = {v.lower() for v in (inp.destination.red_flag_visa_types if inp.destination else [])} or DEFAULT_RED_FLAG_VISAS
    out = []
    for d in inp.documents:
        vt = (d.visa_type or "").strip().lower()
        if vt and any(r == vt or r in vt for r in red):
            out.append(
                Flag(
                    code="VISA_TYPE_MISMATCH",
                    severity="high",
                    title="Visit-type visa for a job",
                    explanation=(
                        f"This visa is marked '{d.visa_type}', but you are going for work. Working on a visit "
                        "or religious visa is illegal in most countries and leaves you with no legal protection."
                    ),
                    evidence=[_ev(d, "visa_type", d.visa_type)],
                    sources=_pack_sources(inp.destination),
                    verify_with="The destination country's official visa platform",
                )
            )
    return out


def _employer_consistency(inp: RuleInput) -> list[Flag]:
    named = [(d, d.employer_name) for d in _employment_docs(inp.documents) if d.employer_name]
    if len(named) < 2:
        return []
    base_doc, base = named[0]
    out = []
    for d, name in named[1:]:
        score = fuzz.token_set_ratio(normalize_name(base), normalize_name(name))
        if score < 80:
            out.append(
                Flag(
                    code="EMPLOYER_NAME_MISMATCH",
                    severity="medium",
                    title="Employer name differs between documents",
                    explanation=(
                        f"One document names '{base}', another names '{name}'. Ask which company will employ "
                        "you and make sure the visa, offer and contract all name the same employer."
                    ),
                    evidence=[_ev(base_doc, "employer_name", base), _ev(d, "employer_name", name)],
                )
            )
    return out


def _job_consistency(inp: RuleInput) -> list[Flag]:
    promised = inp.statement.promised_job_title if inp.statement else None
    out = []
    for d in inp.documents:
        on_doc = d.visa_occupation if d.doc_type == "visa" else d.job_title
        if not promised or not on_doc:
            continue
        if fuzz.token_set_ratio(promised.lower(), on_doc.lower()) < 60:
            field_name = "visa_occupation" if d.doc_type == "visa" else "job_title"
            out.append(
                Flag(
                    code="JOB_TITLE_MISMATCH",
                    severity="medium",
                    title="Job on paper is not the job you were promised",
                    explanation=(
                        f"You were told '{promised}', but the {d.doc_type.replace('_', ' ')} says '{on_doc}'. "
                        "Workers are sometimes sent abroad as labourers after being promised skilled jobs."
                    ),
                    evidence=[_ev(d, field_name, on_doc)],
                )
            )
    return out


def _salary(inp: RuleInput) -> list[Flag]:
    out: list[Flag] = []
    contract_docs = [d for d in inp.documents if d.doc_type in ("contract", "offer_letter") and d.salary]
    promised = inp.statement.promised_salary if inp.statement else None
    rules = inp.destination.labour_rules if inp.destination else None

    for d in contract_docs:
        monthly = _monthly(d.salary)  # type: ignore[arg-type]
        if promised and monthly:
            p_monthly = _monthly(promised)
            if p_monthly and p_monthly.currency == monthly.currency:
                if monthly.amount < p_monthly.amount * SALARY_TOLERANCE:
                    gap_pct = round(100 * (1 - monthly.amount / p_monthly.amount))
                    out.append(
                        Flag(
                            code="SALARY_BELOW_PROMISE",
                            severity="high" if gap_pct >= 10 else "medium",
                            title="Salary is lower than promised",
                            explanation=(
                                f"You were promised {p_monthly.amount:,.0f} {p_monthly.currency} a month, but the "
                                f"document says {monthly.amount:,.0f} {monthly.currency} ({gap_pct}% less). "
                                "Do not sign until the written salary matches the promise."
                            ),
                            evidence=[_ev(d, "salary", f"{d.salary.amount:,.0f} {d.salary.currency}/{d.salary.period}")],  # type: ignore[union-attr]
                        )
                    )
            elif p_monthly:
                out.append(
                    Flag(
                        code="SALARY_CURRENCY_DIFFERS",
                        severity="low",
                        title="Promised salary and contract use different currencies",
                        explanation=(
                            f"The promise was in {p_monthly.currency} and the document is in {monthly.currency}. "
                            "Ask for the exact monthly amount in the contract's currency."
                        ),
                        evidence=[_ev(d, "salary", f"{d.salary.amount} {d.salary.currency}")],  # type: ignore[union-attr]
                    )
                )
        minimum = rules.minimum_monthly_wage if rules else None
        if minimum and monthly and minimum.currency == monthly.currency and monthly.amount < minimum.amount:
            out.append(
                Flag(
                    code="SALARY_BELOW_MINIMUM",
                    severity="high",
                    title="Salary below the legal minimum",
                    explanation=(
                        f"{monthly.amount:,.0f} {monthly.currency} is below the minimum of "
                        f"{minimum.amount:,.0f} {minimum.currency} listed for this country."
                    ),
                    evidence=[_ev(d, "salary", f"{d.salary.amount} {d.salary.currency}")],  # type: ignore[union-attr]
                    sources=_pack_sources(inp.destination),
                    verify_with="The destination labour ministry",
                )
            )
    return out


def _passport(inp: RuleInput) -> list[Flag]:
    out = []
    rules = inp.destination.labour_rules if inp.destination else None
    for d in inp.documents:
        if d.passport_held_by_employer:
            prohibited = rules.passport_retention_prohibited if rules else None
            explanation = (
                "The document lets the employer keep your passport. Without your passport you cannot leave "
                "or change jobs. "
            )
            explanation += (
                "This country's rules do not allow employers to keep passports."
                if prohibited
                else "Many countries forbid this; check the rule for your destination."
            )
            out.append(
                Flag(
                    code="PASSPORT_RETENTION",
                    severity="high",
                    title="Employer would keep your passport",
                    explanation=explanation,
                    evidence=[_ev(d, "passport_held_by_employer", True)],
                    sources=_pack_sources(inp.destination),
                    verify_with="The destination labour ministry or your embassy",
                )
            )
    return out


def _hours(inp: RuleInput) -> list[Flag]:
    out = []
    rules = inp.destination.labour_rules if inp.destination else None
    limit = rules.max_weekly_hours if rules and rules.max_weekly_hours else None
    for d in _employment_docs(inp.documents):
        if d.weekly_hours is None:
            continue
        if limit and d.weekly_hours > limit:
            out.append(
                Flag(
                    code="HOURS_ABOVE_LIMIT",
                    severity="medium",
                    title="Working hours above the legal limit",
                    explanation=f"{d.weekly_hours:.0f} hours a week is above the {limit:.0f}-hour limit listed for this country.",
                    evidence=[_ev(d, "weekly_hours", d.weekly_hours)],
                    sources=_pack_sources(inp.destination),
                )
            )
        elif not limit and d.weekly_hours > UNUSUALLY_LONG_WEEK:
            out.append(
                Flag(
                    code="HOURS_UNUSUALLY_LONG",
                    severity="medium",
                    title="Very long working week",
                    explanation=f"{d.weekly_hours:.0f} hours a week is unusually long. Ask how overtime is paid.",
                    evidence=[_ev(d, "weekly_hours", d.weekly_hours)],
                )
            )
    return out


def _essentials(inp: RuleInput) -> list[Flag]:
    contracts = [d for d in inp.documents if d.doc_type in ("contract", "offer_letter")]
    if not contracts:
        return []
    labels = {
        "accommodation_provided": "accommodation",
        "food_provided": "food or food allowance",
        "medical_covered": "medical cover",
        "return_ticket_provided": "return ticket",
    }
    missing: list[str] = []
    evidence: list[Evidence] = []
    for attr, label in labels.items():
        values = [getattr(d, attr) for d in contracts]
        if all(v is None for v in values) or any(v is False for v in values):
            missing.append(label)
            evidence.append(_ev(contracts[0], attr, "not stated" if all(v is None for v in values) else "no"))
    if not missing:
        return []
    return [
        Flag(
            code="ESSENTIALS_MISSING",
            severity="medium" if len(missing) >= 2 else "low",
            title="Basic terms missing from the contract",
            explanation="The contract does not clearly give you: " + ", ".join(missing) + ". Ask for these in writing.",
            evidence=evidence,
        )
    ]


def _fees(inp: RuleInput) -> list[Flag]:
    out: list[Flag] = []
    st = inp.statement
    fee = st.fee_asked if st else None
    doc_fee_docs = [d for d in inp.documents if d.fee_amount]
    if fee is None and doc_fee_docs:
        fee = doc_fee_docs[0].fee_amount
    cap = inp.origin.max_recruitment_fee if inp.origin else None
    cap_source = [inp.origin.max_recruitment_fee_source] if inp.origin and inp.origin.max_recruitment_fee_source else []

    if fee is not None:
        if cap and cap.currency == fee.currency:
            if fee.amount > cap.amount:
                out.append(
                    Flag(
                        code="FEE_ABOVE_LIMIT",
                        severity="high",
                        title="Fee above the official limit",
                        explanation=(
                            f"You were asked for {fee.amount:,.0f} {fee.currency}; the official limit is "
                            f"{cap.amount:,.0f} {cap.currency}. Don't pay more than the limit."
                        ),
                        sources=cap_source,
                        verify_with=inp.origin.regulator if inp.origin else None,
                    )
                )
        else:
            out.append(
                Flag(
                    code="FEE_UNVERIFIED",
                    severity="info",
                    title="Check the official fee",
                    explanation=(
                        f"You were asked for {fee.amount:,.0f} {fee.currency}. Ask the official office what a "
                        "licensed recruiter is allowed to charge before you pay."
                    ),
                    sources=(inp.origin.official_sources[:1] if inp.origin else []),
                    verify_with=inp.origin.regulator if inp.origin else None,
                )
            )
    if st and st.fee_paid_cash_only:
        out.append(
            Flag(
                code="CASH_ONLY_FEE",
                severity="medium",
                title="Fee asked in cash only",
                explanation="Asking for cash only leaves no record. Pay through a bank and keep the receipt.",
            )
        )
    if st and st.receipt_given is False:
        out.append(
            Flag(
                code="NO_RECEIPT",
                severity="medium",
                title="No receipt for money paid",
                explanation="Ask for a signed receipt with the recruiter's licence number for every payment.",
            )
        )
    return out


def _recruiter(inp: RuleInput) -> list[Flag]:
    rc = inp.recruiter
    if rc is None or rc.status == "not_checked":
        return []
    out: list[Flag] = []
    regulator = inp.origin.regulator if inp.origin else None
    src = inp.origin.official_sources[:1] if inp.origin else []
    sample_note = " (Checked against a sample list; import the official list before launch.)" if rc.list_is_sample else ""
    if rc.status == "not_found":
        out.append(
            Flag(
                code="RECRUITER_NOT_LICENSED",
                severity="high",
                title="Recruiter not found on the licensed list",
                explanation=f"'{rc.query_name or rc.query_license}' is not on the licensed list.{sample_note}",
                sources=src,
                verify_with=regulator,
            )
        )
    elif rc.status in ("licensed_suspended", "licensed_cancelled"):
        state = "suspended" if rc.status == "licensed_suspended" else "cancelled"
        out.append(
            Flag(
                code="RECRUITER_LICENSE_INACTIVE",
                severity="high",
                title=f"Recruiter's licence is {state}",
                explanation=f"{rc.match.name if rc.match else 'This recruiter'} has a {state} licence and may not recruit.{sample_note}",
                sources=src,
                verify_with=regulator,
            )
        )
    elif rc.status == "ambiguous":
        out.append(
            Flag(
                code="RECRUITER_IDENTITY_UNCLEAR",
                severity="medium",
                title="Recruiter's name and licence don't clearly match",
                explanation=(
                    "The name or licence number matches more than one firm, or the number belongs to a firm with a "
                    f"different name. Confirm the exact licence number with the office.{sample_note}"
                ),
                sources=src,
                verify_with=regulator,
            )
        )
    if rc.network_risk >= 0.6:
        out.append(
            Flag(
                code="RECRUITER_NETWORK_RISK",
                severity="high" if rc.network_risk >= 0.8 else "medium",
                title="Other workers reported problems linked to this recruiter",
                explanation="; ".join(rc.network_reasons) or "Linked to reported cases.",
            )
        )
    return out


def _layout(inp: RuleInput) -> list[Flag]:
    out = []
    for d in inp.documents:
        if find_match(d.layout_hash, inp.known_fake_layouts):
            out.append(
                Flag(
                    code="KNOWN_FAKE_LAYOUT",
                    severity="high",
                    title="Document matches a known fake",
                    explanation=(
                        "This page looks the same as documents other workers reported as fake. Check it on the "
                        "official platform before paying anything."
                    ),
                    evidence=[_ev(d, "layout_hash", d.layout_hash)],
                )
            )
    return out


def _injection(inp: RuleInput) -> list[Flag]:
    return [
        Flag(
            code="HIDDEN_INSTRUCTIONS",
            severity="medium",
            title="Document contains text aimed at automated checkers",
            explanation=(
                "We found wording that tries to instruct an AI system. We ignored it. Genuine documents do not "
                "contain this; treat the document with suspicion."
            ),
            evidence=[_ev(d, "injection_suspected", True)],
        )
        for d in inp.documents
        if d.injection_suspected
    ]


# "Guaranteed visa", "100% visa", "ویزا کی گارنٹی". Only the destination's government decides a visa,
# so a promise of one is a warning sign wherever it appears. Same pattern as lib/engine/rules.ts.
_GUARANTEE = re.compile(
    r"guarantee[ds]?\s+(?:(?:a|an|the|your|you|of)\s+)*(?:visa|approval|admission|selection)"
    r"|(?:visa|approval)\s+(?:is\s+)?(?:100\s*%\s*)?guaranteed"
    r"|100\s*%\s*(?:visa|guarantee[ds]?)"
    r"|ویز[اے].{0,24}(?:گارنٹی|ضمانت|یقینی)|(?:گارنٹی|ضمانت).{0,24}ویز[اے]",
    re.IGNORECASE,
)


def find_guarantee(texts: list[str | None]) -> str | None:
    for text in texts:
        if not text:
            continue
        m = _GUARANTEE.search(text)
        if m:
            return text[max(0, m.start() - 40) : m.end() + 40].strip()
    return None


def _guaranteed_visa(inp: RuleInput) -> list[Flag]:
    evidence: list[Evidence] = []
    for d in inp.documents:
        quote = find_guarantee([*d.notable_clauses, d.raw_text_excerpt])
        if quote:
            evidence.append(_ev(d, "notable_clauses", quote))
    st = inp.statement
    said = find_guarantee([*(st.other_claims if st else []), st.transcript if st else None])
    if said:
        evidence.append(Evidence(doc_id="statement", field="other_claims", value=said))
    if not evidence:
        return []
    return [
        Flag(
            code="VISA_GUARANTEED",
            severity="medium",
            title="Promise of a guaranteed visa",
            explanation=(
                "The paper or the agent promises that you will get a visa. Only the government of the country "
                "decides on a visa, so nobody can guarantee one. Treat this promise as a warning sign."
            ),
            evidence=evidence,
        )
    ]


UNREADABLE_BELOW = 0.3  # below this a paper is too unclear to stand behind a "looks OK" stamp


def _low_confidence(inp: RuleInput) -> list[Flag]:
    return [
        Flag(
            code="UNCLEAR_DOCUMENT",
            # A paper that could hardly be read must not end in a green stamp: nothing was really checked.
            severity="medium" if d.confidence < UNREADABLE_BELOW else "info",
            title="Part of a document was hard to read",
            explanation="Some values may be wrong. Retake the photo in good light, flat and in focus.",
            evidence=[_ev(d, "confidence", f"{d.confidence:.2f}")],
        )
        for d in inp.documents
        if d.confidence < 0.5 and not d.unread
    ]


def _unread(inp: RuleInput) -> list[Flag]:
    return [
        Flag(
            code="READER_UNAVAILABLE",
            # Nothing on the paper was checked, so the stamp cannot be green.
            severity="medium",
            title="This paper could not be read just now",
            explanation=(
                "The AI reader was not available, so nothing written on this paper was checked. This result "
                "uses only what you typed. Try again later, or type what the paper says."
            ),
            evidence=[_ev(d, "unread", True)],
        )
        for d in inp.documents
        if d.unread
    ]


# ---------------------------------------------------------------------------
# Verdict scoring
# ---------------------------------------------------------------------------

_WEIGHTS = {"high": 35, "medium": 15, "low": 5, "info": 0}


def score(flags: list[Flag]) -> tuple[VerdictLevel, int]:
    risk = min(100, sum(_WEIGHTS[f.severity] for f in flags))
    if any(f.severity == "high" for f in flags):
        level: VerdictLevel = "red"
    elif any(f.severity == "medium" for f in flags):
        level = "amber"
    else:
        level = "green"
    return level, risk


def next_steps(level: VerdictLevel, flags: list[Flag], origin: CountryPack | None) -> list[str]:
    codes = {f.code for f in flags}
    steps: list[str] = []
    if level == "red":
        steps.append("Do not pay or sign anything until the problems below are fixed in writing.")
    if codes & {"RECRUITER_NOT_LICENSED", "RECRUITER_LICENSE_INACTIVE", "RECRUITER_IDENTITY_UNCLEAR"}:
        office = origin.regulator if origin and origin.regulator else "the official emigration office"
        steps.append(f"Confirm the recruiter's licence number with {office}.")
    if "VISA_TYPE_MISMATCH" in codes:
        steps.append("Ask for a work visa. Do not travel to work on a visit or religious visa.")
    if codes & {"SALARY_BELOW_PROMISE", "JOB_TITLE_MISMATCH", "ESSENTIALS_MISSING"}:
        steps.append("Ask for the promised salary, job and benefits to be written into the contract.")
    if codes & {"CASH_ONLY_FEE", "NO_RECEIPT", "FEE_ABOVE_LIMIT", "FEE_UNVERIFIED"}:
        steps.append("Pay only through a bank, only the official fee, and keep every receipt.")
    if "PASSPORT_RETENTION" in codes:
        steps.append("Do not agree to give up your passport. Keep it yourself.")
    steps.append("Keep copies of everything in your vault and share them with a family member.")
    return steps


def top_reasons(flags: list[Flag], limit: int = 3) -> list[str]:
    return [f.title for f in flags if f.severity in ("high", "medium")][:limit]
