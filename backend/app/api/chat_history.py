"""Server-side chat message history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.schemas.chat_history import (
    ChatMessageOut,
    ChatMessagesReplace,
)

router = APIRouter(tags=["chat-history"])


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


def _row_to_out(row: dict[str, Any]) -> ChatMessageOut:
    return ChatMessageOut(
        id=row["id"],
        role=row["role"],
        content=row.get("content") or "",
        routing_badge=row.get("routing_badge"),
        sdlc_phase=row.get("sdlc_phase"),
        created_at=row["created_at"],
        sort_index=int(row.get("sort_index") or 0),
    )


def _map_supabase_error(exc: Exception) -> HTTPException:
    message = str(exc)
    lowered = message.lower()
    if (
        "chat_messages" in lowered
        or "chat_threads" in lowered
        or "pgrst205" in lowered
        or "schema cache" in lowered
        or "foreign key" in lowered
    ):
        return HTTPException(
            status_code=503,
            detail=(
                "chat history tables missing or incomplete — apply "
                "backend/migrations/02_chat_messages.sql and "
                "03_chat_threads.sql in Supabase"
            ),
        )
    return HTTPException(status_code=502, detail=f"Supabase error: {exc}")


def _ensure_thread(client: Any, workspace_id: UUID, thread_id: UUID) -> None:
    """Create a stub chat_threads row if missing so FK inserts succeed."""
    try:
        existing = (
            client.table("chat_threads")
            .select("id")
            .eq("id", str(thread_id))
            .limit(1)
            .execute()
        )
        if existing.data:
            now = datetime.now(timezone.utc).isoformat()
            client.table("chat_threads").update({"updated_at": now}).eq(
                "id", str(thread_id)
            ).execute()
            return
        now = datetime.now(timezone.utc).isoformat()
        client.table("chat_threads").insert(
            {
                "id": str(thread_id),
                "workspace_id": str(workspace_id),
                "title": "New chat",
                "created_at": now,
                "updated_at": now,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        # Table may be missing before migration 03 — let message ops surface that.
        raise _map_supabase_error(exc) from exc


@router.get(
    "/workspaces/{workspace_id}/threads/{thread_id}/messages",
    response_model=list[ChatMessageOut],
)
async def list_thread_messages(
    workspace_id: UUID,
    thread_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[ChatMessageOut]:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    try:
        result = (
            client.table("chat_messages")
            .select("*")
            .eq("workspace_id", str(workspace_id))
            .eq("thread_id", str(thread_id))
            .order("sort_index")
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    rows = result.data or []
    return [_row_to_out(row) for row in rows]


@router.put(
    "/workspaces/{workspace_id}/threads/{thread_id}/messages",
    response_model=list[ChatMessageOut],
)
async def replace_thread_messages(
    workspace_id: UUID,
    thread_id: UUID,
    payload: ChatMessagesReplace,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[ChatMessageOut]:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    _ensure_thread(client, workspace_id, thread_id)

    try:
        (
            client.table("chat_messages")
            .delete()
            .eq("workspace_id", str(workspace_id))
            .eq("thread_id", str(thread_id))
            .execute()
        )

        if not payload.messages:
            return []

        now = datetime.now(timezone.utc).isoformat()
        rows: list[dict[str, Any]] = []
        for index, message in enumerate(payload.messages):
            created = message.created_at.isoformat() if message.created_at else now
            rows.append(
                {
                    "id": str(message.id),
                    "workspace_id": str(workspace_id),
                    "thread_id": str(thread_id),
                    "role": message.role,
                    "content": message.content or "",
                    "routing_badge": message.routing_badge,
                    "sdlc_phase": message.sdlc_phase,
                    "created_at": created,
                    "sort_index": message.sort_index if message.sort_index else index,
                }
            )

        insert = client.table("chat_messages").insert(rows).execute()
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc

    inserted = insert.data or rows
    inserted_sorted = sorted(
        inserted,
        key=lambda row: int(row.get("sort_index") or 0),
    )
    return [_row_to_out(row) for row in inserted_sorted]


@router.delete(
    "/workspaces/{workspace_id}/threads/{thread_id}/messages",
    response_model=dict[str, str | int],
)
async def delete_thread_messages(
    workspace_id: UUID,
    thread_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> dict[str, str | int]:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    try:
        result = (
            client.table("chat_messages")
            .delete()
            .eq("workspace_id", str(workspace_id))
            .eq("thread_id", str(thread_id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise _map_supabase_error(exc) from exc
    purged = len(result.data or [])
    return {
        "status": "deleted",
        "workspace_id": str(workspace_id),
        "thread_id": str(thread_id),
        "purged": purged,
    }
