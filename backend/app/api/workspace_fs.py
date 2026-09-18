"""Workspace local filesystem browse/edit endpoints."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.services import workspace_fs
from backend.app.services.analytics_engine import invalidate_analytics_cache
from backend.app.services.rag_service import ingest_file

router = APIRouter(tags=["workspace-fs"])


def _supabase() -> Any:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase client error: {exc}") from exc


def _require_root(workspace: dict[str, Any], workspace_id: UUID):
    root = workspace_fs.resolve_workspace_root(workspace_id)
    if root is None:
        name = workspace.get("name") or "workspace"
        try:
            root = workspace_fs.ensure_workspace_root(name, workspace_id)
        except (OSError, ValueError) as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Local workspace root not found: {exc}",
            ) from exc
    return root


class PutFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = ""


class PutFileResult(BaseModel):
    path: str
    workspace_root: str


@router.get("/workspaces/{workspace_id}/fs/tree")
async def get_workspace_fs_tree(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    path: str = Query(""),
    depth: int = Query(2, ge=0, le=6),
) -> dict[str, Any]:
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    root = _require_root(workspace, workspace_id)
    try:
        return workspace_fs.list_dir(root, path, depth=depth)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NotADirectoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Tree listing failed: {exc}") from exc


@router.get("/workspaces/{workspace_id}/fs/file")
async def get_workspace_fs_file(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    path: str = Query(..., min_length=1),
) -> dict[str, Any]:
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    root = _require_root(workspace, workspace_id)
    try:
        return workspace_fs.read_file(root, path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Read failed: {exc}") from exc


@router.put("/workspaces/{workspace_id}/fs/file", response_model=PutFileResult)
async def put_workspace_fs_file(
    workspace_id: UUID,
    payload: PutFileRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> PutFileResult:
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    root = _require_root(workspace, workspace_id)
    try:
        written = workspace_fs.write_file(root, payload.path, payload.content or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Write failed: {exc}") from exc

    invalidate_analytics_cache(workspace_id)
    try:
        await ingest_file(workspace_id, written, sdlc_phase=5)
    except Exception:  # noqa: BLE001
        pass

    return PutFileResult(path=payload.path.replace("\\", "/"), workspace_root=str(root.resolve()))
