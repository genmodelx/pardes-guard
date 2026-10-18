"""Tools the ADK agents can call. Each wraps a deterministic service, so agents never invent facts.

Tools read the signed-in user from session state ("owner_id", "role"), which the API sets when it
creates the session. Tools never take a user id from the model.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Callable

from google.adk.tools import ToolContext

from app.container import Container
from app.schemas import Money, OpenCaseRequest, Profile, TestScore, User, WageCheckRequest
from app.services.cases import CaseError
from app.services.eligibility import evaluate_route
from app.services.wage import check_wage

CASE_KINDS = ["wage_short", "wage_late", "passport_held", "contract_changed", "recruiter_fraud", "emergency", "other"]


def _user(tool_context: ToolContext) -> User:
    state = tool_context.state
    return User(id=str(state.get("owner_id", "anonymous")), role=state.get("role", "worker"))


def build_tools(c: Container) -> dict[str, Callable[..., Any]]:
    """Return the tool functions keyed by name. Docstrings are what the model sees."""

    def list_destinations(purpose: str = "any") -> dict:
        """List countries and visa routes the platform covers.

        Args:
            purpose: "work", "study", "skilled_migration" or "any".
        """
        out = []
        for p in c.packs.destinations():
            routes = [
                {"route_id": r.id, "name": r.name, "purpose": r.purpose, "content_status": r.status}
                for r in p.visa_routes
                if purpose == "any" or r.purpose == purpose
            ]
            if routes:
                out.append({"country_code": p.code, "country": p.name, "routes": routes})
        return {"destinations": out}

    def get_visa_route(country_code: str, route_id: str) -> dict:
        """Get the official steps, documents and requirements (including language tests such as IELTS) for a visa route.

        Args:
            country_code: Two-letter country code, e.g. "SA", "CA", "JP".
            route_id: Route id from list_destinations, e.g. "ca-express-entry-fsw".
        """
        route = c.packs.route(country_code, route_id)
        if route is None:
            return {"error": "Route not found. Call list_destinations first."}
        return {
            "route": route.model_dump(mode="json"),
            "note": "Content marked draft has not yet been verified by a reviewer; say so when you use it.",
        }

    def check_eligibility(
        country_code: str,
        route_id: str,
        age: int | None = None,
        education_level: str | None = None,
        experience_years: float | None = None,
        passport_valid_months: int | None = None,
        test_name: str | None = None,
        test_overall: float | None = None,
        test_listening: float | None = None,
        test_reading: float | None = None,
        test_writing: float | None = None,
        test_speaking: float | None = None,
        test_level: str | None = None,
        has_skills_certificate: bool | None = None,
    ) -> dict:
        """Compare what the person told you with a route's listed requirements. Never conclude they are eligible.

        Args:
            country_code: Two-letter country code.
            route_id: Route id from list_destinations.
            age: Age in years.
            education_level: one of none, primary, secondary, higher_secondary, diploma, bachelor, master, phd.
            experience_years: Years of relevant work experience.
            passport_valid_months: Months of validity left on the passport.
            test_name: Test taken, e.g. IELTS_GT, IELTS_ACADEMIC, CELPIP_G, PTE_CORE, JFT_BASIC, JLPT, EPS_TOPIK.
            test_overall: Overall score, if known.
            test_listening: Listening score.
            test_reading: Reading score.
            test_writing: Writing score.
            test_speaking: Speaking score.
            test_level: Level for level-based tests, e.g. "N4" or "A2".
            has_skills_certificate: Whether they hold the skills certificate or assessment the route needs.
        """
        route = c.packs.route(country_code, route_id)
        if route is None:
            return {"error": "Route not found."}
        tests = []
        if test_name:
            comps = {
                k: v
                for k, v in {
                    "listening": test_listening, "reading": test_reading,
                    "writing": test_writing, "speaking": test_speaking,
                }.items()
                if v is not None
            }
            tests.append(TestScore(test=test_name.upper(), overall=test_overall, components=comps, level=test_level))
        profile = Profile(
            age=age, education_level=education_level, experience_years=experience_years,
            passport_valid_months=passport_valid_months, tests=tests, has_skills_certificate=has_skills_certificate,
        )
        return evaluate_route(country_code.upper(), route, profile).model_dump(mode="json")

    def check_recruiter(name: str | None = None, license_no: str | None = None) -> dict:
        """Check a recruiter against the licensed list and the integrity network.

        Args:
            name: The recruiter or agency name as the worker knows it.
            license_no: The licence number, if the worker has it.
        """
        result = c.recruiters.check(name, license_no)
        if result.status != "not_checked":
            lic = license_no or (result.match.license_no if result.match else None)
            result.network_risk, result.network_reasons = c.graph.recruiter_risk(lic, name)
        out = result.model_dump(mode="json")
        if result.list_is_sample:
            out["warning"] = "The licensed list loaded is a fictional sample; tell the user to confirm with the official office."
        return out

    def get_check_result(check_id: str, tool_context: ToolContext) -> dict:
        """Read the result of a document check the user ran in the app (they upload documents there).

        Args:
            check_id: The check id shown in the app, e.g. "chk_..."
        """
        verdict = c.pipeline.get_check(_user(tool_context), check_id)
        if verdict is None:
            return {"error": "No such check for this user."}
        return {
            "level": verdict.level,
            "flags": [{"title": f.title, "severity": f.severity, "why": f.explanation} for f in verdict.flags],
            "next_steps": verdict.next_steps,
            "disclaimer": verdict.disclaimer,
        }

    def check_wage_payment(
        contract_amount: float,
        contract_currency: str,
        paid_amount: float,
        paid_currency: str,
        expected_pay_day: int | None = None,
        paid_on: str | None = None,
        period_month: str | None = None,
    ) -> dict:
        """Compare a salary payment with the contract.

        Args:
            contract_amount: Monthly salary in the contract.
            contract_currency: ISO code, e.g. SAR.
            paid_amount: Amount actually paid for that month.
            paid_currency: ISO code of the payment.
            expected_pay_day: Day of the month pay is due (in the following month).
            paid_on: Date it was paid, YYYY-MM-DD.
            period_month: The work month the pay is for, YYYY-MM.
        """
        try:
            req = WageCheckRequest(
                contract_salary=Money(amount=contract_amount, currency=contract_currency),
                paid=Money(amount=paid_amount, currency=paid_currency),
                expected_pay_day=expected_pay_day,
                paid_on=date.fromisoformat(paid_on) if paid_on else None,
                period_month=period_month,
            )
        except ValueError as exc:
            return {"error": f"Invalid input: {exc}"}
        return check_wage(req).model_dump(mode="json")

    def open_case(
        kind: str,
        title: str,
        summary: str,
        tool_context: ToolContext,
        destination_country: str | None = None,
        related_check_id: str | None = None,
    ) -> dict:
        """Open a case for the user. This prepares drafts only; nothing is sent until the user approves each step in the app.

        Args:
            kind: One of wage_short, wage_late, passport_held, contract_changed, recruiter_fraud, emergency, other.
            title: Short title in the user's words.
            summary: What happened, with dates and amounts the user gave.
            destination_country: Two-letter code of the country they work in.
            related_check_id: A document check id, if there is one.
        """
        if kind not in CASE_KINDS:
            return {"error": f"kind must be one of {CASE_KINDS}"}
        user = _user(tool_context)
        try:
            case = c.cases.open(
                user,
                OpenCaseRequest(
                    kind=kind, title=title[:160], summary=summary[:4000],  # type: ignore[arg-type]
                    destination_country=destination_country, related_check_id=related_check_id,
                ),
            )
        except (CaseError, ValueError) as exc:
            return {"error": str(exc)}
        waiting = next((s.name for s in case.ladder if s.status == "awaiting_approval"), None)
        return {
            "case_id": case.id,
            "status": case.status,
            "waiting_for_approval": waiting,
            "note": "Tell the user to open the case in the app to read and approve the draft. Nothing has been sent.",
        }

    def list_my_cases(tool_context: ToolContext) -> dict:
        """List the user's cases and what each is waiting for."""
        cases = c.cases.list_for(_user(tool_context))
        return {
            "cases": [
                {
                    "case_id": k.id, "title": k.title, "status": k.status,
                    "waiting_for_approval": next((s.name for s in k.ladder if s.status == "awaiting_approval"), None),
                }
                for k in cases[:20]
            ]
        }

    def departure_checklist(origin_country: str = "PK") -> dict:
        """Official steps to complete in the home country before leaving for work abroad.

        Args:
            origin_country: Two-letter code of the home country, e.g. "PK" or "PH".
        """
        pack = c.packs.get(origin_country)
        if pack is None:
            return {"error": "Country not covered yet."}
        return {
            "regulator": pack.regulator,
            "checklist": [i.model_dump(mode="json") for i in pack.departure_checklist],
            "complaint_channels": [ch.model_dump(mode="json") for ch in pack.complaint_channels],
            "content_status": pack.status,
        }

    return {
        f.__name__: f
        for f in (
            list_destinations, get_visa_route, check_eligibility, check_recruiter, get_check_result,
            check_wage_payment, open_case, list_my_cases, departure_checklist,
        )
    }
