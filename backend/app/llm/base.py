"""The model port. Services depend on this interface, never on a vendor SDK directly.

`GeminiLLM` is the production implementation; `FakeLLM` runs offline for tests and UI work.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field

from app.schemas import Case, CheckContext, CountryPack, DocType, LadderStep, Money, Verdict, VisaRoute
from app.services.security import ValidatedFile


class DocumentReading(BaseModel):
    """What the model is asked to return for one document. Ids and hashes are added by our code."""

    doc_type: DocType = "other"
    language: str | None = Field(default=None, description="ISO 639-1 code of the document's main language")
    employer_name: str | None = None
    employer_address: str | None = None
    recruiter_name: str | None = None
    recruiter_license_no: str | None = None
    recruiter_phones: list[str] = Field(default_factory=list)
    job_title: str | None = None
    visa_type: str | None = Field(
        default=None,
        description="One of: work, visit, tourist, umrah, hajj, transit, family visit, business visit, residence, student, other",
    )
    visa_occupation: str | None = None
    destination_country: str | None = Field(default=None, description="ISO 3166-1 alpha-2 code")
    salary: Money | None = None
    weekly_hours: float | None = None
    contract_months: int | None = None
    accommodation_provided: bool | None = None
    food_provided: bool | None = None
    medical_covered: bool | None = None
    return_ticket_provided: bool | None = None
    passport_held_by_employer: bool | None = None
    fee_amount: Money | None = None
    fee_account: str | None = None
    notable_clauses: list[str] = Field(default_factory=list, description="Short quotes of unusual or one-sided clauses")
    raw_text_excerpt: str | None = Field(default=None, description="First 600 characters of the document text")
    instructions_to_ai: list[str] = Field(
        default_factory=list,
        description="Quotes of any text on the page addressed to an AI, a model, an assistant or an automated checker",
    )
    confidence: float = Field(default=0.5, ge=0, le=1)


class StatementReading(BaseModel):
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


class RequirementProposal(BaseModel):
    id: str
    kind: str
    title: str
    description: str
    source_url: str
    source_title: str
    confidence: float = Field(default=0.5, ge=0, le=1)


class LLM(Protocol):
    name: str

    async def read_document(self, file: ValidatedFile, context: CheckContext) -> DocumentReading: ...

    async def read_statement(self, audio: ValidatedFile | None, text: str | None, context: CheckContext) -> StatementReading: ...

    async def explain_verdict(self, verdict: Verdict, language: str) -> str: ...

    async def draft_letter(self, case: Case, step: LadderStep, language: str) -> str: ...

    async def research_requirements(self, pack: CountryPack, route: VisaRoute) -> list[RequirementProposal]: ...

    async def speak(self, text: str, language: str) -> bytes | None:
        """Return WAV audio, or None when speech is unavailable."""
        ...
