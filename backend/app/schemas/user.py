"""User / profile schemas."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserProfileOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    email: str | None = None
    full_name: str | None = None
    role: str = Field(default="developer")
    organization: str | None = None
