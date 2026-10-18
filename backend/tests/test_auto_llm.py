"""LLM_BACKEND=auto: Gemini when it answers, the offline path when it does not, and never a green stamp
for a paper nobody read."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.llm.fake import FakeLLM
from app.llm.resilient import OfflineLLM, ResilientLLM, is_outage
from app.main import create_app
from app.schemas import CheckContext
from app.services.security import ValidatedFile
from tests.helpers import contract_text, dev_headers


class QuotaError(Exception):
    code = 429


class Flaky(FakeLLM):
    """Gemini stand-in: answers like the fixtures' reader until told to fail."""

    name = "gemini"

    def __init__(self) -> None:
        self.fail: Exception | None = None
        self.calls = 0

    async def read_document(self, file, context):
        self.calls += 1
        if self.fail:
            raise self.fail
        return await super().read_document(file, context)

    async def draft_letter(self, case, step, language):
        if self.fail:
            raise self.fail
        return "Drafted by Gemini"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _file() -> ValidatedFile:
    data = contract_text()
    return ValidatedFile(filename="contract.txt", mime_type="text/plain", data=data)


async def test_a_quota_error_switches_to_offline_for_the_cooldown_then_tries_again():
    primary, clock = Flaky(), Clock()
    llm = ResilientLLM(primary, cooldown_seconds=60, clock=clock)
    ctx = CheckContext(destination_country="SA")
    assert (await llm.read_document(_file(), ctx)).employer_name == "Al Faris Trading Est"

    primary.fail = QuotaError("quota")
    with pytest.raises(Exception):
        await llm.read_document(_file(), ctx)
    assert llm.online is False
    calls = primary.calls
    with pytest.raises(Exception):
        await llm.read_document(_file(), ctx)  # skipped: no waiting on Gemini during the cooldown
    assert primary.calls == calls

    primary.fail = None
    clock.now += 61
    assert llm.online is True
    assert (await llm.read_document(_file(), ctx)).employer_name == "Al Faris Trading Est"


async def test_a_bad_answer_falls_back_for_that_call_only():
    primary = Flaky()
    llm = ResilientLLM(primary, clock=Clock())
    primary.fail = ValueError("the model returned something that is not JSON")
    assert await llm.draft_letter(*_case_and_step()) == "Template letter"
    assert llm.online is True  # not an outage: the next call goes to Gemini again
    primary.fail = None
    assert await llm.draft_letter(*_case_and_step()) == "Drafted by Gemini"


def _case_and_step():
    from app.schemas import Case, LadderStep

    step = LadderStep(index=0, action="notice_employer", name="Notice to the employer", due_at="2026-10-15T00:00:00Z", draft="Template letter")
    case = Case(
        id="c1",
        owner_id="w1",
        kind="wage_short",
        severity="medium",
        title="Paid less",
        summary="Paid less than the contract",
        created_at="2026-10-15T00:00:00Z",
        updated_at="2026-10-15T00:00:00Z",
        ladder=[step],
    )
    return case, step, "en"


def test_outages_are_told_apart_from_bad_answers():
    assert is_outage(QuotaError())
    assert is_outage(TimeoutError())
    try:
        try:
            raise QuotaError("429")
        except QuotaError as inner:
            raise RuntimeError("Gemini request failed") from inner
    except RuntimeError as outer:
        assert is_outage(outer)
    class ProxyError(Exception):  # httpx's name when a proxy refuses the connection
        pass

    assert is_outage(ProxyError())
    assert not is_outage(ValueError("bad JSON"))


@pytest.fixture
def offline_client():
    settings = Settings(env="test", llm_backend="auto", gemini_api_key="", google_cloud_project="", store_backend="memory", auth_mode="dev")
    container = build_container(settings)
    assert isinstance(container.llm, ResilientLLM) and not container.llm.configured
    with TestClient(create_app(settings, container=container)) as client:
        yield client


def test_with_no_key_a_check_runs_on_the_rules_and_says_the_paper_was_not_read(offline_client):
    meta = offline_client.get("/api/meta").json()
    assert meta["llm"] == "offline" and meta["llm_online"] is False and meta["assistant"] is False
    r = offline_client.post(
        "/api/checks",
        headers=dev_headers(),
        files=[("files", ("contract.txt", contract_text(), "text/plain"))],
        data={"destination_country": "SA", "recruiter_name": "Sunrise Manpower Promoters"},
    )
    assert r.status_code == 200, r.text
    v = r.json()
    codes = {f["code"] for f in v["flags"]}
    # The same clean contract is green when it is read; unread, it cannot be.
    assert "READER_UNAVAILABLE" in codes and "UNCLEAR_DOCUMENT" not in codes
    assert v["level"] != "green"
    assert v["documents"][0]["unread"] is True
    assert v["spoken_summary"]  # the template explanation
    # What the person typed still counts: the recruiter was looked up.
    assert v["recruiter"]["status"] == "licensed_active"


def test_with_no_key_speech_is_off_and_the_assistant_says_why(offline_client):
    assert offline_client.post("/api/speak", headers=dev_headers(), json={"text": "Hello", "language": "en"}).status_code == 204
    r = offline_client.post("/api/assistant/chat", headers=dev_headers(), json={"message": "Hi", "language": "en"})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]


async def test_the_offline_path_invents_nothing():
    offline = OfflineLLM()
    with pytest.raises(Exception):
        await offline.read_document(_file(), CheckContext())
    said = await offline.read_statement(None, "Recruiter: Fast Visa\nFee: 500000 PKR", CheckContext())
    assert said.transcript and said.recruiter_name is None and said.fee_asked is None
