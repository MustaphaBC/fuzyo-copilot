"""CRUD for server-side chat threads."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.schemas.thread import ThreadCreate, ThreadOut, ThreadUpdate

router = APIRouter(tags=["threads"])


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


def _map_supabase_error(exc: Exception) -> HTTPException:
    message = str(exc)
    lowered = message.lower()
    if "chat_threads" in lowered or "pgrst205" in lowered or "schema cache" in lowered:
        return HTTPException(
            status_code=503,
            detail=(
                "chat_threads table missing — apply "
                "backend/migrations/03_chat_threads.sql in Supabase"
            ),
        )
    return HTTPException(status_code=502, detail=f"Supabase error: {exc}")


def _row_to_out(row: dict[str, Any]) -> ThreadOut:
    return ThreadOut(
        id=row["id"],
        workspace_id=row["workspace_id"],
        title=row.get("title") or "New chat",
        is_pinned=bool(row.get("is_pinned")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_thread_owned(client: Any, thread_id: UUID, owner_id: UUID) -> dict[str, Any]:
    result = (
        client.table("chat_threads")
        .select("*")
        .eq("id", str(thread_id))
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Thread not found")
    row = rows[0]
    ensure_owned_workspace(client, UUID(str(row["workspace_id"])), owner_id)
    return row


@router.get(
    "/workspaces/{workspace_id}/threads",
    response_model=list[ThreadOut],
)
async def list_threads(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[ThreadOut]:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    try:
        result = (
            client.table("chat_threads")
            .select("*")
            .eq("workspace_id", str(workspace_id))
            .order("updated_at", desc=True)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    return [_row_to_out(row) for row in (result.data or [])]


@router.post(
    "/workspaces/{workspace_id}/threads",
    response_model=ThreadOut,
)
async def create_thread(
    workspace_id: UUID,
    payload: ThreadCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> ThreadOut:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    now = datetime.now(timezone.utc).isoformat()
    thread_id = str(payload.id) if payload.id else str(uuid4())
    row = {
        "id": thread_id,
        "workspace_id": str(workspace_id),
        "title": payload.title or "New chat",
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = client.table("chat_threads").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    inserted = (result.data or [row])[0]
    return _row_to_out(inserted)


@router.patch(
    "/threads/{thread_id}",
    response_model=ThreadOut,
)
async def update_thread(
    thread_id: UUID,
    payload: ThreadUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> ThreadOut:
    client = _supabase()
    _ensure_thread_owned(client, thread_id, user.id)
    updates: dict[str, Any] = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.is_pinned is not None:
        updates["is_pinned"] = payload.is_pinned
    try:
        result = (
            client.table("chat_threads")
            .update(updates)
            .eq("id", str(thread_id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Thread not found")
    return _row_to_out(rows[0])


@router.delete(
    "/threads/{thread_id}",
    response_model=dict[str, str],
)
async def delete_thread(
    thread_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, str]:
    client = _supabase()
    _ensure_thread_owned(client, thread_id, user.id)
    try:
        result = (
            client.table("chat_threads")
            .delete()
            .eq("id", str(thread_id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    if not (result.data or []):
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"status": "deleted", "thread_id": str(thread_id)}
