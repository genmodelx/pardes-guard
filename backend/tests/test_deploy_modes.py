"""The public sandbox (ENV=demo) and the API's own Firestore database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.main import create_app

SECRETS = {"hash_salt": "s" * 40, "evidence_signing_key": "k" * 40}


def test_the_sandbox_refuses_dev_sign_in_and_dev_secrets():
    with pytest.raises(RuntimeError, match="AUTH_MODE"):
        build_container(Settings(_env_file=None, env="demo", auth_mode="dev", llm_backend="fake", **SECRETS))
    with pytest.raises(RuntimeError, match="HASH_SALT"):
        build_container(Settings(_env_file=None, env="demo", auth_mode="demo", llm_backend="fake"))


def test_the_sandbox_starts_with_demo_sign_in_and_shows_the_api_docs():
    settings = Settings(_env_file=None, env="demo", auth_mode="demo", llm_backend="fake", **SECRETS)
    with TestClient(create_app(settings, container=build_container(settings))) as client:
        assert client.get("/api/docs").status_code == 200
        assert client.get("/healthz").status_code == 200


def test_the_api_writes_to_the_firestore_database_it_is_given(monkeypatch):
    seen = {}

    class Recorder:
        def __init__(self, project, database="(default)"):
            seen.update(project=project, database=database)

        def where(self, *args, **kwargs):  # approved content is replayed at start
            return []

    monkeypatch.setattr("app.container.FirestoreStore", Recorder)
    build_container(
        Settings(_env_file=None, store_backend="firestore", google_cloud_project="pardes-ea3e1", firestore_database="pardes-api", llm_backend="fake")
    )
    assert seen == {"project": "pardes-ea3e1", "database": "pardes-api"}
