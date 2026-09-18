"""UAT sign-off request/response schemas."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UatSignOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: UUID
    phase: int = Field(ge=1, le=9)
    validator_name: str = Field(min_length=1, max_length=200)
    project_name: str | None = Field(default=None, max_length=200)
    notes: str = Field(default="", max_length=4000)
    deliverables: list[str] = Field(default_factory=list)
    accepted: bool = True


class UatSignOffResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: UUID
    phase: int
    project_name: str
    phase_title: str
    signed_at_utc: str
    content_sha256: str
    accepted: bool
    pvr_relative_path: str
    uat_sheet_relative_path: str
    deliverables: list[str]
