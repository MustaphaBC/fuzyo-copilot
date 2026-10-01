"""FastAPI dependencies for authenticated requests.

Verified users (keyed by sha256 of the bearer token) and workspace ownership
rows (keyed by owner + workspace) are memoised in bounded in-process TTL caches
(``AUTH_CACHE_TTL_SECONDS``; 0 disables). Only successful results are cached,
token entries never outlive the token's ``exp``, and mutation routes call
``ensure_owned_workspace(..., fresh=True)`` to bypass the ownership cache.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import time
from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client

from backend.app.core.config import settings
from backend.app.core.rbac import is_admin, normalize_role
from backend.app.core.security import LocalVerificationUnavailableError, decode_supabase_jwt
from backend.app.core.ttl_cache import TTLCache

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: UUID
    email: str | None = None
    role: str = "developer"
    full_name: str | None = None
    organization: str | None = None
    # Only app_metadata (service-role controlled) can grant platform admin;
    # user_metadata is self-editable at signup.
    is_platform_admin: bool = False


_CACHE_MAX_ENTRIES = max(1, int(settings.auth_cache_max_entries))
_token_cache: TTLCache[str, CurrentUser] = TTLCache(_CACHE_MAX_ENTRIES)
_ownership_cache: TTLCache[tuple[str, str], dict[str, Any]] = TTLCache(_CACHE_MAX_ENTRIES)


def _meta_str(meta: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = meta.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _cache_ttl() -> float:
    return max(0.0, float(settings.auth_cache_ttl_seconds))


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _token_cache_ttl(exp: Any) -> float:
    """Cache lifetime capped by the token's ``exp``; tokens without one are not cached."""
    if isinstance(exp, bool) or not isinstance(exp, (int, float)):
        return 0.0
    return min(_cache_ttl(), float(exp) - time.time())


def _unverified_exp(token: str) -> Any:
    """Read ``exp`` only to bound caching of a token Supabase already validated."""
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None
    return claims.get("exp")


def _build_user(sub: Any, email: Any, user_meta: Any, app_meta: Any) -> CurrentUser:
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    try:
        user_id = UUID(str(sub))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid subject") from exc

    if not isinstance(user_meta, dict):
        user_meta = {}
    if not isinstance(app_meta, dict):
        app_meta = {}

    role = normalize_role(
        _meta_str(user_meta, "role") or _meta_str(app_meta, "role")
    )
    full_name = _meta_str(user_meta, "full_name", "fullName", "name")
    organization = _meta_str(user_meta, "organization", "org")
    app_role = _meta_str(app_meta, "role")
    platform_admin = bool(app_role) and is_admin(app_role)

    return CurrentUser(
        id=user_id,
        email=str(email) if email else None,
        role=role,
        full_name=full_name,
        organization=organization,
        is_platform_admin=platform_admin,
    )


def _supabase() -> Any | None:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:  # noqa: BLE001
        return None


async def _verify_remotely(token: str, local_error: str) -> CurrentUser:
    """Authoritative check via Supabase Auth when the token can't be verified locally."""
    client = _supabase()
    if client is None:
        raise HTTPException(status_code=401, detail=local_error)
    try:
        response = await asyncio.to_thread(client.auth.get_user, token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    remote = getattr(response, "user", None)
    if remote is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return _build_user(
        getattr(remote, "id", None),
        getattr(remote, "email", None),
        getattr(remote, "user_metadata", None),
        getattr(remote, "app_metadata", None),
    )


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer),
    ],
) -> CurrentUser:
    if credentials is None or not (credentials.credentials or "").strip():
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials.strip()
    cache_key = _token_key(token)
    cached = _token_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        payload = decode_supabase_jwt(token)
    except LocalVerificationUnavailableError as exc:
        user = await _verify_remotely(token, str(exc))
        exp = _unverified_exp(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    else:
        user = _build_user(
            payload.get("sub"),
            payload.get("email"),
            payload.get("user_metadata") or {},
            payload.get("app_metadata") or {},
        )
        exp = payload.get("exp")

    _token_cache.set(cache_key, user, _token_cache_ttl(exp))
    return user


async def require_admin(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Gate admin endpoints on the server-controlled app_metadata role."""
    if not user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def ensure_owned_workspace(
    client: Any,
    workspace_id: UUID,
    owner_id: UUID,
    *,
    fresh: bool = False,
) -> dict[str, Any]:
    """Return workspace row if owned by user; else 404 (no existence leak).

    ``fresh=True`` skips the ownership cache (use before mutations); the
    fresh result still refreshes the cache. Callers get a private copy.
    """
    cache_key = (str(owner_id), str(workspace_id))
    if not fresh:
        cached = _ownership_cache.get(cache_key)
        if cached is not None:
            return copy.deepcopy(cached)

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
        _ownership_cache.pop(cache_key)
        raise HTTPException(status_code=404, detail="Workspace not found")
    row = rows[0]
    _ownership_cache.set(cache_key, copy.deepcopy(row), _cache_ttl())
    return row


def invalidate_workspace(workspace_id: UUID | str) -> None:
    """Drop cached ownership rows for a workspace (call after update/delete)."""
    target = str(workspace_id)
    _ownership_cache.discard_where(lambda key, _row: key[1] == target)


def invalidate_user(user_id: UUID | str) -> None:
    """Drop cached identities and ownership rows for a user (role/ownership change)."""
    target = str(user_id)
    _token_cache.discard_where(lambda _key, user: str(user.id) == target)
    _ownership_cache.discard_where(lambda key, _row: key[0] == target)


def clear_auth_caches() -> None:
    _token_cache.clear()
    _ownership_cache.clear()
