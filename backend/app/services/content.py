"""Content operations: keep visa and test requirements current, with a human in the loop.

1. The research step (Gemini with Grounding with Google Search, official domains only) proposes
   requirement updates with citations.
2. Proposals land in a review queue as drafts. Nothing reaches workers yet.
3. A reviewer opens the cited official page, optionally adds a machine-checkable rule, and approves.
4. Approved items are applied to the live pack, stamped "verified" with today's date, and persisted so
   restarts replay them.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from pydantic import TypeAdapter

from app.llm.base import LLM
from app.packs import PackRegistry
from typing import get_args

from app.schemas import ContentDraft, Requirement, RequirementKind, RequirementRule, SourceRef, User
from app.storage import DocStore

DRAFTS = "content_drafts"
_RULE = TypeAdapter(RequirementRule)


class ContentError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class ContentService:
    def __init__(self, store: DocStore, packs: PackRegistry, llm: LLM) -> None:
        self._store = store
        self._packs = packs
        self._llm = llm

    def replay_approved(self) -> int:
        count = 0
        for raw in self._store.where(DRAFTS, "status", "approved", limit=5000):
            draft = ContentDraft.model_validate(raw)
            if draft.kind != "requirement" or not draft.route_id:
                continue
            try:
                req = Requirement.model_validate(draft.payload)
                self._packs.apply_requirement(draft.country, draft.route_id, req, draft.created_at.date())
                count += 1
            except (KeyError, ValueError):
                continue
        return count

    async def refresh(self, country: str, route_id: str) -> list[ContentDraft]:
        pack = self._packs.get(country)
        route = self._packs.route(country, route_id)
        if pack is None or route is None:
            raise ContentError("Unknown country or route", 404)
        proposals = await self._llm.research_requirements(pack, route)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        drafts = []
        for p in proposals:
            draft = ContentDraft(
                id=f"cd_{uuid.uuid4().hex[:12]}",
                country=pack.code,
                route_id=route.id,
                kind="requirement",
                payload={
                    "id": p.id,
                    "kind": p.kind if p.kind in get_args(RequirementKind) else "other",
                    "title": p.title,
                    "description": p.description,
                    "sources": [{"title": p.source_title, "url": p.source_url}],
                },
                citations=[SourceRef(title=p.source_title, url=p.source_url)],
                created_at=now,
                note=f"Model confidence {p.confidence:.2f}",
            )
            self._store.put(DRAFTS, draft.id, draft.model_dump(mode="json"))
            drafts.append(draft)
        return drafts

    def pending(self) -> list[ContentDraft]:
        docs = self._store.where(DRAFTS, "status", "pending", limit=500)
        return sorted((ContentDraft.model_validate(d) for d in docs), key=lambda d: d.created_at)

    def approve(self, draft_id: str, reviewer: User, rule: dict | None = None, edits: dict | None = None) -> ContentDraft:
        if reviewer.role != "admin":
            raise ContentError("Only admins can publish content", 403)
        raw = self._store.get(DRAFTS, draft_id)
        if not raw:
            raise ContentError("Draft not found", 404)
        draft = ContentDraft.model_validate(raw)
        if draft.status != "pending":
            raise ContentError("Draft already reviewed", 409)
        payload = {**draft.payload, **(edits or {})}
        if rule is not None:
            payload["rule"] = _RULE.validate_python(rule).model_dump()
        requirement = Requirement.model_validate(payload)
        if not requirement.sources:
            raise ContentError("A published requirement needs at least one official source", 422)
        self._packs.apply_requirement(draft.country, draft.route_id or "", requirement, date.today())
        draft.payload = requirement.model_dump(mode="json")
        draft.status = "approved"
        draft.reviewer = reviewer.id
        self._store.put(DRAFTS, draft.id, draft.model_dump(mode="json"))
        return draft

    def reject(self, draft_id: str, reviewer: User, note: str) -> ContentDraft:
        if reviewer.role != "admin":
            raise ContentError("Only admins can review content", 403)
        raw = self._store.get(DRAFTS, draft_id)
        if not raw:
            raise ContentError("Draft not found", 404)
        draft = ContentDraft.model_validate(raw)
        draft.status = "rejected"
        draft.reviewer = reviewer.id
        draft.note = note[:500]
        self._store.put(DRAFTS, draft.id, draft.model_dump(mode="json"))
        return draft
