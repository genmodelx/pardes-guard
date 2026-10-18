"""Authentication and roles.

Production: Firebase Authentication ID tokens (phone OTP for workers and families, email or SSO for
NGO staff and admins). Roles come from a custom claim `role` set by an admin script.
Dev: the X-Dev-User and X-Dev-Role headers, accepted only when AUTH_MODE=dev.
Demo (a public sandbox, such as a free host): every caller is a worker. X-Dev-User may name one, so
a person can read back their own checks; X-Dev-Role is ignored, so nobody reaches the staff routes.
"""

from __future__ import annotations

import logging
import re
import threading

from fastapi import Depends, Header, HTTPException, Request, status

from app.config import Settings, get_settings
from app.schemas import Role, User

log = logging.getLogger(__name__)

_ROLES: set[str] = {"worker", "family", "ngo", "admin"}
_DEV_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_firebase_lock = threading.Lock()
_firebase_ready = False


def _init_firebase(project: str) -> None:
    global _firebase_ready
    with _firebase_lock:
        if _firebase_ready:
            return
        import firebase_admin

        if not firebase_admin._apps:  # noqa: SLF001 - documented way to check initialisation
            firebase_admin.initialize_app(options={"projectId": project} if project else None)
        _firebase_ready = True


def _verify_firebase(token: str, settings: Settings) -> User:
    _init_firebase(settings.google_cloud_project)
    from firebase_admin import auth as fb_auth

    try:
        claims = fb_auth.verify_id_token(token, check_revoked=False)
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired sign-in") from exc
    role = claims.get("role", "worker")
    return User(id=claims["uid"], role=role if role in _ROLES else "worker")  # type: ignore[arg-type]


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
    x_dev_role: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> User:
    if settings.auth_mode in ("dev", "demo"):
        uid = x_dev_user or "demo-worker"
        if not _DEV_ID.match(uid):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad dev user id")
        # A role is never taken from the client outside local development.
        role = x_dev_role if settings.auth_mode == "dev" and x_dev_role in _ROLES else "worker"
        return User(id=uid, role=role)  # type: ignore[arg-type]
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required")
    return _verify_firebase(authorization.split(" ", 1)[1].strip(), settings)


def require_role(*roles: Role):
    async def checker(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")
        return user

    return checker


async def scheduler_only(
    authorization: str | None = Header(default=None), settings: Settings = Depends(get_settings)
) -> None:
    """Cloud Scheduler calls /api/cases/tick with an OIDC token for our audience."""
    if settings.auth_mode == "dev":
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    if not settings.scheduler_audience:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "SCHEDULER_AUDIENCE is not configured")
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            authorization.split(" ", 1)[1], ga_requests.Request(), audience=settings.scheduler_audience
        )
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad scheduler token") from exc
    if settings.scheduler_service_account and claims.get("email") != settings.scheduler_service_account:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Unexpected caller")
