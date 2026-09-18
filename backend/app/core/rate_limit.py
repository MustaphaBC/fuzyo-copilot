"""Shared SlowAPI limiter (avoid circular imports with route modules)."""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def rate_limit_key(request: Request) -> str:
    """Prefer authenticated principal; fall back to client IP."""
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer ") and len(auth) > 15:
        token = auth[7:].strip()
        return f"bearer:{token[:24]}"
    return get_remote_address(request)


limiter = Limiter(key_func=rate_limit_key, headers_enabled=True)
