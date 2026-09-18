from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    custom_instructions: str | None = None
    custom_host_path: str | None = None


class WorkspaceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    tech_stack: list[str] | None = None
    custom_instructions: str | None = None


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    custom_instructions: str | None = None
    owner_id: UUID | None = None
    created_at: datetime
