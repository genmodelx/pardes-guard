"""NGO console and admin tools."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import require_role
from app.container import Container
from app.deps import get_container
from app.schemas import Case, ContentDraft, NetworkAlert, Ring, User
from app.services.cases import CaseError
from app.services.content import ContentError

ngo = APIRouter(prefix="/api/ngo", tags=["ngo"])
admin = APIRouter(prefix="/api/admin", tags=["admin"])

staff_user = require_role("ngo", "admin")
admin_user = require_role("admin")


@ngo.get("/queue", response_model=list[Case])
async def queue(user: User = Depends(staff_user), c: Container = Depends(get_container)) -> list[Case]:
    return c.cases.review_queue()


class ReviewRequest(BaseModel):
    note: str = Field(min_length=2, max_length=500)


@ngo.post("/cases/{case_id}/review", response_model=Case)
async def review(case_id: str, body: ReviewRequest, user: User = Depends(staff_user), c: Container = Depends(get_container)) -> Case:
    try:
        return c.cases.mark_reviewed(case_id, user, body.note)
    except CaseError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@ngo.get("/network/rings", response_model=list[Ring])
async def rings(user: User = Depends(staff_user), c: Container = Depends(get_container)) -> list[Ring]:
    return c.graph.rings()


@ngo.get("/network/alerts", response_model=list[NetworkAlert])
async def alerts(user: User = Depends(staff_user), c: Container = Depends(get_container)) -> list[NetworkAlert]:
    return c.graph.alerts()


class FakeLayoutRequest(BaseModel):
    layout_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


@ngo.post("/network/fake-layouts", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_fake_layout(body: FakeLayoutRequest, user: User = Depends(staff_user), c: Container = Depends(get_container)) -> None:
    """Staff confirm a reported document layout is fake; future uploads with that layout are flagged at once."""
    c.graph.confirm_fake_layout(body.layout_hash)


# --- Admin --------------------------------------------------------------------


class ImportResult(BaseModel):
    imported: int
    source: str


@admin.post("/recruiters/import", response_model=ImportResult)
async def import_recruiters(
    file: Annotated[UploadFile, File(description="CSV with license_no,name,status[,city,list_date]")],
    user: User = Depends(admin_user),
    c: Container = Depends(get_container),
) -> ImportResult:
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV larger than 5 MB")
    try:
        text = raw.decode("utf-8-sig")
        n = c.recruiters.load_csv_text(text, source="official_list")
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not import: {exc}") from exc
    return ImportResult(imported=n, source="official_list")


class RefreshRequest(BaseModel):
    country: str = Field(min_length=2, max_length=2)
    route_id: str = Field(min_length=2, max_length=60)


@admin.post("/content/refresh", response_model=list[ContentDraft])
async def refresh(body: RefreshRequest, user: User = Depends(admin_user), c: Container = Depends(get_container)) -> list[ContentDraft]:
    try:
        return await c.content.refresh(body.country, body.route_id)
    except ContentError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@admin.get("/content/drafts", response_model=list[ContentDraft])
async def drafts(user: User = Depends(admin_user), c: Container = Depends(get_container)) -> list[ContentDraft]:
    return c.content.pending()


class ApproveRequest(BaseModel):
    rule: dict | None = None
    edits: dict | None = None


_ALLOWED_EDITS = {"title", "description", "kind", "sources"}


@admin.post("/content/drafts/{draft_id}/approve", response_model=ContentDraft)
async def approve(draft_id: str, body: ApproveRequest, user: User = Depends(admin_user), c: Container = Depends(get_container)) -> ContentDraft:
    if body.edits and not set(body.edits).issubset(_ALLOWED_EDITS):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Editable fields: {', '.join(sorted(_ALLOWED_EDITS))}")
    if body.edits and "sources" in body.edits:
        for s in body.edits["sources"]:
            if not re.match(r"^https://", str(s.get("url", ""))):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sources must be https links")
    try:
        return c.content.approve(draft_id, user, rule=body.rule, edits=body.edits)
    except ContentError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except ValueError as exc:  # invalid rule or requirement
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


class RejectRequest(BaseModel):
    note: str = Field(min_length=2, max_length=500)


@admin.post("/content/drafts/{draft_id}/reject", response_model=ContentDraft)
async def reject(draft_id: str, body: RejectRequest, user: User = Depends(admin_user), c: Container = Depends(get_container)) -> ContentDraft:
    try:
        return c.content.reject(draft_id, user, body.note)
    except ContentError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
