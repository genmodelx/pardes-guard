"""ADK agent wiring, run offline with a scripted model that plays Gemini's role."""

from __future__ import annotations

from typing import Any, AsyncGenerator

from google.adk.models.base_llm import BaseLlm, LlmCapabilities
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from app.agents.a2a import PUBLIC_TOOLS, build_public_a2a_app, build_public_agent
from app.agents.guardian import GuardianChat, build_agents
from app.agents.tools import build_tools
from app.schemas import User


class ScriptedLlm(BaseLlm):
    """Turn 1: call the scripted tool. Turn 2: answer with text that quotes the tool result."""

    script: list[tuple[str, dict[str, Any]]] = []
    seen_requests: list[LlmRequest] = []

    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        self.seen_requests.append(llm_request)
        last = llm_request.contents[-1] if llm_request.contents else None
        responses = [p.function_response for p in (last.parts if last else []) if p.function_response]
        if responses:
            payload = responses[0].response or {}
            text = f"Tool {responses[0].name} said: {sorted(payload)[:6]}"
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part.from_text(text=text)]))
            return
        name, args = self.script[0]
        call = types.Part(function_call=types.FunctionCall(name=name, args=args))
        yield LlmResponse(content=types.Content(role="model", parts=[call]))


def test_tool_functions_cover_platform(container):
    tools = build_tools(container)
    assert set(tools) == {
        "list_destinations", "get_visa_route", "check_eligibility", "check_recruiter", "get_check_result",
        "check_wage_payment", "open_case", "list_my_cases", "departure_checklist",
    }
    dests = tools["list_destinations"]("study")["destinations"]
    assert {d["country_code"] for d in dests} >= {"CA", "GB", "AU"}
    elig = tools["check_eligibility"]("CA", "ca-express-entry-fsw", test_name="ielts_gt", test_listening=6, test_reading=6, test_writing=6, test_speaking=6)
    assert next(i for i in elig["items"] if i["requirement_id"] == "ca-fsw-language")["status"] == "met"
    assert "warning" in tools["check_recruiter"](name="Sunrise Manpower Promoters")


def test_agent_tree_builds_with_researcher(container):
    root = build_agents(container, model=ScriptedLlm(model="scripted"))
    names = {getattr(t, "name", getattr(t, "__name__", "")) for t in root.tools}
    assert "official_researcher" in names and "open_case" in names


async def test_guardian_calls_recruiter_tool(container):
    llm = ScriptedLlm(model="scripted", script=[("check_recruiter", {"name": "Sunrise Manpower Promoters"})], seen_requests=[])
    chat = GuardianChat(container, model=llm)
    turn = await chat.send(User(id="w1"), "Is Sunrise Manpower licensed?", language="ur")
    assert turn.tools_used == ["check_recruiter"]
    assert "Tool check_recruiter said" in turn.reply
    # The system instruction followed the session's language.
    assert "Urdu" in (llm.seen_requests[0].config.system_instruction or "")
    # Same session continues.
    again = await chat.send(User(id="w1"), "thanks", session_id=turn.session_id)
    assert again.session_id == turn.session_id


async def test_open_case_tool_uses_session_owner_not_model_input(container):
    llm = ScriptedLlm(
        model="scripted",
        script=[("open_case", {"kind": "wage_short", "title": "Paid short in August", "summary": "Got 1000 instead of 1500 SAR"})],
        seen_requests=[],
    )
    chat = GuardianChat(container, model=llm)
    await chat.send(User(id="worker-42"), "My employer paid me 500 short")
    cases = container.cases.list_for(User(id="worker-42"))
    assert len(cases) == 1 and cases[0].ladder[0].status == "awaiting_approval"
    assert container.store.all("outbox") == []  # nothing sent without approval


def test_public_a2a_agent_has_no_personal_tools(container):
    agent = build_public_agent(container, model=ScriptedLlm(model="scripted"))
    names = {getattr(t, "__name__", getattr(t, "name", "")) for t in agent.tools}
    assert names == PUBLIC_TOOLS
    app = build_public_a2a_app(container, public_url="https://a2a.example.org")
    assert app is not None
