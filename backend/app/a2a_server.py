"""Entry point for the public A2A service: `uvicorn app.a2a_server:app`.

Set A2A_PUBLIC_URL to the service's public https URL so the agent card advertises the right address.
"""

from __future__ import annotations

import os

from app.agents.a2a import build_public_a2a_app
from app.config import export_genai_env, get_settings
from app.container import build_container

_settings = get_settings()
export_genai_env(_settings)
app = build_public_a2a_app(build_container(_settings), public_url=os.environ.get("A2A_PUBLIC_URL", "http://localhost:8081"))
