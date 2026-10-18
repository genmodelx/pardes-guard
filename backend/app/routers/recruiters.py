"""Verified recruiter directory and wage checks."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import current_user
from app.container import Container
from app.deps import client_key, get_container, public_limiter
from app.schemas import RecruiterCheck, RecruiterRecord, User, WageCheckRequest, WageCheckResult
from app.services.recruiters import normalize_license
from app.services.wage import check_wage

router = APIRouter(prefix="/api", tags=["recruiters"])

RATINGS = "recruiter_ratings"


def _with_ratings(c: Container, record: RecruiterRecord) -> RecruiterRecord:
    rows = c.store.where(RATINGS, "license_no", record.license_no, limit=5000)
    if not rows:
        return record
    avg = sum(r["stars"] for r in rows) / len(rows)
    return record.model_copy(update={"rating_avg": round(avg, 1), "rating_count": len(rows)})


class DirectoryResult(BaseModel):
    source: str
    list_is_sample: bool
    loaded_on: str | None
    results: list[RecruiterRecord]


@router.get("/recruiters", response_model=DirectoryResult)
async def search(request: Request, q: str = Query(min_length=2, max_length=120), c: Container = Depends(get_container)) -> DirectoryResult:
    public_limiter.check(client_key(request))
    records = [_with_ratings(c, r) for r in c.recruiters.search(q)]
    return DirectoryResult(
        source=c.recruiters.source,
        list_is_sample=c.recruiters.source != "official_list",
        loaded_on=c.recruiters.loaded_on.isoformat() if c.recruiters.loaded_on else None,
        results=records,
    )


@router.get("/recruiters/check", response_model=RecruiterCheck)
async def check(
    request: Request,
    name: str | None = Query(default=None, max_length=160),
    license_no: str | None = Query(default=None, max_length=60),
    c: Container = Depends(get_container),
) -> RecruiterCheck:
    public_limiter.check(client_key(request))
    result = c.recruiters.check(name, license_no)
    if result.status != "not_checked":
        lic = license_no or (result.match.license_no if result.match else None)
        result.network_risk, result.network_reasons = c.graph.recruiter_risk(lic, name)
    if result.match:
        result.match = _with_ratings(c, result.match)
    return result


class RatingRequest(BaseModel):
    stars: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)


@router.post("/recruiters/{license_no}/rating", status_code=status.HTTP_204_NO_CONTENT)
async def rate(license_no: str, body: RatingRequest, user: User = Depends(current_user), c: Container = Depends(get_container)) -> None:
    record = c.recruiters.by_license(license_no)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recruiter not on the licensed list")
    lic = normalize_license(license_no)
    c.store.put(
        RATINGS,
        f"{lic}_{user.id}",  # one rating per worker per recruiter; a new rating replaces the old one
        {
            "license_no": lic,
            "user_id": user.id,
            "stars": body.stars,
            "comment": c.masker(body.comment) if body.comment else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )


@router.post("/wage/check", response_model=WageCheckResult)
async def wage_check(body: WageCheckRequest, user: User = Depends(current_user)) -> WageCheckResult:
    return check_wage(body)
