"""Pydantic schemas for server-side chat threads."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID | None = None
    title: str = Field(default="New chat", min_length=1, max_length=255)


class ThreadUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    is_pinned: bool | None = None


class ThreadOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    workspace_id: UUID
    title: str
    is_pinned: bool = False
    created_at: datetime
    updated_at: datetime
