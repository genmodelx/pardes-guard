from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.main import create_app
from app.schemas import User


@pytest.fixture
def settings() -> Settings:
    return Settings(env="test", llm_backend="fake", store_backend="memory", auth_mode="dev")


@pytest.fixture
def container(settings):
    return build_container(settings)


@pytest.fixture
def client(settings, container):
    with TestClient(create_app(settings, container=container)) as c:
        yield c


@pytest.fixture
def worker() -> User:
    return User(id="w1", role="worker")


@pytest.fixture(autouse=True)
def _relax_rate_limits():
    """Rate limiting has its own test; elsewhere it would only make test order matter."""
    from app import deps

    saved = [(lim, lim.capacity, lim.rate) for lim in (deps.check_limiter, deps.public_limiter)]
    for lim, _, _ in saved:
        lim.capacity, lim.rate = 10_000.0, 10_000.0
        lim._buckets.clear()
    yield
    for lim, cap, rate in saved:
        lim.capacity, lim.rate = cap, rate
        lim._buckets.clear()
