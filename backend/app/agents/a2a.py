"""Agent2Agent (A2A) integration.

Outbound: hand an approved case to a legal-aid partner's agent (`A2ADispatcher`).
Inbound: publish a public-information agent other organisations' agents can call (`build_public_a2a_app`).
The public agent has no access to personal data: it covers destinations, requirements and recruiter checks.
"""

from __future__ import annotations

import logging
import uuid

from google.adk.agents import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agents.tools import build_tools
from app.container import Container
from app.schemas import Case, LadderStep

log = logging.getLogger(__name__)

PUBLIC_INSTRUCTION = """You are the Pardes Guard public information agent for other organisations' agents.
Answer questions about visa routes, requirements (including language tests), departure checklists and whether a
recruiter is on the licensed list. Use your tools for every fact and include official sources and content status.
You have no access to any worker's personal data and must not ask for it."""


class A2ADispatcher:
    """Sends an approved legal-aid hand-off to the partner agent named by PARTNER_AGENT_CARD_URL."""

    def __init__(self, agent_card_url: str) -> None:
        from google.adk.agents.remote_a2a_agent import RemoteA2aAgent

        self._partner = RemoteA2aAgent(name="legal_aid_partner", agent_card=agent_card_url)
        self._sessions = InMemorySessionService()
        self._runner = Runner(app_name="pardes_guard_handoff", agent=self._partner, session_service=self._sessions)

    async def handoff(self, case: Case, step: LadderStep) -> str | None:
        session = await self._sessions.create_session(
            app_name="pardes_guard_handoff", user_id="pardes_guard", session_id=f"h_{case.id}_{uuid.uuid4().hex[:6]}"
        )
        text = (
            f"Case hand-off from Pardes Guard, approved by the worker.\nReference: {case.id}\nKind: {case.kind}\n"
            f"Destination: {case.destination_country}\nTitle: {case.title}\n\n{step.draft or case.summary}\n\n"
            "The worker's evidence bundle can be shared on request with their consent."
        )
        try:
            async for _ in self._runner.run_async(
                user_id="pardes_guard", session_id=session.id,
                new_message=types.Content(role="user", parts=[types.Part.from_text(text=text)]),
            ):
                pass
            return "legal_aid_partner (A2A)"
        except Exception:
            log.warning("A2A hand-off failed; the step stays approved in the outbox", exc_info=True)
            return None


PUBLIC_TOOLS = {"list_destinations", "get_visa_route", "check_eligibility", "check_recruiter", "departure_checklist"}


def build_public_agent(c: Container, model: str | BaseLlm | None = None) -> LlmAgent:
    tools = [f for name, f in build_tools(c).items() if name in PUBLIC_TOOLS]
    return LlmAgent(
        name="pardes_guard_public",
        model=model or c.settings.model_fast,
        description="Visa routes, requirements and licensed-recruiter checks for migrant workers, with official sources.",
        instruction=PUBLIC_INSTRUCTION,
        tools=tools,
    )


def build_public_a2a_app(c: Container, public_url: str):
    """A Starlette app serving the public agent over A2A.

    Runs as its own Cloud Run service (see app/a2a_server.py): a separate, data-free security boundary,
    and Starlette sub-app lifespans (where ADK attaches the A2A routes) don't run when mounted in FastAPI.
    """
    from urllib.parse import urlparse

    from google.adk.a2a.utils.agent_to_a2a import to_a2a

    parsed = urlparse(public_url)
    return to_a2a(
        build_public_agent(c),
        host=parsed.hostname or "localhost",
        port=parsed.port or (443 if parsed.scheme == "https" else 80),
        protocol=parsed.scheme or "https",
    )
