"""Builds every service once from settings. Routers and agents get them from here."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.llm.base import LLM
from app.packs import PackRegistry
from app.services.cases import CaseService, Dispatcher
from app.services.content import ContentService
from app.services.evidence import HmacSigner, KmsSigner, Signer
from app.services.network import GraphStore, MemoryGraphStore
from app.services.pipeline import CheckPipeline
from app.services.privacy import Hasher, Masker, SensitiveDataProtection
from app.services.recruiters import BUNDLED_SAMPLE, RecruiterDirectory
from app.services.security import ModelArmorScreen, screen_locally
from app.services.vault import BlobStore, EvidenceVault, GcsBlobStore, MemoryBlobStore
from app.storage import DocStore, FirestoreStore, MemoryStore

log = logging.getLogger(__name__)


@dataclass
class Container:
    settings: Settings
    store: DocStore
    packs: PackRegistry
    recruiters: RecruiterDirectory
    hasher: Hasher
    graph: GraphStore
    masker: Masker
    llm: LLM
    pipeline: CheckPipeline
    cases: CaseService
    vault: EvidenceVault
    content: ContentService
    signer: Signer


def _llm(settings: Settings) -> LLM:
    if settings.llm_backend == "gemini":
        from app.llm.gemini import GeminiLLM

        return GeminiLLM(settings)
    if settings.llm_backend == "auto":
        from app.llm.resilient import ResilientLLM

        if not settings.gemini_configured:
            log.warning("LLM_BACKEND=auto with no GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT: offline path only")
            return ResilientLLM(None)
        from app.llm.gemini import GeminiLLM

        return ResilientLLM(GeminiLLM(settings), cooldown_seconds=settings.ai_cooldown_seconds)
    from app.llm.fake import FakeLLM

    return FakeLLM()


def graph_target(settings: Settings) -> str:
    """Where the integrity graph lives: "memory", "spanner-emulator" or "spanner"."""
    import os

    if settings.graph_backend != "spanner":
        return "memory"
    return "spanner-emulator" if (settings.spanner_emulator_host or os.environ.get("SPANNER_EMULATOR_HOST")) else "spanner"


def _graph(settings: Settings, hasher: Hasher) -> GraphStore:
    if settings.graph_backend == "spanner":
        import os

        from app.services.network_spanner import SpannerGraphStore

        if settings.spanner_emulator_host:
            # The client library reads the emulator address from the real environment only, and
            # pydantic-settings does not copy .env values there. A value set in the shell wins.
            os.environ.setdefault("SPANNER_EMULATOR_HOST", settings.spanner_emulator_host)
        project = settings.spanner_target_project
        if not (project and settings.spanner_instance and settings.spanner_database):
            raise RuntimeError(
                "GRAPH_BACKEND=spanner needs SPANNER_PROJECT (or GOOGLE_CLOUD_PROJECT), SPANNER_INSTANCE and SPANNER_DATABASE"
            )
        where = f"emulator at {os.environ['SPANNER_EMULATOR_HOST']}" if os.environ.get("SPANNER_EMULATOR_HOST") else "Cloud Spanner"
        log.info(
            "Integrity graph: Spanner (%s), projects/%s/instances/%s/databases/%s",
            where,
            project,
            settings.spanner_instance,
            settings.spanner_database,
        )
        return SpannerGraphStore(project, settings.spanner_instance, settings.spanner_database, hasher)
    return MemoryGraphStore(hasher)


def build_container(settings: Settings, dispatcher: Dispatcher | None = None) -> Container:
    if settings.is_prod:
        problems = settings.validate_for_prod()
        if problems:
            raise RuntimeError("Refusing to start in prod: " + "; ".join(problems))
    if settings.env == "demo":
        problems = settings.validate_for_demo()
        if problems:
            raise RuntimeError("Refusing to start the public sandbox: " + "; ".join(problems))

    store: DocStore = (
        FirestoreStore(settings.google_cloud_project, settings.firestore_database)
        if settings.store_backend == "firestore"
        else MemoryStore()
    )
    blobs: BlobStore = GcsBlobStore(settings.gcs_bucket) if settings.gcs_bucket else MemoryBlobStore()
    packs = PackRegistry(Path(settings.packs_dir) if settings.packs_dir else None)

    recruiters = RecruiterDirectory()
    if settings.recruiters_csv:
        n = recruiters.load_file(Path(settings.recruiters_csv), source="official_list")
        log.info("Loaded %d licensed recruiters from the official list", n)
    else:
        n = recruiters.load_file(BUNDLED_SAMPLE, source="sample")
        log.warning("Loaded %d FICTIONAL sample recruiters; import the official list before launch", n)

    hasher = Hasher(settings.hash_salt)
    graph = _graph(settings, hasher)
    sdp = SensitiveDataProtection(settings.google_cloud_project) if settings.use_sensitive_data_protection else None
    masker = Masker(sdp)
    screen = ModelArmorScreen(settings.model_armor_template).screen if settings.model_armor_template else screen_locally
    signer: Signer = KmsSigner(settings.kms_key_version) if settings.kms_key_version else HmacSigner(settings.evidence_signing_key)
    llm = _llm(settings)

    pipeline = CheckPipeline(
        llm=llm, packs=packs, recruiters=recruiters, graph=graph, masker=masker, store=store, screen=screen
    )
    content = ContentService(store, packs, llm)
    replayed = content.replay_approved()
    if replayed:
        log.info("Replayed %d approved content updates", replayed)

    return Container(
        settings=settings,
        store=store,
        packs=packs,
        recruiters=recruiters,
        hasher=hasher,
        graph=graph,
        masker=masker,
        llm=llm,
        pipeline=pipeline,
        cases=CaseService(store, packs, dispatcher),
        vault=EvidenceVault(store, blobs, signer),
        content=content,
        signer=signer,
    )
