from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend.app.api.chat import router as chat_router
from backend.app.api.chat_history import router as chat_history_router
from backend.app.api.deliverables import router as deliverables_router
from backend.app.api.models import router as models_router
from backend.app.api.threads import router as threads_router
from backend.app.api.uat_signoff import router as uat_router
from backend.app.api.workspace_fs import router as workspace_fs_router
from backend.app.api.workspaces import router as workspaces_router
from backend.app.core.audit import AuditFsMiddleware
from backend.app.core.logging_config import configure_structlog, get_logger
from backend.app.core.rate_limit import limiter
from backend.app.core.sentry_setup import init_sentry

_log = get_logger("fuzyo.api")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    configure_structlog()
    enabled = init_sentry()
    _log.info("app_startup", sentry=enabled)
    yield
    _log.info("app_shutdown")


app = FastAPI(title="Fuzyo Copilot API", lifespan=lifespan)
app.state.limiter = limiter


def _retry_after_seconds(exc: RateLimitExceeded) -> int:
    limit = getattr(exc, "limit", None)
    if limit is not None and callable(getattr(limit, "get_expiry", None)):
        try:
            expiry = int(limit.get_expiry() or 60)
            return max(1, expiry)
        except (TypeError, ValueError):
            pass
    return 60


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> JSONResponse:
    """JSON 429 with Retry-After — does not interrupt successful SSE streams."""
    retry_after = _retry_after_seconds(exc)
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Try again later.",
            "retry_after": retry_after,
        },
        headers={"Retry-After": str(retry_after)},
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(AuditFsMiddleware)

app.include_router(chat_router, prefix="/api/v1")
app.include_router(workspaces_router, prefix="/api/v1")
app.include_router(workspace_fs_router, prefix="/api/v1")
app.include_router(deliverables_router, prefix="/api/v1")
app.include_router(uat_router, prefix="/api/v1")
app.include_router(chat_history_router, prefix="/api/v1")
app.include_router(threads_router, prefix="/api/v1")
app.include_router(models_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
