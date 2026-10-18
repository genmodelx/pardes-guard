"""The Pardes Guard agents (Agent Development Kit).

Root agent: the guardian. It answers in the user's language and uses tools for every fact.
Sub-agent (as a tool): an official-sources researcher with Grounding with Google Search, used only for
questions the country packs don't cover; its answers are labelled unverified.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.models.base_llm import BaseLlm
from google.adk.runners import Runner
from google.adk.sessions import BaseSessionService, InMemorySessionService
from google.adk.tools import AgentTool, google_search
from google.genai import types

from app.agents.tools import build_tools
from app.container import Container
from app.llm import prompts
from app.schemas import User

log = logging.getLogger(__name__)

APP_NAME = "pardes_guard"

RESEARCHER_INSTRUCTION = """You look up official government information for migrant workers.
Use Google Search and rely only on official government or regulator websites.
Return a short answer, the exact wording of any threshold, and the official page title and link.
If you cannot find an official page, say you could not confirm it. Always add: "Not yet reviewed by Pardes Guard."
"""


def _guardian_instruction(ctx: ReadonlyContext) -> str:
    language = ctx.state.get("language", "ur")
    return prompts.GUARDIAN_INSTRUCTION.format(language=prompts.LANGUAGE_NAMES.get(language, language))


def build_agents(c: Container, model: str | BaseLlm | None = None) -> LlmAgent:
    model = model or c.settings.model_fast
    researcher = LlmAgent(
        name="official_researcher",
        model=model,
        description="Finds current official information that the country guides do not cover yet.",
        instruction=RESEARCHER_INSTRUCTION,
        tools=[google_search],
    )
    tools = list(build_tools(c).values())
    return LlmAgent(
        name="guardian",
        model=model,
        description="Pardes Guard: helps workers going abroad check offers, recruiters, visas, requirements and wages.",
        instruction=_guardian_instruction,
        tools=[*tools, AgentTool(agent=researcher)],
    )


@dataclass
class ChatTurn:
    session_id: str
    reply: str
    tools_used: list[str] = field(default_factory=list)


class GuardianChat:
    """Runs the guardian for API requests. One ADK session per user conversation."""

    def __init__(
        self,
        c: Container,
        model: str | BaseLlm | None = None,
        session_service: BaseSessionService | None = None,
    ) -> None:
        self._c = c
        self._sessions = session_service or InMemorySessionService()
        self._runner = Runner(app_name=APP_NAME, agent=build_agents(c, model), session_service=self._sessions)

    async def _session(self, user: User, session_id: str | None, language: str) -> str:
        if session_id:
            existing = await self._sessions.get_session(app_name=APP_NAME, user_id=user.id, session_id=session_id)
            if existing is not None:
                return existing.id
        created = await self._sessions.create_session(
            app_name=APP_NAME,
            user_id=user.id,
            session_id=session_id or f"s_{uuid.uuid4().hex[:16]}",
            state={"owner_id": user.id, "role": user.role, "language": language},
        )
        return created.id

    async def send(
        self,
        user: User,
        message: str | None,
        language: str = "ur",
        session_id: str | None = None,
        audio: tuple[bytes, str] | None = None,
    ) -> ChatTurn:
        sid = await self._session(user, session_id, language)
        parts: list[types.Part] = []
        if message:
            parts.append(types.Part.from_text(text=message))
        if audio is not None:
            parts.append(types.Part.from_bytes(data=audio[0], mime_type=audio[1]))
        if not parts:
            raise ValueError("Send a message or a voice note")
        content = types.Content(role="user", parts=parts)

        reply_chunks: list[str] = []
        tools_used: list[str] = []
        async for event in self._runner.run_async(user_id=user.id, session_id=sid, new_message=content):
            for call in event.get_function_calls() or []:
                tools_used.append(call.name)
            if event.is_final_response() and event.content and event.content.parts:
                reply_chunks += [p.text for p in event.content.parts if getattr(p, "text", None)]
        reply = "\n".join(reply_chunks).strip() or "Sorry, I couldn't answer that. Please try again."
        return ChatTurn(session_id=sid, reply=reply, tools_used=tools_used)
