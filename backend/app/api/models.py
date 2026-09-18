"""Dynamic model registry — surfaces providers with configured API keys."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from backend.app.api.deps import CurrentUser, get_current_user
from backend.app.services.model_registry import list_available_models

router = APIRouter(tags=["models"])


class AvailableModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    id: str
    label: str = Field(min_length=1)


@router.get("/models/available", response_model=list[AvailableModel])
async def models_available(
    _user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[AvailableModel]:
    return [AvailableModel(**row) for row in list_available_models()]
