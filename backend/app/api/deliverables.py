"""Phase deliverable download endpoints."""

from __future__ import annotations

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.services import deliverable_exporter, workspace_fs

router = APIRouter(tags=["deliverables"])

_ALLOWED_FORMATS = frozenset({"docx", "zip", "raw", "md", "pdf"})


def _supabase() -> Any:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase client error: {exc}") from exc


@router.get("/workspaces/{workspace_id}/deliverables/{phase}/download")
async def download_phase_deliverable(
    workspace_id: UUID,
    phase: int,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    format: str = Query("docx", alias="format"),
) -> Response:
    if not (1 <= int(phase) <= 9):
        raise HTTPException(status_code=400, detail="phase must be 1–9")

    fmt = (format or "").strip().lower()
    if fmt not in _ALLOWED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail="format must be one of: docx, zip, raw, md, pdf",
        )

    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    name = workspace.get("name") or "workspace"
    audit = workspace.get("sdlc_audit_report")
    if not isinstance(audit, dict):
        audit = {}

    root = workspace_fs.resolve_workspace_root(workspace_id)
    if root is None:
        root = workspace_fs.ensure_workspace_root(name, workspace_id)

    media = "application/octet-stream"
    raw_name: str | None = None

    if fmt == "docx":
        payload = deliverable_exporter.build_phase_docx(
            name, phase, audit, root=root
        )
        media = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    elif fmt == "zip":
        payload = deliverable_exporter.build_phase_zip(root, phase)
        media = "application/zip"
    elif fmt == "md":
        payload = deliverable_exporter.build_phase_markdown(
            name, phase, audit, root=root
        )
        media = "text/markdown; charset=utf-8"
    elif fmt == "pdf":
        payload = deliverable_exporter.build_phase_pdf(
            name, phase, audit, root=root
        )
        media = "application/pdf"
    else:
        payload, raw_name = deliverable_exporter.build_phase_raw_file(root, phase)
        media = "application/octet-stream"

    filename = deliverable_exporter.download_filename(
        name, phase, fmt, raw_name=raw_name
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return Response(content=payload, media_type=media, headers=headers)
