"""Workspace CRUD and analytics endpoints backed by Supabase."""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.schemas.workspace import WorkspaceCreate, WorkspaceOut, WorkspaceUpdate
from backend.app.services.analytics_engine import (
    build_workspace_analytics,
    invalidate_analytics_cache,
    is_supabase_unreachable,
)
from backend.app.services.artifact_router import phase_dir, place_artifact, sanitize_basename
from backend.app.services.project_analyzer import analyze_project
from backend.app.services.rag_service import ingest_file
from backend.app.services import workspace_fs

router = APIRouter(tags=["workspaces"])

_ALLOWED_UPLOAD_SUFFIXES = frozenset(
    {
        ".md",
        ".markdown",
        ".pdf",
        ".docx",
        ".xlsx",
        ".csv",
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".go",
        ".json",
        ".yml",
        ".yaml",
        ".toml",
        ".sql",
        ".txt",
    }
)

_IGNORE_DIR_NAMES = frozenset(
    {"node_modules", ".git", ".venv", "dist", "__pycache__", ".tox", ".mypy_cache"}
)


class WorkspaceAnalytics(BaseModel):
    workspace_id: UUID
    name: str
    chunk_count: int = 0
    document_count: int = 0
    sdlc_phase_completion: dict[str, bool] = Field(default_factory=dict)
    sdlc_completion_pct: float = 0.0
    tech_stack: list[str] = Field(default_factory=list)
    documentation_coverage_pct: float = 0.0
    testability_score: float = 0.0
    sdlc_audit_report: dict[str, Any] | None = None
    prompt_count: int = 0
    thread_count: int = 0
    active_sdlc_phase: int | None = None


class DeleteResult(BaseModel):
    status: str
    id: UUID
    purged_chunks: int = 0


class DocumentUploadResult(BaseModel):
    filename: str
    chunks_inserted: int = 0


class CreateAndIngestResult(BaseModel):
    workspace: WorkspaceOut
    files_ingested: int = 0
    chunks_inserted: int = 0
    skipped_ignored: int = 0
    sdlc_audit_report: dict[str, Any] | None = None


class SaveArtifactRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=200)
    content: str = ""
    phase: int = Field(default=1, ge=1, le=9)


class SaveArtifactResult(BaseModel):
    relative_path: str
    workspace_root: str
    sdlc_audit_report: dict[str, Any] | None = None


class ApplyChangeFile(BaseModel):
    relative_path: str = Field(min_length=1, max_length=500)
    content: str = ""


class ApplyChangesRequest(BaseModel):
    files: list[ApplyChangeFile] = Field(min_length=1)
    phase: int | None = Field(default=None, ge=1, le=9)


class ApplyChangesResult(BaseModel):
    written: list[str] = Field(default_factory=list)
    workspace_root: str
    sdlc_audit_report: dict[str, Any] | None = None
    ingested: int = 0


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


def _row_to_workspace(row: dict[str, Any]) -> WorkspaceOut:
    tech = row.get("tech_stack") or []
    if not isinstance(tech, list):
        tech = []
    owner_raw = row.get("owner_id")
    return WorkspaceOut(
        id=row["id"],
        name=row["name"],
        description=row.get("description"),
        tech_stack=[str(item) for item in tech],
        custom_instructions=row.get("custom_instructions"),
        owner_id=owner_raw,
        created_at=row["created_at"],
    )


def _should_ignore_path(relative: str) -> bool:
    normalized = relative.replace("\\", "/").lstrip("./")
    if not normalized:
        return True
    parts = [p for p in normalized.split("/") if p and p != "."]
    if any(part in _IGNORE_DIR_NAMES for part in parts):
        return True
    base = parts[-1].lower() if parts else ""
    if base == ".env" or base.startswith(".env."):
        return True
    return False


