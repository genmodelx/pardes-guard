"""LLM_BACKEND=auto: Gemini when it answers, the offline path when it does not.

Gemini is used when a key (GEMINI_API_KEY) or a project (GOOGLE_CLOUD_PROJECT) is configured. When a
call fails because Gemini is out of free quota, unreachable or refuses the key, that call gets the
offline answer and Gemini is skipped for AI_COOLDOWN_SECONDS, so people are not kept waiting on
retries. With nothing configured, every call takes the offline path.

The offline path never guesses what a paper says. A paper it cannot read is marked unread, the rules
run on what the person typed, and the result says the paper was not checked (READER_UNAVAILABLE), so
it can never end in a green stamp. Explanations and letters come from fixed templates; speech is off.

The offline reader in app/llm/fake.py is different: it parses the test fixtures' "Field: value" text
and is for tests only (LLM_BACKEND=fake).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable

from app.llm.base import LLM, DocumentReading, RequirementProposal, StatementReading
from app.schemas import Case, CheckContext, CountryPack, LadderStep, Verdict, VisaRoute
from app.services.security import ValidatedFile

log = logging.getLogger(__name__)

# HTTP codes that mean "Gemini is not available right now", not "this request was bad".
OUTAGE_CODES = {401, 403, 429, 500, 502, 503, 504}


class ReaderUnavailable(RuntimeError):
    """No reader could read this paper now. The pipeline marks the paper unread."""


def is_outage(exc: BaseException) -> bool:
    seen: BaseException | None = exc
    while seen is not None:
        if getattr(seen, "code", None) in OUTAGE_CODES or getattr(seen, "status_code", None) in OUTAGE_CODES:
            return True
        if isinstance(seen, (OSError, TimeoutError, asyncio.TimeoutError)):
            return True
        # httpx and google-api-core name their connection failures this way (ConnectError, ReadTimeout,
        # ProxyError, TransportError, ServiceUnavailable...).
        names = " ".join(k.__name__ for k in type(seen).__mro__)
        if any(word in names for word in ("Connect", "Timeout", "Network", "Transport", "Proxy", "Unavailable")):
            return True
        seen = seen.__cause__ or seen.__context__
    return False


class OfflineLLM:
    """What the app says without an AI model. Safe for real people: it invents nothing."""

    name = "offline"

    async def read_document(self, file: ValidatedFile, context: CheckContext) -> DocumentReading:
        raise ReaderUnavailable("No AI reader is available")

    async def read_statement(self, audio: ValidatedFile | None, text: str | None, context: CheckContext) -> StatementReading:
        # The typed words are kept as they are; nothing is read out of them or out of a voice note.
        return StatementReading(transcript=text or None)

    async def explain_verdict(self, verdict: Verdict, language: str) -> str:
        if verdict.level == "green":
            lead = "No serious warning signs were found."
        elif verdict.level == "amber":
            lead = "Some things need checking before you go ahead."
        else:
            lead = "There are serious warning signs."
        reasons = "; ".join(verdict.top_reasons) or "nothing major"
        step = verdict.next_steps[0] if verdict.next_steps else ""
        return f"{lead} Main points: {reasons}. {step} Check with the official office before paying or signing."

    async def draft_letter(self, case: Case, step: LadderStep, language: str) -> str:
        return step.draft or f"{step.name}\n\n{case.summary}"

    async def research_requirements(self, pack: CountryPack, route: VisaRoute) -> list[RequirementProposal]:
        return []

    async def speak(self, text: str, language: str) -> bytes | None:
        return None


class ResilientLLM:
    def __init__(self, primary: LLM | None, cooldown_seconds: float = 60, clock: Callable[[], float] = time.monotonic) -> None:
        self._primary = primary
        self._offline = OfflineLLM()
        self._cooldown = cooldown_seconds
        self._clock = clock
        self._skip_until = 0.0
        self.name = primary.name if primary is not None else "offline"

    @property
    def configured(self) -> bool:
        """True when a Gemini key or project is set."""
        return self._primary is not None

    @property
    def online(self) -> bool:
        """True when the next call will go to Gemini."""
        return self._primary is not None and self._clock() >= self._skip_until

    async def _call(self, method: str, *args):
        if self.online:
            try:
                return await getattr(self._primary, method)(*args)
            except Exception as exc:
                if is_outage(exc):
                    self._skip_until = self._clock() + self._cooldown
                    log.warning("Gemini unavailable for %s (%s); offline for %ss", method, type(exc).__name__, self._cooldown)
                else:
                    log.warning("Gemini %s failed (%s); using the offline answer", method, type(exc).__name__)
        return await getattr(self._offline, method)(*args)

    async def read_document(self, file: ValidatedFile, context: CheckContext) -> DocumentReading:
        return await self._call("read_document", file, context)

    async def read_statement(self, audio: ValidatedFile | None, text: str | None, context: CheckContext) -> StatementReading:
        return await self._call("read_statement", audio, text, context)

    async def explain_verdict(self, verdict: Verdict, language: str) -> str:
        return await self._call("explain_verdict", verdict, language)

    async def draft_letter(self, case: Case, step: LadderStep, language: str) -> str:
        return await self._call("draft_letter", case, step, language)

    async def research_requirements(self, pack: CountryPack, route: VisaRoute) -> list[RequirementProposal]:
        return await self._call("research_requirements", pack, route)

    async def speak(self, text: str, language: str) -> bytes | None:
        return await self._call("speak", text, language)
