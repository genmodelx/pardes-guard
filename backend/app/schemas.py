"""Data contracts shared by services, agents, the API and the frontend.

Rule of thumb: every value the platform shows a worker carries either a source (official
content) or evidence (where in an uploaded document it came from).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, ClassVar, Literal, Union

from pydantic import BaseModel, Field, field_validator, model_validator

Severity = Literal["high", "medium", "low", "info"]
VerdictLevel = Literal["red", "amber", "green"]
ContentStatus = Literal["draft", "verified"]
Role = Literal["worker", "family", "ngo", "admin"]

SEVERITY_ORDER: dict[str, int] = {"high": 3, "medium": 2, "low": 1, "info": 0}


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------


class SourceRef(BaseModel):
    title: str
    url: str


class Money(BaseModel):
    amount: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    period: Literal["month", "week", "day", "hour", "once"] = "month"

    @field_validator("currency")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class Translatable(BaseModel):
    """Content that people read, with optional translations kept next to the English source.

    `i18n` maps a language code to the fields that are translated, for example
    `{"ur": {"title": "پاسپورٹ", "steps": ["...", "..."]}}`. English stays the source of truth;
    a field with no translation is shown in English. Keeping the two side by side means a reviewer
    who corrects the English sees the translation that must change with it.
    """

    i18n: dict[str, dict[str, str | list[str]]] = Field(default_factory=dict)

    # The fields a subclass allows to be translated: words people read. Ids, links, amounts, dates
    # and statuses are never translated.
    translatable: ClassVar[tuple[str, ...]] = ()

    @model_validator(mode="after")
    def _translations_match_fields(self) -> "Translatable":
        for locale, fields in self.i18n.items():
            for name, text in fields.items():
                if name not in type(self).model_fields:
                    raise ValueError(f"i18n.{locale}.{name}: no such field on {type(self).__name__}")
                if name not in type(self).translatable:
                    raise ValueError(f"i18n.{locale}.{name}: this field cannot be translated")
                source = getattr(self, name)
                if isinstance(source, list):
                    if not isinstance(text, list) or len(text) != len(source):
                        raise ValueError(
                            f"i18n.{locale}.{name}: needs a list with the same {len(source)} entries as the English list"
                        )
                elif isinstance(text, list):
                    raise ValueError(f"i18n.{locale}.{name}: the English field is text, so the translation must be text")
        return self


class Channel(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("name", "description")

    name: str
    url: str | None = None
    description: str | None = None


class User(BaseModel):
    id: str
    role: Role = "worker"
    phone_hash: str | None = None


# ---------------------------------------------------------------------------
# Documents and worker statements
# ---------------------------------------------------------------------------

DocType = Literal["contract", "offer_letter", "visa", "job_ad", "payslip", "receipt", "admission_letter", "other"]


class ExtractedDocument(BaseModel):
    """Structured reading of one uploaded document. Produced by the intake agent."""

    doc_id: str
    doc_type: DocType = "other"
    language: str | None = None
    employer_name: str | None = None
    employer_address: str | None = None
    recruiter_name: str | None = None
    recruiter_license_no: str | None = None
    recruiter_phones: list[str] = Field(default_factory=list)
    job_title: str | None = None
    visa_type: str | None = None
    visa_occupation: str | None = None
    destination_country: str | None = None
    salary: Money | None = None
    weekly_hours: float | None = Field(default=None, ge=0, le=168)
    contract_months: int | None = Field(default=None, ge=0, le=240)
    accommodation_provided: bool | None = None
    food_provided: bool | None = None
    medical_covered: bool | None = None
    return_ticket_provided: bool | None = None
    passport_held_by_employer: bool | None = None
    fee_amount: Money | None = None
    fee_account: str | None = None
    notable_clauses: list[str] = Field(default_factory=list)
    raw_text_excerpt: str | None = None
    # Text on the page that speaks to an AI or a checker instead of the reader. Never obeyed; any entry flags the document.
    instructions_to_ai: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0, le=1)
    injection_suspected: bool = False
    # True when no reader could read the paper (the AI was unavailable or failed): nothing on it was checked.
    unread: bool = False
    layout_hash: str | None = None  # perceptual hash of the page image, for template matching


class WorkerStatement(BaseModel):
    """What the worker says the recruiter promised, from a voice note or the form."""

    transcript: str | None = None
    language: str | None = None
    promised_salary: Money | None = None
    fee_asked: Money | None = None
    fee_paid_cash_only: bool | None = None
    receipt_given: bool | None = None
    recruiter_name: str | None = None
    recruiter_phone: str | None = None
    recruiter_license_no: str | None = None
    promised_job_title: str | None = None
    other_claims: list[str] = Field(default_factory=list)


class CheckContext(BaseModel):
    origin_country: str = "PK"
    destination_country: str | None = None
    purpose: Literal["work", "study", "visit"] = "work"
    reply_language: str = "ur"


# ---------------------------------------------------------------------------
# Flags, recruiters and verdicts
# ---------------------------------------------------------------------------


class Evidence(BaseModel):
    doc_id: str
    field: str
    value: str


class Flag(BaseModel):
    code: str
    severity: Severity
    title: str
    explanation: str
    evidence: list[Evidence] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    verify_with: str | None = None


class RecruiterRecord(BaseModel):
    license_no: str
    name: str
    city: str | None = None
    status: Literal["active", "suspended", "cancelled"] = "active"
    source: Literal["official_list", "sample"] = "sample"
    list_date: date | None = None
    rating_avg: float | None = None
    rating_count: int = 0


class RecruiterCheck(BaseModel):
    query_name: str | None = None
    query_license: str | None = None
    status: Literal[
        "licensed_active", "licensed_suspended", "licensed_cancelled", "not_found", "ambiguous", "not_checked"
    ]
    match: RecruiterRecord | None = None
    candidates: list[RecruiterRecord] = Field(default_factory=list)
    network_risk: float = Field(default=0.0, ge=0, le=1)
    network_reasons: list[str] = Field(default_factory=list)
    list_is_sample: bool = False


class Verdict(BaseModel):
    check_id: str
    created_at: datetime
    level: VerdictLevel
    risk_score: int = Field(ge=0, le=100)
    flags: list[Flag]
    top_reasons: list[str]
    next_steps: list[str]
    recruiter: RecruiterCheck | None = None
    documents: list[ExtractedDocument] = Field(default_factory=list)
    statement: WorkerStatement | None = None
    spoken_summary: str | None = None
    content_is_draft: bool = False
    disclaimer: str = (
        "This is information, not legal advice. It flags warning signs; it cannot prove a visa or "
        "contract is genuine. Verify with the official office before you pay or sign."
    )


# ---------------------------------------------------------------------------
# Country packs, visa routes, requirements
# ---------------------------------------------------------------------------


class TestThreshold(BaseModel):
    __test__ = False  # not a pytest test class

    test: str  # e.g. IELTS_GT, IELTS_ACADEMIC, CELPIP_G, PTE_CORE, JFT_BASIC, JLPT, EPS_TOPIK
    min_overall: float | None = None
    min_each: dict[str, float] | None = None  # skill -> minimum score
    min_level: str | None = None  # e.g. "N4" for JLPT
    level_order: list[str] | None = None  # lowest to highest, e.g. ["N5","N4","N3","N2","N1"]


class RangeRule(BaseModel):
    type: Literal["range"] = "range"
    field: str
    min: float | None = None
    max: float | None = None


class LevelRule(BaseModel):
    type: Literal["min_level"] = "min_level"
    field: str
    min: str
    order: list[str]


class LanguageRule(BaseModel):
    type: Literal["language_any_of"] = "language_any_of"
    options: list[TestThreshold]


class BoolRule(BaseModel):
    type: Literal["bool_true"] = "bool_true"
    field: str


RequirementRule = Annotated[Union[RangeRule, LevelRule, LanguageRule, BoolRule], Field(discriminator="type")]

RequirementKind = Literal[
    "language_test",
    "skills_test",
    "medical",
    "education",
    "age",
    "experience",
    "passport",
    "police_clearance",
    "financial",
    "registration",
    "other",
]


class Requirement(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("title", "description")

    id: str
    kind: RequirementKind
    title: str
    description: str
    rule: RequirementRule | None = None  # None = can't be checked automatically; shown as a manual check
    sources: list[SourceRef] = Field(default_factory=list)
    status: ContentStatus = "draft"
    last_verified: date | None = None


Actor = Literal["worker", "employer", "recruiter", "government", "university"]


class VisaStep(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("title", "description", "typical_duration")

    order: int
    # Stable id for remembering a person's progress. Defaults to "s<order>"; give real ids to routes
    # whose steps may be reordered later.
    id: str | None = None
    title: str
    description: str
    who: Actor = "worker"
    official_url: str | None = None
    typical_duration: str | None = None
    # Which part of the journey the step belongs to. A "departure" or "arrival" step is the short
    # version; when the origin pack has a departure checklist, or the destination pack an arrival
    # checklist, the app shows that fuller list instead.
    stage: Literal["visa", "departure", "arrival"] = "visa"


class FeeItem(Translatable):
    """One cost on a route. No number may be shown without the official source it was copied from."""

    translatable: ClassVar[tuple[str, ...]] = ("item", "note")

    id: str
    item: str
    amount: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    source: SourceRef | None = None
    last_verified: date | None = None
    # Who normally pays, when the official source says so. An agent charging a worker for a cost the
    # employer must pay is a warning sign.
    paid_by: Actor | None = None
    # Origin countries this cost applies to (for example a home-country registration). Empty = everyone.
    origins: list[str] = Field(default_factory=list)
    note: str | None = None

    @field_validator("currency")
    @classmethod
    def _upper_currency(cls, v: str | None) -> str | None:
        return v.upper() if v else v

    @field_validator("origins")
    @classmethod
    def _upper_origins(cls, v: list[str]) -> list[str]:
        return [c.upper() for c in v]

    @model_validator(mode="after")
    def _amount_needs_a_source(self) -> "FeeItem":
        if self.amount is not None and not (self.currency and self.source and self.last_verified):
            raise ValueError(f"fee '{self.id}': an amount needs a currency, a source and a last_verified date")
        return self


class VisaRoute(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("name", "summary", "documents", "interview_topics")

    id: str
    name: str
    purpose: Literal["work", "study", "skilled_migration", "seasonal"]
    summary: str
    steps: list[VisaStep] = Field(default_factory=list)
    documents: list[str] = Field(default_factory=list)
    # Ids of document guides (CountryPack.documents) this route needs. Looked up in the person's
    # origin pack first, then in this destination pack.
    document_ids: list[str] = Field(default_factory=list)
    fees: list[FeeItem] = Field(default_factory=list)
    # Subjects a visa or admission interview usually covers; used to build interview practice.
    interview_topics: list[str] = Field(default_factory=list)
    requirements: list[Requirement] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    status: ContentStatus = "draft"
    last_verified: date | None = None

    @model_validator(mode="after")
    def _steps_have_unique_ids(self) -> "VisaRoute":
        for step in self.steps:
            if not step.id:
                step.id = f"s{step.order}"
        ids = [s.id for s in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError(f"route '{self.id}': duplicate step id")
        fee_ids = [f.id for f in self.fees]
        if len(fee_ids) != len(set(fee_ids)):
            raise ValueError(f"route '{self.id}': duplicate fee id")
        return self


class LabourRules(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("notes",)

    passport_retention_prohibited: bool | None = None
    max_weekly_hours: float | None = None
    minimum_monthly_wage: Money | None = None
    notes: list[str] = Field(default_factory=list)
    sources: list[SourceRef] = Field(default_factory=list)
    status: ContentStatus = "draft"


class ChecklistItem(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("title", "description")

    id: str
    title: str
    description: str
    official_url: str | None = None
    who: Actor = "worker"
    # The document guide that explains how to do this item, when there is one.
    document_id: str | None = None
    # Route purposes this item applies to. Empty = everyone. A worker's emigration registration,
    # for example, must not be shown to a student.
    purposes: list[Literal["work", "study", "skilled_migration", "seasonal"]] = Field(default_factory=list)


class DocumentGuide(Translatable):
    """How to get one paper yourself: who issues it, where, what to bring, the steps and the official link.

    Leave a field empty when the official source has not been read yet. The app then says
    "not added yet" for that part instead of guessing.
    """

    translatable: ClassVar[tuple[str, ...]] = ("title", "summary", "issued_by", "steps", "bring", "typical_time")

    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    title: str
    # One plain sentence on what the paper is. Not a rule: rules belong in steps, with a source.
    summary: str | None = None
    issued_by: str | None = None
    online_or_office: Literal["online", "office", "both"] | None = None
    steps: list[str] = Field(default_factory=list)
    bring: list[str] = Field(default_factory=list)
    typical_time: str | None = None
    official_url: str | None = None
    sources: list[SourceRef] = Field(default_factory=list)
    status: ContentStatus = "draft"
    last_verified: date | None = None

    @model_validator(mode="after")
    def _verified_needs_proof(self) -> "DocumentGuide":
        if self.status == "verified" and not (self.sources and self.last_verified):
            raise ValueError(f"document '{self.id}': verified content needs a source and a last_verified date")
        return self


class CountryPack(Translatable):
    translatable: ClassVar[tuple[str, ...]] = ("name", "regulator")

    code: str = Field(min_length=2, max_length=2)
    name: str
    kind: Literal["origin", "destination", "both"]
    languages: list[str] = Field(default_factory=list)
    currency: str | None = None
    status: ContentStatus = "draft"
    last_verified: date | None = None
    official_sources: list[SourceRef] = Field(default_factory=list)
    regulator: str | None = None
    max_recruitment_fee: Money | None = None
    max_recruitment_fee_source: SourceRef | None = None
    departure_checklist: list[ChecklistItem] = Field(default_factory=list)
    # What to do in the first week after landing. Destination packs.
    arrival_checklist: list[ChecklistItem] = Field(default_factory=list)
    # Guides to the papers this country issues or asks for. Mostly origin packs.
    documents: list[DocumentGuide] = Field(default_factory=list)
    complaint_channels: list[Channel] = Field(default_factory=list)
    embassy_contacts: list[Channel] = Field(default_factory=list)
    labour_rules: LabourRules = Field(default_factory=LabourRules)
    red_flag_visa_types: list[str] = Field(default_factory=list)
    visa_routes: list[VisaRoute] = Field(default_factory=list)
    ladder_days: list[int] = Field(default_factory=lambda: [0, 7, 14])
    official_domains: list[str] = Field(default_factory=list)  # allowlist for the content refresh agent

    @field_validator("code")
    @classmethod
    def _upper_code(cls, v: str) -> str:
        return v.upper()

    @model_validator(mode="after")
    def _ids_are_unique(self) -> "CountryPack":
        for label, items in (
            ("document", self.documents),
            ("departure checklist", self.departure_checklist),
            ("arrival checklist", self.arrival_checklist),
        ):
            ids = [i.id for i in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"pack {self.code}: duplicate {label} id")
        return self


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------

EDUCATION_ORDER = [
    "none",
    "primary",
    "secondary",
    "higher_secondary",
    "diploma",
    "bachelor",
    "master",
    "phd",
]


class TestScore(BaseModel):
    __test__ = False  # not a pytest test class

    test: str
    overall: float | None = None
    components: dict[str, float] = Field(default_factory=dict)
    level: str | None = None


class Profile(BaseModel):
    age: int | None = Field(default=None, ge=14, le=80)
    education_level: str | None = None
    experience_years: float | None = Field(default=None, ge=0, le=60)
    occupation: str | None = None
    passport_valid_months: int | None = Field(default=None, ge=0, le=240)
    tests: list[TestScore] = Field(default_factory=list)
    has_skills_certificate: bool | None = None
    has_police_clearance: bool | None = None


class EligibilityItem(BaseModel):
    requirement_id: str
    title: str
    status: Literal["met", "not_met", "unknown", "manual_check"]
    explanation: str
    sources: list[SourceRef] = Field(default_factory=list)
    content_status: ContentStatus = "draft"


class EligibilityResult(BaseModel):
    country: str
    route_id: str
    route_name: str
    items: list[EligibilityItem]
    met: int
    not_met: int
    unknown: int
    content_is_draft: bool
    disclaimer: str = (
        "Based only on what you entered. Requirements change; always confirm on the official page before applying."
    )


# ---------------------------------------------------------------------------
# Wages
# ---------------------------------------------------------------------------


class WageCheckRequest(BaseModel):
    contract_salary: Money
    paid: Money
    expected_pay_day: int | None = Field(default=None, ge=1, le=31)
    paid_on: date | None = None
    period_month: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}$")  # YYYY-MM of the work month


class WageCheckResult(BaseModel):
    comparable: bool
    shortfall: Money | None = None
    shortfall_pct: float | None = None
    days_late: int | None = None
    flags: list[Flag] = Field(default_factory=list)
    recommend_case: bool = False


# ---------------------------------------------------------------------------
# Evidence and cases
# ---------------------------------------------------------------------------


class EvidenceRecord(BaseModel):
    id: str
    owner_id: str
    case_id: str | None = None
    index: int
    filename: str
    mime_type: str
    size: int
    sha256: str
    prev_hash: str
    record_hash: str
    signature: str
    signer: Literal["hmac", "kms"]
    created_at: datetime
    storage_uri: str | None = None
    note: str | None = None


CaseKind = Literal[
    "wage_short",
    "wage_late",
    "passport_held",
    "contract_changed",
    "recruiter_fraud",
    "fraud_ring_link",
    "emergency",
    "other",
]
CaseStatus = Literal["open", "escalating", "awaiting_approval", "resolved", "closed"]
StepStatus = Literal["scheduled", "awaiting_approval", "approved", "sent", "declined", "skipped"]
StepAction = Literal["notice_employer", "complaint_embassy", "handoff_legal_aid", "complaint_regulator"]


class LadderStep(BaseModel):
    index: int
    name: str
    action: StepAction
    due_at: datetime
    status: StepStatus = "scheduled"
    draft: str | None = None
    channel: str | None = None
    decided_at: datetime | None = None
    sent_at: datetime | None = None


class CaseEvent(BaseModel):
    at: datetime
    actor: str
    kind: str
    detail: str


class Case(BaseModel):
    id: str
    owner_id: str
    kind: CaseKind
    severity: Severity
    status: CaseStatus = "open"
    title: str
    summary: str
    origin_country: str = "PK"
    destination_country: str | None = None
    created_at: datetime
    updated_at: datetime
    ladder: list[LadderStep] = Field(default_factory=list)
    events: list[CaseEvent] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    related_check_id: str | None = None
    family_share_code: str | None = None
    needs_human_review: bool = False


class OpenCaseRequest(BaseModel):
    kind: CaseKind
    title: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=3, max_length=4000)
    destination_country: str | None = None
    origin_country: str = "PK"
    related_check_id: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Integrity network
# ---------------------------------------------------------------------------


class NetworkSignals(BaseModel):
    """Identifiers seen in one case. Raw values are hashed before they reach the graph."""

    case_id: str
    recruiter_license_no: str | None = None
    recruiter_name: str | None = None
    phones: list[str] = Field(default_factory=list)
    fee_accounts: list[str] = Field(default_factory=list)
    employer_name: str | None = None
    layout_hashes: list[str] = Field(default_factory=list)
    wage_problem: bool = False
    confirmed_fake_layout: bool = False


class Ring(BaseModel):
    id: str
    recruiters: list[str]
    shared_phones: int
    shared_accounts: int
    cases: int
    risk: float


class NetworkAlert(BaseModel):
    pattern: str
    severity: Severity
    description: str
    entities: list[str]


# ---------------------------------------------------------------------------
# Content operations
# ---------------------------------------------------------------------------


class ContentDraft(BaseModel):
    id: str
    country: str
    route_id: str | None = None
    kind: Literal["requirement", "step", "labour_rule"]
    payload: dict[str, Any]
    citations: list[SourceRef]
    created_at: datetime
    status: Literal["pending", "approved", "rejected"] = "pending"
    reviewer: str | None = None
    note: str | None = None
