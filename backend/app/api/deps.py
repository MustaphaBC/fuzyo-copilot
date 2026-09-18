"""FastAPI dependencies for authenticated requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.app.core.rbac import normalize_role
from backend.app.core.security import decode_supabase_jwt

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: UUID
    email: str | None = None
    role: str = "developer"
    full_name: str | None = None
    organization: str | None = None


def _meta_str(meta: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = meta.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer),
    ],
) -> CurrentUser:
    if credentials is None or not (credentials.credentials or "").strip():
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_supabase_jwt(credentials.credentials.strip())
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")

    try:
        user_id = UUID(str(sub))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid subject") from exc

    email = payload.get("email")
    user_meta = payload.get("user_metadata") or {}
    app_meta = payload.get("app_metadata") or {}
    if not isinstance(user_meta, dict):
        user_meta = {}
    if not isinstance(app_meta, dict):
        app_meta = {}

    role = normalize_role(
        _meta_str(user_meta, "role") or _meta_str(app_meta, "role")
    )
    full_name = _meta_str(user_meta, "full_name", "fullName", "name")
    organization = _meta_str(user_meta, "organization", "org")

    return CurrentUser(
        id=user_id,
        email=str(email) if email else None,
        role=role,
        full_name=full_name,
        organization=organization,
    )


def ensure_owned_workspace(
    client: Any,
    workspace_id: UUID,
    owner_id: UUID,
) -> dict[str, Any]:
    """Return workspace row if owned by user; else 404 (no existence leak)."""
    result = (
        client.table("workspaces")
        .select("*")
        .eq("id", str(workspace_id))
        .eq("owner_id", str(owner_id))
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return rows[0]
