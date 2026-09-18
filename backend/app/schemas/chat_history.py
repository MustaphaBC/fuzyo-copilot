"""Pydantic schemas for server-side chat message history."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    role: Literal["user", "assistant"]
    content: str = ""
    routing_badge: str | None = None
    sdlc_phase: int | None = Field(default=None, ge=1, le=9)
    sort_index: int = Field(default=0, ge=0)
    created_at: datetime | None = None


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    role: Literal["user", "assistant"]
    content: str = ""
    routing_badge: str | None = None
    sdlc_phase: int | None = None
    created_at: datetime
    sort_index: int = 0


class ChatMessagesReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessageIn] = Field(default_factory=list)
