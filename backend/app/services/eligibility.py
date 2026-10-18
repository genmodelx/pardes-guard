"""Eligibility: compare a profile with a visa route's requirements.

Never says "you are eligible". It says which listed requirements look met, not met or unknown from
what the person entered, each with its official source, and marks draft content as draft.
"""

from __future__ import annotations

from app.schemas import (
    BoolRule,
    EligibilityItem,
    EligibilityResult,
    LanguageRule,
    LevelRule,
    Profile,
    RangeRule,
    Requirement,
    TestScore,
    TestThreshold,
    VisaRoute,
)

FIELD_LABELS = {
    "age": "age",
    "experience_years": "years of experience",
    "passport_valid_months": "months of passport validity",
    "education_level": "education",
    "has_skills_certificate": "skills certificate",
    "has_police_clearance": "police clearance",
}


def evaluate_route(country: str, route: VisaRoute, profile: Profile) -> EligibilityResult:
    items = [evaluate_requirement(req, profile) for req in route.requirements]
    return EligibilityResult(
        country=country,
        route_id=route.id,
        route_name=route.name,
        items=items,
        met=sum(i.status == "met" for i in items),
        not_met=sum(i.status == "not_met" for i in items),
        unknown=sum(i.status in ("unknown", "manual_check") for i in items),
        content_is_draft=route.status != "verified" or any(r.status != "verified" for r in route.requirements),
    )


def evaluate_requirement(req: Requirement, profile: Profile) -> EligibilityItem:
    base = {
        "requirement_id": req.id,
        "title": req.title,
        "sources": req.sources,
        "content_status": req.status,
    }
    rule = req.rule
    if rule is None:
        return EligibilityItem(**base, status="manual_check", explanation=req.description)
    if isinstance(rule, RangeRule):
        status, why = _range(rule, profile)
    elif isinstance(rule, LevelRule):
        status, why = _level(rule, profile)
    elif isinstance(rule, LanguageRule):
        status, why = _language(rule, profile)
    elif isinstance(rule, BoolRule):
        status, why = _bool(rule, profile)
    else:  # pragma: no cover - the discriminated union makes this unreachable
        status, why = "manual_check", req.description
    return EligibilityItem(**base, status=status, explanation=why)


def _range(rule: RangeRule, profile: Profile) -> tuple[str, str]:
    value = getattr(profile, rule.field, None)
    label = FIELD_LABELS.get(rule.field, rule.field)
    if value is None:
        return "unknown", f"Add your {label} to check this."
    if rule.min is not None and value < rule.min:
        return "not_met", f"Needs at least {rule.min:g}; you entered {value:g}."
    if rule.max is not None and value > rule.max:
        return "not_met", f"Needs at most {rule.max:g}; you entered {value:g}."
    return "met", f"Your {label} ({value:g}) is within the listed limit."


def _level(rule: LevelRule, profile: Profile) -> tuple[str, str]:
    value = getattr(profile, rule.field, None)
    label = FIELD_LABELS.get(rule.field, rule.field)
    if value is None:
        return "unknown", f"Add your {label} to check this."
    if value not in rule.order or rule.min not in rule.order:
        return "unknown", f"'{value}' can't be compared automatically; check the official page."
    if rule.order.index(value) >= rule.order.index(rule.min):
        return "met", f"Your {label} meets the listed minimum ({rule.min.replace('_', ' ')})."
    return "not_met", f"Needs at least {rule.min.replace('_', ' ')}."


def _bool(rule: BoolRule, profile: Profile) -> tuple[str, str]:
    value = getattr(profile, rule.field, None)
    label = FIELD_LABELS.get(rule.field, rule.field)
    if value is None:
        return "unknown", f"Tell us whether you have a {label}."
    return ("met", f"You have a {label}.") if value else ("not_met", f"A {label} is required.")


def _score_meets(threshold: TestThreshold, score: TestScore) -> tuple[bool | None, str]:
    """True/False when it can be decided, None when the threshold or the score is incomplete."""
    has_threshold = threshold.min_overall is not None or threshold.min_each or threshold.min_level
    if not has_threshold:
        return None, f"{threshold.test.replace('_', ' ')} is accepted, but the score to aim for isn't listed yet."
    if threshold.min_level:
        order = threshold.level_order or []
        if not score.level or score.level not in order or threshold.min_level not in order:
            return None, f"Enter your {threshold.test.replace('_', ' ')} level."
        ok = order.index(score.level) >= order.index(threshold.min_level)
        return ok, f"{threshold.test.replace('_', ' ')} {score.level} vs required {threshold.min_level}."
    if threshold.min_overall is not None:
        if score.overall is None:
            return None, f"Enter your overall {threshold.test.replace('_', ' ')} score."
        if score.overall < threshold.min_overall:
            return False, f"Overall {score.overall:g} is below {threshold.min_overall:g}."
    if threshold.min_each:
        missing = [s for s in threshold.min_each if s not in score.components]
        if missing:
            return None, "Enter your score for: " + ", ".join(missing) + "."
        low = [f"{s} {score.components[s]:g} < {m:g}" for s, m in threshold.min_each.items() if score.components[s] < m]
        if low:
            return False, "Below the minimum in: " + "; ".join(low) + "."
    return True, f"Your {threshold.test.replace('_', ' ')} scores meet the listed minimum."


def _language(rule: LanguageRule, profile: Profile) -> tuple[str, str]:
    accepted = ", ".join(o.test.replace("_", " ") for o in rule.options)
    by_test = {t.test.upper(): t for t in profile.tests}
    undecided: list[str] = []
    failed: list[str] = []
    for option in rule.options:
        score = by_test.get(option.test.upper())
        if score is None:
            continue
        ok, why = _score_meets(option, score)
        if ok:
            return "met", why
        (failed if ok is False else undecided).append(why)
    if undecided:
        return "unknown", " ".join(undecided)
    if failed:
        return "not_met", " ".join(failed)
    return "unknown", f"Add a test result. Accepted: {accepted}."
