from fastapi import FastAPI

from backend.app.api.chat import router as chat_router
from backend.app.api.chat_history import router as chat_history_router
from backend.app.api.deliverables import router as deliverables_router
from backend.app.api.models import router as models_router
from backend.app.api.threads import router as threads_router
from backend.app.api.workspace_fs import router as workspace_fs_router
from backend.app.api.workspaces import router as workspaces_router

app = FastAPI(title="Fuzyo Copilot API")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(workspaces_router, prefix="/api/v1")
app.include_router(workspace_fs_router, prefix="/api/v1")
app.include_router(deliverables_router, prefix="/api/v1")
app.include_router(chat_history_router, prefix="/api/v1")
app.include_router(threads_router, prefix="/api/v1")
app.include_router(models_router, prefix="/api/v1")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