def _parse_tech_stack(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    text = str(raw).strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except json.JSONDecodeError:
        pass
    return [part.strip() for part in text.split(",") if part.strip()]


async def _persist_audit_report(
    client: Any,
    workspace_id: UUID,
    owner_id: UUID,
    report: dict[str, Any],
) -> None:
    try:
        client.table("workspaces").update({"sdlc_audit_report": report}).eq(
            "id", str(workspace_id)
        ).eq("owner_id", str(owner_id)).execute()
    except Exception:  # noqa: BLE001
        # Column may be missing until migration 06 is applied
        pass


@router.post("/workspaces", response_model=WorkspaceOut)
async def create_workspace(
    payload: WorkspaceCreate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkspaceOut:
    client = _supabase()
    row = {
        "name": payload.name,
        "description": payload.description,
        "tech_stack": payload.tech_stack,
        "custom_instructions": payload.custom_instructions,
        "owner_id": str(user.id),
    }
    try:
        result = client.table("workspaces").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Supabase insert failed: {exc}") from exc
    data = result.data or []
    if not data:
        raise HTTPException(status_code=502, detail="Supabase insert returned no row")
    row_out = data[0]
    try:
        workspace_fs.provision_workspace(
            row_out["name"],
            row_out["id"],
            host_base=payload.custom_host_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError:
        # Local FS is best-effort; cloud workspace still succeeds.
        pass
    return _row_to_workspace(row_out)


@router.post("/workspaces/create-and-ingest", response_model=CreateAndIngestResult)
async def create_and_ingest(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    name: str = Form(...),
    description: str | None = Form(None),
    custom_instructions: str | None = Form(None),
    tech_stack: str | None = Form(None),
    mode: str = Form("docs"),
    sdlc_phase: int = Form(1),
    custom_host_path: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    zip_file: UploadFile | None = File(None),
) -> CreateAndIngestResult:
    """Create a workspace and ingest docs or a filtered codebase archive."""
    trimmed = (name or "").strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="name is required")
    mode_norm = (mode or "docs").strip().lower()
    if mode_norm not in {"docs", "codebase"}:
        raise HTTPException(status_code=400, detail="mode must be docs or codebase")

    client = _supabase()
    stack = _parse_tech_stack(tech_stack)
    row = {
        "name": trimmed,
        "description": (description or "").strip() or None,
        "tech_stack": stack,
        "custom_instructions": (custom_instructions or "").strip() or None,
        "owner_id": str(user.id),
    }
    try:
        result = client.table("workspaces").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Supabase insert failed: {exc}") from exc
    data = result.data or []
    if not data:
        raise HTTPException(status_code=502, detail="Supabase insert returned no row")
    workspace_row = data[0]
    workspace_id = UUID(str(workspace_row["id"]))
    phase = sdlc_phase if 1 <= sdlc_phase <= 9 else 1

    try:
        local_root = workspace_fs.provision_workspace(
            trimmed,
            workspace_id,
            host_base=custom_host_path,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError:
        local_root = None

    tmp_root = Path(tempfile.mkdtemp(prefix="fuzyo-ingest-"))
    skipped = 0
    files_ingested = 0
    chunks_inserted = 0
    source_names: list[str] = []

    try:
        upload_list = list(files or [])
        if zip_file is not None and (zip_file.filename or "").strip():
            zip_path = tmp_root / "upload.zip"
            with zip_path.open("wb") as handle:
                while True:
                    chunk = await zip_file.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
            extract_dir = tmp_root / "extracted"
            extract_dir.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(zip_path, "r") as archive:
                    for info in archive.infolist():
                        if info.is_dir():
                            continue
                        rel = info.filename.replace("\\", "/")
                        if _should_ignore_path(rel):
                            skipped += 1
                            continue
                        suffix = Path(rel).suffix.lower()
                        if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
                            skipped += 1
                            continue
                        target = extract_dir / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(info) as src, target.open("wb") as dst:
                            shutil.copyfileobj(src, dst)
                        inserted = await ingest_file(workspace_id, target, sdlc_phase=phase)
                        if inserted:
                            files_ingested += 1
                            chunks_inserted += inserted
                            source_names.append(rel)
            except zipfile.BadZipFile as exc:
                raise HTTPException(status_code=400, detail="Invalid zip archive") from exc
            finally:
                await zip_file.close()

        for upload in upload_list:
            original = Path(upload.filename or "upload.bin").name
            rel = (upload.filename or original).replace("\\", "/")
            if _should_ignore_path(rel):
                skipped += 1
                await upload.close()
                continue
            suffix = Path(rel).suffix.lower()
            if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
                skipped += 1
                await upload.close()
                continue
            dest = tmp_root / "files" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
            await upload.close()
            inserted = await ingest_file(workspace_id, dest, sdlc_phase=phase)
            if inserted:
                files_ingested += 1
                chunks_inserted += inserted
                source_names.append(rel)

        tree_root = None
        extracted = tmp_root / "extracted"
        files_dir = tmp_root / "files"
        if extracted.exists():
            tree_root = extracted
        elif files_dir.exists():
            tree_root = files_dir

        if local_root is not None and tree_root is not None:
            under = "src" if mode_norm == "codebase" else phase_dir(phase)
            try:
                workspace_fs.materialize_upload_tree(
                    local_root, tree_root, under=under
                )
            except OSError:
                pass
            report = analyze_project(source_names=source_names, root=local_root)
        else:
            report = analyze_project(source_names=source_names, root=tree_root)

        await _persist_audit_report(client, workspace_id, user.id, report)
        invalidate_analytics_cache(workspace_id)
        workspace_row["sdlc_audit_report"] = report

        return CreateAndIngestResult(
            workspace=_row_to_workspace(workspace_row),
            files_ingested=files_ingested,
            chunks_inserted=chunks_inserted,
            skipped_ignored=skipped,
            sdlc_audit_report=report,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Create-and-ingest failed: {exc}") from exc
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


@router.get("/workspaces", response_model=list[WorkspaceOut])
async def list_workspaces(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> list[WorkspaceOut]:
    client = _supabase()
    try:
        result = (
            client.table("workspaces")
            .select("*")
            .eq("owner_id", str(user.id))
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Supabase list failed: {exc}") from exc
    return [_row_to_workspace(row) for row in (result.data or [])]


@router.put("/workspaces/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    workspace_id: UUID,
    payload: WorkspaceUpdate,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkspaceOut:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return _row_to_workspace(ensure_owned_workspace(client, workspace_id, user.id))
    try:
        result = (
            client.table("workspaces")
            .update(updates)
            .eq("id", str(workspace_id))
            .eq("owner_id", str(user.id))
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Supabase update failed: {exc}") from exc
    data = result.data or []
    if not data:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return _row_to_workspace(data[0])


@router.delete("/workspaces/{workspace_id}", response_model=DeleteResult)
async def delete_workspace(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> DeleteResult:
    """Delete workspace; document_chunks are purged via ON DELETE CASCADE."""
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)

    purged = 0
    try:
        chunks = (
            client.table("document_chunks")
            .select("id")
            .eq("workspace_id", str(workspace_id))
            .execute()
        )
        purged = len(chunks.data or [])
        if purged:
            client.table("document_chunks").delete().eq(
                "workspace_id", str(workspace_id)
            ).execute()
        client.table("workspaces").delete().eq("id", str(workspace_id)).eq(
            "owner_id", str(user.id)
        ).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Supabase delete failed: {exc}") from exc

    invalidate_analytics_cache(workspace_id)
    return DeleteResult(status="deleted", id=workspace_id, purged_chunks=purged)


@router.post(
    "/workspaces/{workspace_id}/documents",
    response_model=DocumentUploadResult,
)
async def upload_workspace_document(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    file: UploadFile = File(...),
    sdlc_phase: int = Form(1),
) -> DocumentUploadResult:
    client = _supabase()
    ensure_owned_workspace(client, workspace_id, user.id)

    original_name = Path(file.filename or "upload.bin").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported document type: {suffix or '(none)'}. "
            f"Allowed: {', '.join(sorted(_ALLOWED_UPLOAD_SUFFIXES))}",
        )

    phase = sdlc_phase if 1 <= sdlc_phase <= 9 else 1
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)

        inserted = await ingest_file(workspace_id, tmp_path, sdlc_phase=phase)
        invalidate_analytics_cache(workspace_id)
        # Best-effort local mirror into phase folder.
        try:
            workspace = ensure_owned_workspace(client, workspace_id, user.id)
            root = workspace_fs.ensure_workspace_root(
                workspace.get("name") or "workspace",
                workspace_id,
            )
            rel = f"{phase_dir(phase).rstrip('/')}/{sanitize_basename(original_name)}"
            data_bytes = tmp_path.read_bytes() if tmp_path else b""
            workspace_fs.materialize_single_file(root, rel, data_bytes)
        except Exception:  # noqa: BLE001
            pass
        return DocumentUploadResult(filename=original_name, chunks_inserted=inserted)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Document ingest failed: {exc}") from exc
    finally:
        await file.close()
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


@router.post(
    "/workspaces/{workspace_id}/save-artifact",
    response_model=SaveArtifactResult,
)
async def save_workspace_artifact(
    workspace_id: UUID,
    payload: SaveArtifactRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> SaveArtifactResult:
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    try:
        placed = place_artifact(
            workspace_id,
            phase=payload.phase,
            file_name=payload.file_name,
            content=payload.content,
            workspace_name=workspace.get("name") or "workspace",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Local write failed: {exc}") from exc

    root = Path(placed["workspace_root"])
    report = analyze_project(root=root)
    await _persist_audit_report(client, workspace_id, user.id, report)
    invalidate_analytics_cache(workspace_id)

    return SaveArtifactResult(
        relative_path=placed["relative_path"],
        workspace_root=placed["workspace_root"],
        sdlc_audit_report=report,
    )


def _sanitize_apply_relative(path: str, phase: int | None) -> str:
    cleaned = (path or "").replace("\\", "/").lstrip("/")
    if not cleaned or ".." in cleaned.split("/"):
        raise ValueError("Invalid relative path")
    phase_key = int(phase) if phase is not None else 5
    allowed_prefix = phase_dir(phase_key).rstrip("/") + "/"
    # Also allow bare filenames → place under phase dir
    if "/" not in cleaned:
        return f"{allowed_prefix.rstrip('/')}/{sanitize_basename(cleaned)}"
    if cleaned.startswith(allowed_prefix) or cleaned == allowed_prefix.rstrip("/"):
        return cleaned
    # Dev/code sync defaults to src/
    if phase_key == 5 and not cleaned.startswith("src/"):
        return f"src/{cleaned.lstrip('/')}"
    if phase_key == 6 and not cleaned.startswith("tests/"):
        return f"tests/{cleaned.lstrip('/')}"
    if not cleaned.startswith(allowed_prefix):
        raise ValueError(
            f"relative_path must be under {allowed_prefix.rstrip('/')} for this phase"
        )
    return cleaned


@router.post(
    "/workspaces/{workspace_id}/apply-changes",
    response_model=ApplyChangesResult,
)
async def apply_workspace_changes(
    workspace_id: UUID,
    payload: ApplyChangesRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> ApplyChangesResult:
    client = _supabase()
    workspace = ensure_owned_workspace(client, workspace_id, user.id)
    name = workspace.get("name") or "workspace"
    root = workspace_fs.ensure_workspace_root(name, workspace_id)
    phase = payload.phase if payload.phase is not None else 5

    written: list[str] = []
    ingested = 0
    for item in payload.files:
        try:
            relative = _sanitize_apply_relative(item.relative_path, phase)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            target = workspace_fs.write_file(root, relative, item.content or "")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Write failed: {exc}") from exc
        written.append(relative)
        # Best-effort RAG re-index for text-like files
        try:
            inserted = await ingest_file(workspace_id, target, sdlc_phase=phase)
            if inserted:
                ingested += 1
        except Exception:  # noqa: BLE001
            pass

    report = analyze_project(root=root)
    await _persist_audit_report(client, workspace_id, user.id, report)
    invalidate_analytics_cache(workspace_id)

    return ApplyChangesResult(
        written=written,
        workspace_root=str(root.resolve()),
        sdlc_audit_report=report,
        ingested=ingested,
    )


@router.get("/workspaces/{workspace_id}/analytics", response_model=WorkspaceAnalytics)
async def workspace_analytics(
    workspace_id: UUID,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> WorkspaceAnalytics:
    client = _supabase()
    try:
        workspace = ensure_owned_workspace(client, workspace_id, user.id)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if is_supabase_unreachable(exc):
            raise HTTPException(status_code=503, detail="Supabase unreachable") from exc
        raise

    payload = await build_workspace_analytics(client, workspace, user.id)
    return WorkspaceAnalytics(**payload)
