"""Cases, the escalation ladder, the evidence vault and the family view."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import current_user, scheduler_only
from app.container import Container
from app.deps import client_key, get_container, public_limiter, read_upload
from app.schemas import Case, EvidenceRecord, NetworkSignals, OpenCaseRequest, User
from app.services.cases import CaseError

router = APIRouter(prefix="/api", tags=["cases"])


def _err(exc: CaseError) -> HTTPException:
    return HTTPException(exc.status_code, str(exc))


@router.post("/cases", response_model=Case, status_code=status.HTTP_201_CREATED)
async def open_case(body: OpenCaseRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    owned = {r.id for r in c.vault.records(user.id)}
    if any(e not in owned for e in body.evidence_ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Evidence must come from your own vault")
    case = c.cases.open(user, body)
    # A fraud report feeds the integrity network with the identifiers from the related check.
    if body.kind in ("recruiter_fraud", "fraud_ring_link") and body.related_check_id:
        verdict = c.pipeline.get_check(user, body.related_check_id)
        if verdict and verdict.recruiter and (verdict.recruiter.query_name or verdict.recruiter.query_license):
            c.graph.ingest(
                NetworkSignals(
                    case_id=case.id,
                    recruiter_license_no=verdict.recruiter.query_license
                    or (verdict.recruiter.match.license_no if verdict.recruiter.match else None),
                    recruiter_name=verdict.recruiter.query_name,
                    layout_hashes=[d.layout_hash for d in verdict.documents if d.layout_hash],
                ),
                fraud_case=True,
            )
    if body.kind in ("wage_short", "wage_late") and body.related_check_id:
        verdict = c.pipeline.get_check(user, body.related_check_id)
        employer = next((d.employer_name for d in verdict.documents if d.employer_name), None) if verdict else None
        if employer:
            c.graph.ingest(NetworkSignals(case_id=case.id, employer_name=employer, wage_problem=True))
    return case


@router.get("/cases", response_model=list[Case])
async def my_cases(user: User = Depends(current_user), c: Container = Depends(get_container)) -> list[Case]:
    return c.cases.list_for(user)


@router.get("/cases/{case_id}", response_model=Case)
async def get_case(case_id: str, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.get_for(case_id, user)
    except CaseError as exc:
        raise _err(exc) from exc


class DraftUpdate(BaseModel):
    text: str = Field(min_length=10, max_length=6000)


@router.put("/cases/{case_id}/steps/{index}/draft", response_model=Case)
async def edit_draft(case_id: str, index: int, body: DraftUpdate, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.update_draft(case_id, index, user, c.masker(body.text) or body.text)
    except CaseError as exc:
        raise _err(exc) from exc


class RedraftRequest(BaseModel):
    language: str = Field(default="en", max_length=5)


@router.post("/cases/{case_id}/steps/{index}/redraft", response_model=Case)
async def redraft(case_id: str, index: int, body: RedraftRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    """Ask Gemini to rewrite the waiting draft, for example in Arabic for an employer."""
    try:
        case = c.cases.get_for(case_id, user)
        if index < 0 or index >= len(case.ladder) or case.ladder[index].status != "awaiting_approval":
            raise CaseError("This step is not waiting for approval", 409)
        text = await c.llm.draft_letter(case, case.ladder[index], body.language)
        return c.cases.update_draft(case_id, index, user, text)
    except CaseError as exc:
        raise _err(exc) from exc


@router.post("/cases/{case_id}/steps/{index}/approve", response_model=Case)
async def approve(case_id: str, index: int, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return await c.cases.approve(case_id, index, user)
    except CaseError as exc:
        raise _err(exc) from exc


@router.post("/cases/{case_id}/steps/{index}/decline", response_model=Case)
async def decline(case_id: str, index: int, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.decline(case_id, index, user)
    except CaseError as exc:
        raise _err(exc) from exc


class SentRequest(BaseModel):
    channel: str = Field(min_length=2, max_length=60)


@router.post("/cases/{case_id}/steps/{index}/sent", response_model=Case)
async def mark_sent(case_id: str, index: int, body: SentRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.mark_sent(case_id, index, user, body.channel)
    except CaseError as exc:
        raise _err(exc) from exc


class ResolveRequest(BaseModel):
    note: str = Field(default="", max_length=500)


@router.post("/cases/{case_id}/resolve", response_model=Case)
async def resolve(case_id: str, body: ResolveRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.resolve(case_id, user, body.note)
    except CaseError as exc:
        raise _err(exc) from exc


class AttachRequest(BaseModel):
    evidence_id: str


@router.post("/cases/{case_id}/evidence", response_model=Case)
async def attach(case_id: str, body: AttachRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Case:
    if c.vault.get(user.id, body.evidence_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found in your vault")
    try:
        return c.cases.attach_evidence(case_id, user, body.evidence_id)
    except CaseError as exc:
        raise _err(exc) from exc


class ShareResponse(BaseModel):
    code: str


@router.post("/cases/{case_id}/share", response_model=ShareResponse)
async def share(case_id: str, user: User = Depends(current_user), c: Container = Depends(get_container)) -> ShareResponse:
    try:
        return ShareResponse(code=c.cases.share_with_family(case_id, user))
    except CaseError as exc:
        raise _err(exc) from exc


@router.get("/family/{code}")
async def family_view(code: str, request: Request, c: Container = Depends(get_container)) -> dict:
    public_limiter.check(client_key(request))
    try:
        return c.cases.family_view(code)
    except CaseError as exc:
        raise _err(exc) from exc


class TickResult(BaseModel):
    changed: int


@router.post("/cases/tick", response_model=TickResult, dependencies=[Depends(scheduler_only)])
async def tick(c: Container = Depends(get_container)) -> TickResult:
    return TickResult(changed=c.cases.tick())


# --- Evidence vault -----------------------------------------------------------


@router.post("/vault", response_model=EvidenceRecord, status_code=status.HTTP_201_CREATED)
async def add_evidence(
    file: Annotated[UploadFile, File()],
    case_id: Annotated[str | None, Form(max_length=40)] = None,
    note: Annotated[str | None, Form(max_length=200)] = None,
    user: User = Depends(current_user),
    c: Container = Depends(get_container),
) -> EvidenceRecord:
    validated = await read_upload(file, c.settings.max_upload_mb * 1024 * 1024)
    if case_id:
        try:
            c.cases.get_for(case_id, user)
        except CaseError as exc:
            raise _err(exc) from exc
    record = c.vault.add(user.id, validated, case_id=case_id, note=c.masker(note) if note else None)
    if case_id:
        c.cases.attach_evidence(case_id, user, record.id)
    return record


@router.get("/vault", response_model=list[EvidenceRecord])
async def list_evidence(user: User = Depends(current_user), c: Container = Depends(get_container)) -> list[EvidenceRecord]:
    return c.vault.records(user.id)


@router.get("/vault/verify")
async def verify_vault(user: User = Depends(current_user), c: Container = Depends(get_container)) -> dict:
    return c.vault.verify(user.id)


@router.get("/vault/export")
async def export_vault(user: User = Depends(current_user), c: Container = Depends(get_container)) -> Response:
    data = c.vault.export_bundle(user.id)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="pardes-guard-evidence.zip"'},
    )
