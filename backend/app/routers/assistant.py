"""Conversational guardian (ADK) over text or a voice note, with an optional spoken reply."""

from __future__ import annotations

import base64
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import current_user
from app.container import Container
from app.deps import check_limiter, client_key, get_container, read_upload
from app.schemas import User

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    language: str = Field(default="ur", max_length=5)
    session_id: str | None = Field(default=None, pattern=r"^s_[a-f0-9]{16}$")


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    tools_used: list[str]
    audio_wav_base64: str | None = None


def _chat(request: Request):
    chat = getattr(request.app.state, "guardian", None)
    if chat is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The assistant needs Gemini: set GEMINI_API_KEY with LLM_BACKEND=auto or gemini")
    return chat


async def _send(request: Request, *args, **kwargs):
    try:
        return await _chat(request).send(*args, **kwargs)
    except HTTPException:
        raise
    except Exception as exc:
        # Out of free quota or unreachable: say so, instead of a server error.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The assistant cannot reach Gemini right now. Try again in a minute.") from exc


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, user: User = Depends(current_user)) -> ChatResponse:
    check_limiter.check(client_key(request))
    turn = await _send(request, user, body.message, body.language, body.session_id)
    return ChatResponse(session_id=turn.session_id, reply=turn.reply, tools_used=turn.tools_used)


@router.post("/voice", response_model=ChatResponse)
async def voice(
    request: Request,
    audio: Annotated[UploadFile, File()],
    language: Annotated[str, Form(max_length=5)] = "ur",
    session_id: Annotated[str | None, Form(pattern=r"^s_[a-f0-9]{16}$")] = None,
    speak: Annotated[bool, Form()] = True,
    user: User = Depends(current_user),
    c: Container = Depends(get_container),
) -> ChatResponse:
    check_limiter.check(client_key(request))
    file = await read_upload(audio, c.settings.max_upload_mb * 1024 * 1024)
    if not file.is_audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Send an audio file")
    turn = await _send(request, user, None, language, session_id, audio=(file.data, file.mime_type))
    wav = await c.llm.speak(turn.reply, language) if speak else None
    return ChatResponse(
        session_id=turn.session_id,
        reply=turn.reply,
        tools_used=turn.tools_used,
        audio_wav_base64=base64.b64encode(wav).decode("ascii") if wav else None,
    )
