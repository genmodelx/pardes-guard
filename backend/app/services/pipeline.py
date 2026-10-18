"""The document check: read -> screen -> mask -> look up -> rules -> verdict -> explain.

This is the deterministic backbone. Gemini does the reading and the explaining; recruiter lookups,
network risk and every red-flag decision are code. The ADK agents call this same pipeline as a tool,
so chat, voice and the web form always give the same verdict for the same documents.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from app.llm.base import LLM, DocumentReading
from app.llm.resilient import ReaderUnavailable
from app.packs import PackRegistry
from app.schemas import CheckContext, ExtractedDocument, NetworkSignals, User, Verdict, WorkerStatement
from app.services import rules
from app.services.forensics import layout_hash
from app.services.network import GraphStore
from app.services.privacy import Masker
from app.services.recruiters import RecruiterDirectory
from app.services.security import ScreenResult, ValidatedFile, screen_locally
from app.storage import DocStore

log = logging.getLogger(__name__)

CHECKS = "checks"
MAX_PARALLEL_READS = 4


def _mask_tail(value: str, keep: int = 4) -> str:
    digits = [c for c in value if c.isalnum()]
    return "•••• " + "".join(digits[-keep:]) if len(digits) > keep else "••••"


class CheckPipeline:
    def __init__(
        self,
        *,
        llm: LLM,
        packs: PackRegistry,
        recruiters: RecruiterDirectory,
        graph: GraphStore,
        masker: Masker,
        store: DocStore,
        screen=None,
    ) -> None:
        self._llm = llm
        self._packs = packs
        self._recruiters = recruiters
        self._graph = graph
        self._mask = masker
        self._store = store
        self._screen = screen or screen_locally

    async def _read_one(self, idx: int, file: ValidatedFile, context: CheckContext, sem: asyncio.Semaphore) -> ExtractedDocument:
        async with sem:
            unread = False
            try:
                reading = await self._llm.read_document(file, context)
            except ReaderUnavailable:
                log.info("Document %d not read: no AI reader is available", idx)
                reading = DocumentReading(doc_type="other", confidence=0.0)
                unread = True
            except Exception:
                log.warning("Reading document %d failed", idx, exc_info=True)
                reading = DocumentReading(doc_type="other", confidence=0.0)
                unread = True
        doc = ExtractedDocument(doc_id=f"doc_{idx + 1}", unread=unread, **reading.model_dump())
        # Screen the original text for text uploads; for images/PDFs screen what the model transcribed.
        source_text = file.data.decode("utf-8", errors="replace") if file.mime_type == "text/plain" else ""
        screened: ScreenResult = self._screen(
            "\n".join([source_text, doc.raw_text_excerpt or "", *doc.notable_clauses, *doc.instructions_to_ai])
        )
        # The reader is asked to quote any text aimed at an AI. A quote is a warning sign by itself.
        doc.injection_suspected = screened.suspected or bool(doc.instructions_to_ai)
        if file.is_image:
            doc.layout_hash = layout_hash(file.data)
        return doc

    async def run(
        self,
        *,
        owner: User,
        files: list[ValidatedFile],
        context: CheckContext,
        voice: ValidatedFile | None = None,
        statement_text: str | None = None,
        form_statement: WorkerStatement | None = None,
        share_signals: bool = False,
    ) -> Verdict:
        sem = asyncio.Semaphore(MAX_PARALLEL_READS)
        doc_files = [f for f in files if not f.is_audio]
        docs_task = asyncio.gather(*(self._read_one(i, f, context, sem) for i, f in enumerate(doc_files)))
        statement_task = (
            self._llm.read_statement(voice, statement_text, context) if (voice or statement_text) else None
        )
        documents = list(await docs_task)
        statement = await self._merge_statement(statement_task, form_statement)

        destination_code = context.destination_country or next(
            (d.destination_country for d in documents if d.destination_country), None
        )
        context = context.model_copy(update={"destination_country": destination_code})
        origin = self._packs.get(context.origin_country)
        destination = self._packs.get(destination_code)

        rec_name = (statement.recruiter_name if statement else None) or next((d.recruiter_name for d in documents if d.recruiter_name), None)
        rec_lic = (statement.recruiter_license_no if statement else None) or next(
            (d.recruiter_license_no for d in documents if d.recruiter_license_no), None
        )
        recruiter = self._recruiters.check(rec_name, rec_lic)
        if recruiter.status != "not_checked":
            risk, reasons = self._graph.recruiter_risk(rec_lic or (recruiter.match.license_no if recruiter.match else None), rec_name)
            recruiter.network_risk, recruiter.network_reasons = risk, reasons

        # Network signals use the raw identifiers (hashed inside the graph); stored documents keep masked ones.
        phones = [p for d in documents for p in d.recruiter_phones] + (
            [statement.recruiter_phone] if statement and statement.recruiter_phone else []
        )
        accounts = [d.fee_account for d in documents if d.fee_account]
        check_id = f"chk_{uuid.uuid4().hex[:12]}"
        if share_signals and (rec_name or rec_lic or phones or accounts):
            self._graph.ingest(
                NetworkSignals(
                    case_id=check_id,
                    recruiter_license_no=rec_lic,
                    recruiter_name=rec_name,
                    phones=phones,
                    fee_accounts=accounts,
                    employer_name=next((d.employer_name for d in documents if d.employer_name), None),
                    layout_hashes=[d.layout_hash for d in documents if d.layout_hash],
                )
            )

        flags = rules.evaluate(
            rules.RuleInput(
                documents=documents,
                statement=statement,
                context=context,
                origin=origin,
                destination=destination,
                recruiter=recruiter,
                known_fake_layouts=self._graph.known_fake_layouts(),
            )
        )
        level, risk_score = rules.score(flags)
        for d in documents:
            d.raw_text_excerpt = self._mask(d.raw_text_excerpt)
            d.notable_clauses = [self._mask(c) or "" for c in d.notable_clauses]
            d.recruiter_phones = [_mask_tail(p) for p in d.recruiter_phones]
            d.fee_account = _mask_tail(d.fee_account) if d.fee_account else None
        if statement:
            statement.transcript = self._mask(statement.transcript)
            statement.recruiter_phone = _mask_tail(statement.recruiter_phone) if statement.recruiter_phone else None

        verdict = Verdict(
            check_id=check_id,
            created_at=datetime.now(timezone.utc).replace(microsecond=0),
            level=level,
            risk_score=risk_score,
            flags=flags,
            top_reasons=rules.top_reasons(flags),
            next_steps=rules.next_steps(level, flags, origin),
            recruiter=recruiter,
            documents=documents,
            statement=statement,
            content_is_draft=bool(destination and destination.status != "verified"),
        )
        try:
            verdict.spoken_summary = await self._llm.explain_verdict(verdict, context.reply_language)
        except Exception:
            log.warning("Explaining the verdict failed; using the reasons list", exc_info=True)
            verdict.spoken_summary = "; ".join(verdict.top_reasons) or None

        self._store.put(CHECKS, check_id, {"owner_id": owner.id, **verdict.model_dump(mode="json")})
        return verdict

    async def _merge_statement(self, task, form: WorkerStatement | None) -> WorkerStatement | None:
        spoken: WorkerStatement | None = None
        if task is not None:
            try:
                reading = await task
                spoken = WorkerStatement(**reading.model_dump())
            except Exception:
                log.warning("Reading the worker statement failed", exc_info=True)
        if form is None:
            return spoken
        if spoken is None:
            return form
        merged = spoken.model_dump()
        for key, value in form.model_dump().items():
            if value not in (None, [], ""):
                merged[key] = value  # what the worker typed wins over the transcription
        return WorkerStatement(**merged)

    def get_check(self, owner: User, check_id: str) -> Verdict | None:
        raw = self._store.get(CHECKS, check_id)
        if not raw or (raw.get("owner_id") != owner.id and owner.role not in ("ngo", "admin")):
            return None
        raw = {k: v for k, v in raw.items() if k != "owner_id"}
        return Verdict.model_validate(raw)
