"""Workspace knowledge base listing/deletion and SDLC phase prompt preview."""

from __future__ import annotations

from typing import Annotated, Any, Final
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.prompts.sdlc_catalog import get_phase
from backend.app.prompts.sdlc_prompts import ELITE_PROMPT_MARKERS, build_elite_system_prompt
from backend.app.services.analytics_engine import invalidate_analytics_cache
from supabase import create_client

router = APIRouter(tags=["knowledge"])

_PAGE_SIZE: Final[int] = 1000
_MAX_ROWS: Final[int] = 50_000
_DELETE_BATCH: Final[int] = 200


class KnowledgeDocument(BaseModel):
    name: str
    file_type: str | None = None
    sdlc_phase: int | None = None
    chunks: int = 0
    status: str = "indexed"
    first_indexed_at: str | None = None
    last_indexed_at: str | None = None


class KnowledgeListing(BaseModel):
    workspace_id: UUID
    document_count: int = 0
    chunk_count: int = 0
    documents: list[KnowledgeDocument] = Field(default_factory=list)


class KnowledgeDeleteResult(BaseModel):
    name: str
    deleted_chunks: int = 0


class PromptSections(BaseModel):
    role: str
    context: str
    objective: str
    constraints: str
    output_format: str


class PhasePromptPreview(BaseModel):
    phase: int
    phase_name: str
    role: str
    objective: str
    deliverables: list[str]
    system_prompt: str
    sections: PromptSections
    suggested_user_prompt: str


def _supabase() -> Any:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    try:
        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase client error: {exc}") from exc


def document_key(metadata: Any) -> str | None:
    """User-facing document name: ``metadata.name`` or basename of ``metadata.source``."""
    if not isinstance(metadata, dict):
        return None
    raw = metadata.get("name") or metadata.get("source")
    if not raw:
        return None
    text = str(raw).replace("\\", "/")
    if metadata.get("name"):
        return text
    return text.rsplit("/", 1)[-1] or None


def _fetch_chunk_rows(client: Any, workspace_id: UUID, columns: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while start < _MAX_ROWS:
        result = (
            client.table("document_chunks")
            .select(columns)
            .eq("workspace_id", str(workspace_id))
            .range(start, start + _PAGE_SIZE - 1)
            .execute()
        )
        page = result.data or []
        rows.extend(page)
        if len(page) < _PAGE_SIZE:
            break
        start += _PAGE_SIZE
    return rows


def aggregate_documents(rows: list[dict[str, Any]]) -> list[KnowledgeDocument]:
    """Group chunk rows by document name (pure; unit-tested)."""
    grouped: dict[str, KnowledgeDocument] = {}
    for row in rows:
        metadata = row.get("metadata") or {}
        key = document_key(metadata)
        if not key:
            continue
        created = row.get("created_at")
        doc = grouped.get(key)
        if doc is None:
            phase_raw = metadata.get("sdlc_phase") if isinstance(metadata, dict) else None
            try:
                phase = int(phase_raw) if phase_raw is not None else None
            except (TypeError, ValueError):
                phase = None
            doc = KnowledgeDocument(
                name=key,
                file_type=metadata.get("file_type") if isinstance(metadata, dict) else None,
                sdlc_phase=phase,
                first_indexed_at=created,
                last_indexed_at=created,
            )
            grouped[key] = doc
        doc.chunks += 1
        if created:
            if not doc.first_indexed_at or created < doc.first_indexed_at:
                doc.first_indexed_at = created
            if not doc.last_indexed_at or created > doc.last_indexed_at:
                doc.last_indexed_at = created
    return sorted(grouped.values(), key=lambda d: d.last_indexed_at or "", reverse=True)


@router.get("/workspaces/{workspace_id}/knowledge", response_model=KnowledgeListing)
async def list_knowledge(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> KnowledgeListing:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    try:
        rows = _fetch_chunk_rows(client, workspace_id, "metadata, created_at")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Knowledge listing failed: {exc}") from exc
    documents = aggregate_documents(rows)
    return KnowledgeListing(
        workspace_id=workspace_id,
        document_count=len(documents),
        chunk_count=sum(doc.chunks for doc in documents),
        documents=documents,
    )


@router.delete("/workspaces/{workspace_id}/knowledge", response_model=KnowledgeDeleteResult)
async def delete_knowledge_document(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    name: str = Query(..., min_length=1, max_length=500),
) -> KnowledgeDeleteResult:
    """Remove every chunk of one document from the workspace RAG index."""
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id, fresh=True)
    try:
        rows = _fetch_chunk_rows(client, workspace_id, "id, metadata")
        ids = [row["id"] for row in rows if document_key(row.get("metadata")) == name]
        for offset in range(0, len(ids), _DELETE_BATCH):
            batch = ids[offset : offset + _DELETE_BATCH]
            client.table("document_chunks").delete().eq(
                "workspace_id", str(workspace_id)
            ).in_("id", batch).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Knowledge delete failed: {exc}") from exc
    if not ids:
        raise HTTPException(status_code=404, detail="Document not found")
    invalidate_analytics_cache(workspace_id)
    return KnowledgeDeleteResult(name=name, deleted_chunks=len(ids))


def split_prompt_sections(prompt: str) -> PromptSections:
    """Split an elite prompt into its 5 marker sections."""
    positions = [(marker, prompt.find(marker)) for marker in ELITE_PROMPT_MARKERS]
    bodies: list[str] = []
    for index, (marker, start) in enumerate(positions):
        if start < 0:
            bodies.append("")
            continue
        body_start = start + len(marker)
        following = [pos for _, pos in positions[index + 1 :] if pos > start]
        end = min(following) if following else len(prompt)
        bodies.append(prompt[body_start:end].strip())
    return PromptSections(
        role=bodies[0],
        context=bodies[1],
        objective=bodies[2],
        constraints=bodies[3],
        output_format=bodies[4],
    )


@router.get(
    "/workspaces/{workspace_id}/phases/{phase}/prompt-preview",
    response_model=PhasePromptPreview,
)
async def phase_prompt_preview(
    workspace_id: UUID,
    phase: int,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    use_project_context: bool = True,
    prefer_project_files: bool = True,
) -> PhasePromptPreview:
    """Exact system prompt the chat endpoint would use for this phase + workspace."""
    entry = get_phase(phase)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown SDLC phase")
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    stack = workspace.get("tech_stack")
    if not isinstance(stack, list):
        stack = None
    instructions = workspace.get("custom_instructions") if use_project_context else None
    prompt = build_elite_system_prompt(
        phase,
        project_name=workspace.get("name"),
        stack=stack,
        project_instructions=instructions,
        prefer_project_files=prefer_project_files,
    )
    deliverables = list(entry.expected_deliverables)
    suggested = (
        f"Génère les livrables de la Phase {entry.id:02d} — {entry.name} pour ce projet : "
        + ", ".join(deliverables)
        + "."
    )
    return PhasePromptPreview(
        phase=entry.id,
        phase_name=entry.name,
        role=entry.default_role,
        objective=entry.objective,
        deliverables=deliverables,
        system_prompt=prompt,
        sections=split_prompt_sections(prompt),
        suggested_user_prompt=suggested,
    )
