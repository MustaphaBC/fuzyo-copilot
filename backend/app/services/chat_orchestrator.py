"""Load thread history and assemble multi-turn provider messages."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.core.config import settings
from backend.app.services.llm_base import build_chat_messages


def _supabase_client() -> Any | None:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        return None
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception:  # noqa: BLE001
        return None


def fetch_thread_history(
    workspace_id: str,
    thread_id: str,
    limit: int,
) -> list[dict[str, str]]:
    """Return the last ``limit`` user/assistant turns for a thread."""
    if limit <= 0 or not workspace_id or not thread_id:
        return []
    client = _supabase_client()
    if client is None:
        return []
    try:
        result = (
            client.table("chat_messages")
            .select("role,content,sort_index")
            .eq("workspace_id", str(workspace_id))
            .eq("thread_id", str(thread_id))
            .order("sort_index")
            .execute()
        )
    except Exception:  # noqa: BLE001
        return []

    rows = result.data or []
    turns: list[dict[str, str]] = []
    for row in rows:
        role = row.get("role")
        if role not in ("user", "assistant"):
            continue
        turns.append({"role": role, "content": row.get("content") or ""})
    if not turns:
        return []
    return turns[-limit:]


def assemble_provider_messages(
    system_prompt: str | None,
    history: list[dict[str, str]] | None,
    current_user_prompt: str,
) -> list[dict[str, str]]:
    """System at index 0, then prior turns, then the current user prompt."""
    return build_chat_messages(
        current_user_prompt,
        system_prompt=system_prompt,
        history=history,
    )


def touch_thread_updated_at(thread_id: str) -> None:
    """Best-effort bump of chat_threads.updated_at."""
    if not thread_id:
        return
    client = _supabase_client()
    if client is None:
        return
    try:
        client.table("chat_threads").update(
            {"updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", str(thread_id)).execute()
    except Exception:  # noqa: BLE001
        return
