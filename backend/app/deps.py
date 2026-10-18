"""FastAPI dependencies shared by routers."""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request, UploadFile, status

from app.container import Container
from app.services.security import UploadRejected, ValidatedFile, validate_upload


def get_container(request: Request) -> Container:
    return request.app.state.container


async def read_upload(upload: UploadFile, max_bytes: int) -> ValidatedFile:
    # Read one byte past the limit so oversize files are rejected without buffering more than needed.
    data = await upload.read(max_bytes + 1)
    try:
        return validate_upload(upload.filename, data, max_bytes)
    except UploadRejected as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{upload.filename or 'file'}: {exc}") from exc


class RateLimiter:
    """Small per-client token bucket. Cloud Armor rate limits sit in front of this in production."""

    def __init__(self, per_minute: int) -> None:
        self.rate = per_minute / 60.0
        self.capacity = float(per_minute)
        self._buckets: dict[str, tuple[float, float]] = defaultdict(lambda: (self.capacity, time.monotonic()))
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        with self._lock:
            tokens, last = self._buckets[key]
            now = time.monotonic()
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens < 1:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests, please wait a minute")
            self._buckets[key] = (tokens - 1, now)


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


check_limiter = RateLimiter(per_minute=20)
public_limiter = RateLimiter(per_minute=60)
