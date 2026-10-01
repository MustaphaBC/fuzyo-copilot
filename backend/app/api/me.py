"""Current-user profile and persisted settings (migration 07)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.app.api.deps import CurrentUser, get_current_user
from backend.app.core.config import settings as app_settings
from backend.app.core.logging_config import get_logger
from supabase import create_client

router = APIRouter(tags=["me"])
_log = get_logger("fuzyo.me")


class UserSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    appearance: Literal["dark", "light", "system"] = "system"
    density: Literal["comfortable", "compact"] = "comfortable"
    privacy_mode: Literal["auto", "confidential"] = "auto"
    default_sdlc_phase: int = Field(default=1, ge=1, le=9)
    auto_open_inspector: bool = True
    auto_open_canvas: bool = True


class UserSettingsResponse(BaseModel):
    settings: UserSettings
    persisted: bool
    updated_at: str | None = None


class MeResponse(BaseModel):
    id: str
    email: str | None
    role: str
    full_name: str | None
    organization: str | None
    is_platform_admin: bool


def _client() -> Any | None:
    url = (app_settings.supabase_url or "").strip()
    key = (app_settings.supabase_secret_key or "").strip()
    if not url or not key:
        return None
    try:
        return create_client(url, key)
    except Exception:  # noqa: BLE001
        return None


def coerce_settings(raw: Any) -> UserSettings:
    """Stored JSON → validated settings; invalid values fall back to defaults."""
    if not isinstance(raw, dict):
        return UserSettings()
    try:
        return UserSettings.model_validate(raw)
    except ValidationError:
        defaults = UserSettings().model_dump()
        merged: dict[str, Any] = {}
        for key, default in defaults.items():
            candidate = {**defaults, key: raw.get(key, default)}
            try:
                UserSettings.model_validate(candidate)
                merged[key] = candidate[key]
            except ValidationError:
                merged[key] = default
        return UserSettings.model_validate(merged)


@router.get("/me", response_model=MeResponse)
async def get_me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(
        id=str(user.id),
        email=user.email,
        role=user.role,
        full_name=user.full_name,
        organization=user.organization,
        is_platform_admin=user.is_platform_admin,
    )


@router.get("/me/settings", response_model=UserSettingsResponse)
async def get_my_settings(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> UserSettingsResponse:
    client = _client()
    if client is None:
        return UserSettingsResponse(settings=UserSettings(), persisted=False)
    try:
        result = (
            client.table("user_settings")
            .select("settings, updated_at")
            .eq("user_id", str(user.id))
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        # Table missing until migration 07 is applied: serve defaults.
        _log.warning("user_settings_read_failed", error=str(exc))
        return UserSettingsResponse(settings=UserSettings(), persisted=False)
    rows = result.data or []
    if not rows:
        return UserSettingsResponse(settings=UserSettings(), persisted=True)
    row = rows[0]
    return UserSettingsResponse(
        settings=coerce_settings(row.get("settings")),
        persisted=True,
        updated_at=row.get("updated_at"),
    )


@router.put("/me/settings", response_model=UserSettingsResponse)
async def put_my_settings(
    payload: UserSettings,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> UserSettingsResponse:
    client = _client()
    if client is None:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    now = datetime.now(timezone.utc).isoformat()
    try:
        client.table("user_settings").upsert(
            {
                "user_id": str(user.id),
                "settings": payload.model_dump(),
                "updated_at": now,
            },
            on_conflict="user_id",
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Settings not persisted (apply migration 07_user_settings.sql): {exc}",
        ) from exc
    return UserSettingsResponse(settings=payload, persisted=True, updated_at=now)
