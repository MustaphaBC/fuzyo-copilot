"""Optional Sentry initialization (no-op without SENTRY_DSN)."""

from __future__ import annotations

from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from backend.app.core.config import settings
from backend.app.core.logging_config import get_logger

_log = get_logger("fuzyo.sentry")
_initialized = False


def init_sentry() -> bool:
    """Init Sentry SDK when DSN is configured. Returns True if enabled."""
    global _initialized
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        _log.info("sentry_disabled", reason="missing_dsn")
        return False
    if _initialized:
        return True

    sentry_sdk.init(
        dsn=dsn,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        traces_sample_rate=float(settings.sentry_traces_sample_rate or 0.0),
        send_default_pii=False,
        environment=(settings.sentry_environment or "development").strip()
        or "development",
    )
    _initialized = True
    _log.info("sentry_enabled", environment=settings.sentry_environment)
    return True


def capture_sse_exception(exc: BaseException, **context: Any) -> None:
    """Capture mid-stream SSE failures without re-raising (keeps Uvicorn alive)."""
    safe = {
        key: value
        for key, value in context.items()
        if key
        not in {
            "prompt",
            "system_prompt",
            "content",
            "messages",
            "raw",
            "body",
        }
    }
    _log.error(
        "sse_stream_error",
        error_type=type(exc).__name__,
        error=str(exc)[:300],
        **safe,
    )
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn and not _initialized:
        return
    try:
        with sentry_sdk.push_scope() as scope:
            for key, value in safe.items():
                scope.set_extra(key, value)
            scope.set_tag("stream", "sse")
            sentry_sdk.capture_exception(exc)
    except Exception:  # noqa: BLE001
        _log.warning("sentry_capture_failed")
