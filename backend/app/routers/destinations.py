"""Country guides: visa routes, steps, documents, requirements (IELTS and other tests) and eligibility."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.container import Container
from app.deps import client_key, get_container, public_limiter
from app.schemas import ChecklistItem, Channel, CountryPack, EligibilityResult, Profile, VisaRoute
from app.services.eligibility import evaluate_route

router = APIRouter(prefix="/api", tags=["destinations"])


class RouteSummary(BaseModel):
    id: str
    name: str
    purpose: str
    status: str
    requirement_count: int
    language_tests: list[str]


class CountrySummary(BaseModel):
    code: str
    name: str
    kind: str
    status: str
    currency: str | None
    routes: list[RouteSummary]


def _summary(p: CountryPack) -> CountrySummary:
    routes = []
    for r in p.visa_routes:
        tests: list[str] = []
        for q in r.requirements:
            if q.rule is not None and q.rule.type == "language_any_of":
                tests += [o.test for o in q.rule.options]
        routes.append(
            RouteSummary(
                id=r.id, name=r.name, purpose=r.purpose, status=r.status,
                requirement_count=len(r.requirements), language_tests=sorted(set(tests)),
            )
        )
    return CountrySummary(code=p.code, name=p.name, kind=p.kind, status=p.status, currency=p.currency, routes=routes)


def _public_pack(p: CountryPack) -> dict:
    # official_domains is an internal allowlist for the research agent; not useful to workers.
    return p.model_dump(mode="json", exclude={"official_domains"})


@router.get("/countries", response_model=list[CountrySummary])
async def list_countries(
    request: Request, kind: Literal["origin", "destination", "all"] = "destination", c: Container = Depends(get_container)
) -> list[CountrySummary]:
    public_limiter.check(client_key(request))
    packs = c.packs.all() if kind == "all" else (c.packs.destinations() if kind == "destination" else c.packs.origins())
    return [_summary(p) for p in packs]


@router.get("/countries/{code}")
async def get_country(code: str, request: Request, c: Container = Depends(get_container)) -> dict:
    public_limiter.check(client_key(request))
    pack = c.packs.get(code)
    if pack is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Country not available yet")
    return _public_pack(pack)


@router.get("/countries/{code}/routes/{route_id}", response_model=VisaRoute)
async def get_route(code: str, route_id: str, request: Request, c: Container = Depends(get_container)) -> VisaRoute:
    public_limiter.check(client_key(request))
    route = c.packs.route(code, route_id)
    if route is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Route not found")
    return route


class OriginGuide(BaseModel):
    code: str
    name: str
    regulator: str | None
    departure_checklist: list[ChecklistItem]
    complaint_channels: list[Channel]
    status: str


@router.get("/origins/{code}/guide", response_model=OriginGuide)
async def origin_guide(code: str, request: Request, c: Container = Depends(get_container)) -> OriginGuide:
    public_limiter.check(client_key(request))
    pack = c.packs.get(code)
    if pack is None or pack.kind == "destination":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Origin country not available yet")
    return OriginGuide(
        code=pack.code, name=pack.name, regulator=pack.regulator, departure_checklist=pack.departure_checklist,
        complaint_channels=pack.complaint_channels, status=pack.status,
    )


class EligibilityRequest(BaseModel):
    country: str
    route_id: str
    profile: Profile


@router.post("/eligibility", response_model=EligibilityResult)
async def eligibility(body: EligibilityRequest, request: Request, c: Container = Depends(get_container)) -> EligibilityResult:
    public_limiter.check(client_key(request))
    route = c.packs.route(body.country, body.route_id)
    if route is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Route not found")
    return evaluate_route(body.country.upper(), route, body.profile)


class CompareRequest(BaseModel):
    profile: Profile
    purpose: Literal["work", "study", "skilled_migration", "seasonal", "any"] = "any"


@router.post("/eligibility/compare", response_model=list[EligibilityResult])
async def compare(body: CompareRequest, request: Request, c: Container = Depends(get_container)) -> list[EligibilityResult]:
    """Run the profile against every route, best matches first: 'where could I go?'."""
    public_limiter.check(client_key(request))
    results = [
        evaluate_route(p.code, r, body.profile)
        for p in c.packs.destinations()
        for r in p.visa_routes
        if body.purpose == "any" or r.purpose == body.purpose
    ]
    results.sort(key=lambda x: (x.not_met, -x.met, x.unknown))
    return results
