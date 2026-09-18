"""UAT sign-off: record phase acceptance and emit official PVR PDF."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from supabase import create_client

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.core.logging_config import get_logger
from backend.app.prompts.sdlc_catalog import (
    get_phase,
    phase_expected_deliverables,
    phase_export_title,
)
from backend.app.schemas.uat import UatSignOffRequest, UatSignOffResult
from backend.app.services import workspace_fs
from backend.app.services.artifact_router import phase_dir
from backend.app.services.deliverable_exporter import (
    build_pvr_pdf,
    build_uat_sheet_markdown,
)

router = APIRouter(tags=["uat"])
_log = get_logger("fuzyo.uat")


def _supabase() -> Any:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    try:
        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=503, detail=f"Supabase client error: {exc}"
        ) from exc


def _canonical_payload(
    *,
    project_name: str,
    phase: int,
    phase_title: str,
    deliverables: list[str],
    validator_name: str,
    signed_at_utc: str,
    notes: str,
    accepted: bool,
    workspace_id: str,
) -> dict[str, Any]:
    return {
        "accepted": accepted,
        "deliverables": list(deliverables),
        "notes": notes or "",
        "phase": int(phase),
        "phase_title": phase_title,
        "project_name": project_name,
        "signed_at_utc": signed_at_utc,
        "validator_name": validator_name,
        "workspace_id": workspace_id,
    }


def compute_content_sha256(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return sha256(raw.encode("utf-8")).hexdigest()


@router.post("/uat/sign-off")
async def uat_sign_off(
    body: UatSignOffRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> Response:
    """Record client UAT acceptance and return the official PVR PDF."""
    client = _supabase()
    workspace = ensure_owned_workspace(client, body.workspace_id, user.id)
    project_name = (body.project_name or workspace.get("name") or "workspace").strip()
    phase_title = phase_export_title(body.phase)
    catalog = get_phase(body.phase)
    deliverables = [d.strip() for d in body.deliverables if str(d).strip()]
    if not deliverables:
        deliverables = phase_expected_deliverables(body.phase)

    signed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    canonical = _canonical_payload(
        project_name=project_name,
        phase=body.phase,
        phase_title=phase_title,
        deliverables=deliverables,
        validator_name=body.validator_name.strip(),
        signed_at_utc=signed_at,
        notes=body.notes,
        accepted=body.accepted,
        workspace_id=str(body.workspace_id),
    )
    digest = compute_content_sha256(canonical)

    pdf_bytes = build_pvr_pdf(
        project_name=project_name,
        phase=body.phase,
        phase_title=phase_title,
        deliverables=deliverables,
        validator_name=body.validator_name.strip(),
        signed_at_utc=signed_at,
        content_sha256=digest,
        notes=body.notes,
        accepted=body.accepted,
    )
    sheet_md = build_uat_sheet_markdown(
        project_name=project_name,
        phase=body.phase,
        phase_title=phase_title,
        deliverables=deliverables,
        validator_name=body.validator_name.strip(),
        signed_at_utc=signed_at,
        content_sha256=digest,
        notes=body.notes,
    )

    name = workspace.get("name") or project_name
    root = workspace_fs.resolve_workspace_root(body.workspace_id)
    if root is None:
        root = workspace_fs.ensure_workspace_root(name, body.workspace_id)

    folder = phase_dir(7)
    stamp = signed_at.replace(":", "").replace("-", "")
    pvr_rel = f"{folder}/PVR_phase_{int(body.phase)}_{stamp}.pdf"
    sheet_rel = f"{folder}/UAT_sheet_phase_{int(body.phase)}_{stamp}.md"
    meta_rel = f"{folder}/PVR_phase_{int(body.phase)}_{stamp}.json"

    try:
        workspace_fs.write_file(root, pvr_rel, pdf_bytes)
        workspace_fs.write_file(root, sheet_rel, sheet_md)
        workspace_fs.write_file(
            root,
            meta_rel,
            json.dumps(
                {**canonical, "content_sha256": digest},
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to write UAT artifacts: {exc}"
        ) from exc

    _log.info(
        "uat_sign_off",
        workspace_id=str(body.workspace_id),
        phase=int(body.phase),
        accepted=body.accepted,
        content_sha256=digest,
        phase_name=catalog.name if catalog else phase_title,
    )

    result = UatSignOffResult(
        workspace_id=body.workspace_id,
        phase=body.phase,
        project_name=project_name,
        phase_title=phase_title,
        signed_at_utc=signed_at,
        content_sha256=digest,
        accepted=body.accepted,
        pvr_relative_path=pvr_rel.replace("\\", "/"),
        uat_sheet_relative_path=sheet_rel.replace("\\", "/"),
        deliverables=deliverables,
    )

    safe = "".join(
        c if c.isalnum() or c in "-_" else "_" for c in project_name
    ).strip("_") or "workspace"
    filename = f"PVR_{safe}_phase_{int(body.phase)}.pdf"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Fuzyo-PVR-SHA256": digest,
        "X-Fuzyo-PVR-Path": result.pvr_relative_path,
        "X-Fuzyo-UAT-Sheet-Path": result.uat_sheet_relative_path,
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
