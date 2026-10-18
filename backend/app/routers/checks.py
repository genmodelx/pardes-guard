"""Document checks: upload an offer, contract, visa or job ad (plus an optional voice note) and get a verdict."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.auth import current_user
from app.container import Container
from app.deps import check_limiter, client_key, get_container, read_upload
from app.schemas import CheckContext, Money, User, Verdict, WorkerStatement

router = APIRouter(prefix="/api", tags=["checks"])


def _money(amount: float | None, currency: str | None) -> Money | None:
    if amount is None or not currency:
        return None
    return Money(amount=amount, currency=currency, period="month")


@router.post("/checks", response_model=Verdict)
async def create_check(
    request: Request,
    files: Annotated[list[UploadFile], File(description="Photos, PDFs or text of the offer, contract, visa or ad")] = [],  # noqa: B006
    voice: Annotated[UploadFile | None, File(description="Optional voice note about what the recruiter promised")] = None,
    origin_country: Annotated[str, Form(min_length=2, max_length=2)] = "PK",
    destination_country: Annotated[str | None, Form(min_length=2, max_length=2)] = None,
    purpose: Annotated[Literal["work", "study", "visit"], Form()] = "work",
    reply_language: Annotated[str, Form(max_length=5)] = "ur",
    statement_text: Annotated[str | None, Form(max_length=4000)] = None,
    promised_salary_amount: Annotated[float | None, Form(ge=0)] = None,
    promised_salary_currency: Annotated[str | None, Form(min_length=3, max_length=3)] = None,
    fee_amount: Annotated[float | None, Form(ge=0)] = None,
    fee_currency: Annotated[str | None, Form(min_length=3, max_length=3)] = None,
    fee_cash_only: Annotated[bool | None, Form()] = None,
    receipt_given: Annotated[bool | None, Form()] = None,
    recruiter_name: Annotated[str | None, Form(max_length=160)] = None,
    recruiter_license_no: Annotated[str | None, Form(max_length=60)] = None,
    recruiter_phone: Annotated[str | None, Form(max_length=40)] = None,
    promised_job_title: Annotated[str | None, Form(max_length=120)] = None,
    share_signals: Annotated[bool, Form()] = False,
    user: User = Depends(current_user),
    c: Container = Depends(get_container),
) -> Verdict:
    check_limiter.check(client_key(request))
    settings = c.settings
    if len(files) > settings.max_files_per_request:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Upload at most {settings.max_files_per_request} files")
    max_bytes = settings.max_upload_mb * 1024 * 1024
    validated = [await read_upload(f, max_bytes) for f in files]
    voice_file = await read_upload(voice, max_bytes) if voice is not None else None
    if voice_file is not None and not voice_file.is_audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The voice note must be an audio file")
    if not validated and voice_file is None and not statement_text and not (recruiter_name or recruiter_license_no):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a document, a voice note, or the recruiter's details")

    form = WorkerStatement(
        promised_salary=_money(promised_salary_amount, promised_salary_currency),
        fee_asked=Money(amount=fee_amount, currency=fee_currency, period="once") if fee_amount is not None and fee_currency else None,
        fee_paid_cash_only=fee_cash_only,
        receipt_given=receipt_given,
        recruiter_name=recruiter_name,
        recruiter_license_no=recruiter_license_no,
        recruiter_phone=recruiter_phone,
        promised_job_title=promised_job_title,
    )
    has_form = any(v not in (None, [], "") for v in form.model_dump().values())
    context = CheckContext(
        origin_country=origin_country.upper(),
        destination_country=destination_country.upper() if destination_country else None,
        purpose=purpose,
        reply_language=reply_language,
    )
    return await c.pipeline.run(
        owner=user,
        files=validated,
        context=context,
        voice=voice_file,
        statement_text=statement_text,
        form_statement=form if has_form else None,
        share_signals=share_signals,
    )


@router.get("/checks/{check_id}", response_model=Verdict)
async def get_check(check_id: str, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Verdict:
    verdict = c.pipeline.get_check(user, check_id)
    if verdict is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check not found")
    return verdict


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    language: str = Field(default="ur", max_length=5)


@router.post("/speak", responses={200: {"content": {"audio/wav": {}}}, 204: {"description": "Speech unavailable"}})
async def speak(body: SpeakRequest, request: Request, user: User = Depends(current_user), c: Container = Depends(get_container)) -> Response:
    check_limiter.check(client_key(request))
    audio = await c.llm.speak(body.text, body.language)
    if not audio:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return Response(content=audio, media_type="audio/wav")
