"""FastAPI application: `uvicorn app.main:app`."""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, export_genai_env, get_settings
from app.container import Container, build_container, graph_target
from app.routers import assistant, cases, checks, destinations, recruiters, staff


class CloudLoggingFormatter(logging.Formatter):
    """One JSON object per line, the shape Cloud Logging parses into structured entries."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            entry["request_id"] = request_id
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def configure_logging(settings: Settings) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if settings.env == "prod":
        handler.setFormatter(CloudLoggingFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level)


def create_app(settings: Settings | None = None, container: Container | None = None, guardian=None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)
    log = logging.getLogger("pardes_guard")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        dispatcher = None
        if container is None and settings.partner_agent_card_url:
            from app.agents.a2a import A2ADispatcher

            dispatcher = A2ADispatcher(settings.partner_agent_card_url)
        c = container or build_container(settings, dispatcher=dispatcher)
        app.state.container = c
        if guardian is not None:
            app.state.guardian = guardian
        elif settings.uses_gemini:
            from app.agents.guardian import GuardianChat

            export_genai_env(settings)
            app.state.guardian = GuardianChat(c)
        else:
            app.state.guardian = None
        log.info("Pardes Guard started (env=%s, llm=%s, store=%s)", settings.env, settings.llm_backend, settings.store_backend)
        yield

    app = FastAPI(
        title="Pardes Guard API",
        version="1.0.0",
        description="Protection and guidance for people going abroad for work or study.",
        lifespan=lifespan,
        docs_url="/api/docs" if not settings.is_prod else None,
        openapi_url="/api/openapi.json" if not settings.is_prod else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-Dev-User", "X-Dev-Role"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-cloud-trace-context", "").split("/")[0] or uuid.uuid4().hex[:16]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("Unhandled error", extra={"request_id": request_id})
            response = JSONResponse({"detail": "Something went wrong. Please try again."}, status_code=500)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        log.info(
            "%s %s -> %s in %.0f ms",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
            extra={"request_id": request_id},
        )
        return response

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/api/meta")
    async def meta(request: Request) -> dict:
        c: Container = request.app.state.container
        return {
            "llm": c.llm.name,
            # False while Gemini is skipped after a quota or network failure (LLM_BACKEND=auto).
            "llm_online": getattr(c.llm, "online", c.llm.name != "fake"),
            "graph": graph_target(c.settings),
            "store": c.settings.store_backend,
            "assistant": request.app.state.guardian is not None,
            "recruiter_list": {"source": c.recruiters.source, "count": c.recruiters.count()},
            "countries": [{"code": p.code, "name": p.name, "kind": p.kind, "status": p.status} for p in c.packs.all()],
            "content_is_draft": any(p.status != "verified" for p in c.packs.all()),
        }

    for module in (checks, destinations, recruiters, cases, assistant):
        app.include_router(module.router)
    app.include_router(staff.ngo)
    app.include_router(staff.admin)
    return app


app = create_app()
