"""Case engine: opens cases, schedules the escalation ladder, and enforces approval gates.

Nothing leaves the platform without the worker's approval. Timers (driven by Cloud Scheduler calling
/api/cases/tick) only move a step to "awaiting approval" and prepare a draft; the worker approves or
declines. Approved items go to the outbox (for the worker to send or download) or, for legal-aid
hand-offs with a configured partner, over A2A.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Protocol

from app.packs import PackRegistry
from app.schemas import Case, CaseEvent, LadderStep, OpenCaseRequest, Severity, StepAction, User
from app.storage import DocStore

CASES = "cases"
OUTBOX = "outbox"
NOTIFICATIONS = "notifications"

SEVERITY_BY_KIND: dict[str, Severity] = {
    "emergency": "high",
    "passport_held": "high",
    "recruiter_fraud": "high",
    "fraud_ring_link": "high",
    "wage_short": "medium",
    "wage_late": "medium",
    "contract_changed": "medium",
    "other": "low",
}

STEP_NAMES: dict[StepAction, str] = {
    "notice_employer": "Formal notice to the employer or recruiter",
    "complaint_embassy": "Complaint to the embassy or Community Welfare Attaché",
    "handoff_legal_aid": "Hand the case to a legal-aid partner",
    "complaint_regulator": "Complaint to the emigration regulator",
}


class CaseError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class Dispatcher(Protocol):
    async def handoff(self, case: Case, step: LadderStep) -> str | None:
        """Deliver to a partner; return the channel name, or None when no partner is configured."""
        ...


class NoPartnerDispatcher:
    async def handoff(self, case: Case, step: LadderStep) -> str | None:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _actions_for(kind: str) -> list[StepAction]:
    if kind in ("recruiter_fraud", "fraud_ring_link"):
        return ["complaint_regulator", "handoff_legal_aid"]
    if kind == "emergency":
        return ["complaint_embassy", "handoff_legal_aid"]
    return ["notice_employer", "complaint_embassy", "handoff_legal_aid"]


def template_draft(case: Case, step: LadderStep) -> str:
    """Plain, factual starting draft. The AI drafting endpoint can rewrite it in another language."""
    opening = {
        "notice_employer": "Dear Sir or Madam,\n\nI am writing about my employment.",
        "complaint_embassy": "To the Community Welfare Attaché,\n\nI am a worker from my country requesting your help.",
        "handoff_legal_aid": "To the legal-aid team,\n\nI would like help with the following case.",
        "complaint_regulator": "To the emigration regulator,\n\nI would like to report a recruiter.",
    }[step.action]
    return (
        f"{opening}\n\nIssue: {case.title}\n\n{case.summary}\n\n"
        f"Case reference: {case.id}\nEvidence: {len(case.evidence_ids)} file(s), each with a verifiable hash, attached.\n\n"
        "I request that this is resolved and that I receive a written reply.\n\nRespectfully,"
    )


class CaseService:
    def __init__(self, store: DocStore, packs: PackRegistry, dispatcher: Dispatcher | None = None) -> None:
        self._store = store
        self._packs = packs
        self._dispatcher = dispatcher or NoPartnerDispatcher()

    # --- persistence helpers ----------------------------------------------

    def _save(self, case: Case) -> Case:
        case.updated_at = _now()
        self._store.put(CASES, case.id, case.model_dump(mode="json"))
        return case

    def get(self, case_id: str) -> Case | None:
        raw = self._store.get(CASES, case_id)
        return Case.model_validate(raw) if raw else None

    def get_for(self, case_id: str, user: User) -> Case:
        case = self.get(case_id)
        if case is None:
            raise CaseError("Case not found", 404)
        if case.owner_id != user.id and user.role not in ("ngo", "admin"):
            raise CaseError("Case not found", 404)  # don't reveal that it exists
        return case

    def list_for(self, user: User) -> list[Case]:
        docs = self._store.where(CASES, "owner_id", user.id)
        return sorted((Case.model_validate(d) for d in docs), key=lambda c: c.created_at, reverse=True)

    def review_queue(self) -> list[Case]:
        docs = self._store.where(CASES, "needs_human_review", True)
        return sorted((Case.model_validate(d) for d in docs), key=lambda c: c.created_at)

    # --- lifecycle ---------------------------------------------------------

    def open(self, owner: User, req: OpenCaseRequest, now: datetime | None = None) -> Case:
        now = now or _now()
        pack = self._packs.get(req.destination_country) or self._packs.get(req.origin_country)
        days = (pack.ladder_days if pack else None) or [0, 7, 14]
        actions = _actions_for(req.kind)
        ladder = [
            LadderStep(
                index=i,
                name=STEP_NAMES[action],
                action=action,
                due_at=now + timedelta(days=days[min(i, len(days) - 1)]),
            )
            for i, action in enumerate(actions)
        ]
        severity = SEVERITY_BY_KIND.get(req.kind, "low")
        case = Case(
            id=f"case_{uuid.uuid4().hex[:12]}",
            owner_id=owner.id,
            kind=req.kind,
            severity=severity,
            title=req.title,
            summary=req.summary,
            origin_country=req.origin_country.upper(),
            destination_country=req.destination_country.upper() if req.destination_country else None,
            created_at=now,
            updated_at=now,
            ladder=ladder,
            evidence_ids=list(dict.fromkeys(req.evidence_ids)),
            related_check_id=req.related_check_id,
            needs_human_review=severity == "high",
            events=[CaseEvent(at=now, actor=owner.id, kind="opened", detail=f"Case opened: {req.kind}")],
        )
        if req.kind == "emergency":
            case.status = "escalating"
            self._notify_family(case, "Emergency alert raised. Please contact your family member now.", now)
            case.events.append(CaseEvent(at=now, actor="system", kind="emergency", detail="Emergency contacts alerted"))
        self._advance(case, now)
        return self._save(case)

    def _advance(self, case: Case, now: datetime) -> bool:
        """Move the next due step to awaiting approval. One step waits at a time. Returns True if changed."""
        if case.status in ("resolved", "closed"):
            return False
        if any(s.status == "awaiting_approval" for s in case.ladder):
            return False
        for step in case.ladder:
            if step.status != "scheduled":
                continue
            if step.due_at <= now:
                step.status = "awaiting_approval"
                step.draft = template_draft(case, step)
                case.status = "awaiting_approval"
                case.events.append(
                    CaseEvent(at=now, actor="system", kind="step_ready", detail=f"Ready for your approval: {step.name}")
                )
                return True
            return False  # next step not due yet
        return False

    def tick(self, now: datetime | None = None) -> int:
        """Called by Cloud Scheduler. Returns how many cases changed."""
        now = now or _now()
        changed = 0
        for raw in self._store.all(CASES, limit=5000):
            case = Case.model_validate(raw)
            if self._advance(case, now):
                self._save(case)
                changed += 1
        return changed

    def _step(self, case: Case, index: int) -> LadderStep:
        if index < 0 or index >= len(case.ladder):
            raise CaseError("No such step", 404)
        return case.ladder[index]

    def update_draft(self, case_id: str, index: int, user: User, text: str) -> Case:
        case = self.get_for(case_id, user)
        step = self._step(case, index)
        if step.status != "awaiting_approval":
            raise CaseError("This step is not waiting for approval", 409)
        step.draft = text
        return self._save(case)

    async def approve(self, case_id: str, index: int, user: User, now: datetime | None = None) -> Case:
        now = now or _now()
        case = self.get_for(case_id, user)
        if case.owner_id != user.id:
            raise CaseError("Only the worker can approve sending", 403)
        step = self._step(case, index)
        if step.status != "awaiting_approval":
            raise CaseError("This step is not waiting for approval", 409)
        step.status = "approved"
        step.decided_at = now
        channel = None
        if step.action == "handoff_legal_aid":
            channel = await self._dispatcher.handoff(case, step)
        if channel:
            step.status = "sent"
            step.sent_at = now
            step.channel = channel
            detail = f"Sent to {channel}: {step.name}"
        else:
            step.channel = "outbox"
            self._store.put(
                OUTBOX,
                f"{case.id}_{step.index}",
                {"case_id": case.id, "owner_id": case.owner_id, "step": step.index, "action": step.action,
                 "text": step.draft, "created_at": now.isoformat()},
            )
            detail = f"Approved and ready to send from your outbox: {step.name}"
        case.status = "escalating"
        case.events.append(CaseEvent(at=now, actor=user.id, kind="step_approved", detail=detail))
        self._advance(case, now)
        return self._save(case)

    def mark_sent(self, case_id: str, index: int, user: User, channel: str, now: datetime | None = None) -> Case:
        now = now or _now()
        case = self.get_for(case_id, user)
        step = self._step(case, index)
        if step.status != "approved":
            raise CaseError("Only an approved step can be marked as sent", 409)
        step.status = "sent"
        step.sent_at = now
        step.channel = channel[:60]
        case.events.append(CaseEvent(at=now, actor=user.id, kind="step_sent", detail=f"Sent via {step.channel}"))
        return self._save(case)

    def decline(self, case_id: str, index: int, user: User, now: datetime | None = None) -> Case:
        now = now or _now()
        case = self.get_for(case_id, user)
        if case.owner_id != user.id:
            raise CaseError("Only the worker can decline", 403)
        step = self._step(case, index)
        if step.status != "awaiting_approval":
            raise CaseError("This step is not waiting for approval", 409)
        step.status = "declined"
        step.decided_at = now
        case.status = "open"
        case.events.append(CaseEvent(at=now, actor=user.id, kind="step_declined", detail=f"Declined: {step.name}"))
        self._advance(case, now)
        return self._save(case)

    def resolve(self, case_id: str, user: User, note: str, now: datetime | None = None) -> Case:
        now = now or _now()
        case = self.get_for(case_id, user)
        for step in case.ladder:
            if step.status in ("scheduled", "awaiting_approval"):
                step.status = "skipped"
        case.status = "resolved"
        case.needs_human_review = False
        case.events.append(CaseEvent(at=now, actor=user.id, kind="resolved", detail=note[:500] or "Resolved"))
        return self._save(case)

    def mark_reviewed(self, case_id: str, reviewer: User, note: str, now: datetime | None = None) -> Case:
        if reviewer.role not in ("ngo", "admin"):
            raise CaseError("Only NGO staff can review cases", 403)
        now = now or _now()
        case = self.get_for(case_id, reviewer)
        case.needs_human_review = False
        case.events.append(CaseEvent(at=now, actor=reviewer.id, kind="reviewed", detail=note[:500] or "Reviewed"))
        return self._save(case)

    def attach_evidence(self, case_id: str, user: User, evidence_id: str) -> Case:
        case = self.get_for(case_id, user)
        if evidence_id not in case.evidence_ids:
            case.evidence_ids.append(evidence_id)
        return self._save(case)

    # --- family sharing -----------------------------------------------------

    def share_with_family(self, case_id: str, user: User) -> str:
        case = self.get_for(case_id, user)
        if case.owner_id != user.id:
            raise CaseError("Only the worker can share a case", 403)
        if not case.family_share_code:
            case.family_share_code = secrets.token_urlsafe(9)
            case.events.append(CaseEvent(at=_now(), actor=user.id, kind="shared", detail="Shared with family"))
            self._save(case)
        return case.family_share_code

    def family_view(self, code: str) -> dict:
        if not code or len(code) < 8:
            raise CaseError("Not found", 404)
        docs = self._store.where(CASES, "family_share_code", code, limit=1)
        if not docs:
            raise CaseError("Not found", 404)
        case = Case.model_validate(docs[0])
        notes = self._store.where(NOTIFICATIONS, "case_id", case.id, limit=20)
        return {
            "title": case.title,
            "status": case.status,
            "kind": case.kind,
            "destination_country": case.destination_country,
            "updated_at": case.updated_at.isoformat(),
            "steps": [{"name": s.name, "status": s.status} for s in case.ladder],
            "alerts": sorted(notes, key=lambda n: n["created_at"], reverse=True),
        }

    def _notify_family(self, case: Case, message: str, now: datetime) -> None:
        self._store.put(
            NOTIFICATIONS,
            f"{case.id}_{int(now.timestamp())}",
            {"case_id": case.id, "message": message, "created_at": now.isoformat()},
        )
