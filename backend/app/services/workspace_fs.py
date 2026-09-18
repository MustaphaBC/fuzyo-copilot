"""Local host filesystem provisioning and safe writes for Fuzyo workspaces."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from backend.app.core.config import settings

_REPO_ROOT = Path(__file__).resolve().parents[3]

_PHASE_DIRS: tuple[str, ...] = (
    "docs/phase_1_expression_du_besoin",
    "docs/phase_2_analyse_fonctionnelle",
    "docs/phase_3_architecture",
    "docs/phase_4_gestion_de_projet",
    "docs/phase_7_recette",
    "docs/phase_8_devops",
    "docs/phase_9_mise_en_production",
    "src",
    "tests",
    ".fuzyo",
    ".fuzyo/backups",
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_IGNORE_DIR_NAMES = frozenset(
    {"node_modules", ".git", ".venv", "dist", "__pycache__", ".tox", ".mypy_cache"}
)

# Extra bases to scan when resolving (custom host paths from meta).
_known_bases: set[str] = set()
_INDEX_NAME = ".fuzyo_workspace_index.json"


def _index_path() -> Path:
    return storage_root() / _INDEX_NAME


def _load_path_index() -> dict[str, str]:
    path = _index_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _remember_workspace_root(workspace_id: UUID | str, root: Path) -> None:
    try:
        index = _load_path_index()
        index[str(workspace_id)] = str(root.resolve())
        parent = root.parent
        _known_bases.add(str(parent.resolve()))
        _index_path().write_text(json.dumps(index, indent=2), encoding="utf-8")
    except OSError:
        pass


def storage_root() -> Path:
    raw = (settings.local_workspace_storage_path or "").strip()
    if raw:
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = (_REPO_ROOT / path).resolve()
        else:
            path = path.resolve()
    else:
        path = (_REPO_ROOT / "workspace_projects").resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def slugify(name: str) -> str:
    text = (name or "").strip().lower()
    text = _SLUG_RE.sub("-", text).strip("-")
    return text or "workspace"


def resolve_host_base(host_base: str | None) -> Path:
    """Resolve user host base or default storage_root. Raises ValueError if unsafe."""
    raw = (host_base or "").strip()
    if not raw:
        return storage_root()

    path = Path(raw).expanduser()
    if ".." in path.parts:
        raise ValueError("Host path must not contain '..'")
    if not path.is_absolute():
        raise ValueError("Host path must be absolute (e.g. C:/Dev/Projects)")

    resolved = path.resolve()
    # Block writing into system-sensitive roots on Windows/Unix.
    forbidden_names = {n.lower() for n in ("windows", "system32", "etc", "proc", "sys")}
    if any(part.lower() in forbidden_names for part in resolved.parts):
        raise ValueError("Host path points to a restricted system location")

    try:
        resolved.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ValueError(f"Cannot create host path: {exc}") from exc

    _known_bases.add(str(resolved))
    return resolved


def _write_meta(
    root: Path,
    *,
    workspace_id: UUID | str,
    name: str,
    custom_host_path: str | None = None,
) -> None:
    meta_dir = root / ".fuzyo"
    meta_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": str(workspace_id),
        "name": name,
        "custom_host_path": custom_host_path,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (meta_dir / "workspace.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )


def provision_workspace(
    name: str,
    workspace_id: UUID | str,
    *,
    host_base: str | None = None,
) -> Path:
    """Create local project tree under host_base or default storage."""
    existing = resolve_workspace_root(workspace_id)
    if existing is not None:
        return existing

    base = resolve_host_base(host_base)
    slug = slugify(name)
    # Prefer human project folder name for FintechAPI → fintechapi; keep readable slug.
    # Acceptance uses FintechAPI under C:/Dev/Projects/FintechAPI — use original
    # sanitized folder preferring title-case-ish: slugify collapses case.
    # Plan says <base>/<project_name>/ — use slugify for safety; also try
    # a display folder from name with unsafe chars stripped.
    folder = _folder_name_from_project(name)
    candidate = base / folder
    if candidate.exists():
        candidate = base / f"{folder}__{str(workspace_id).replace('-', '')[:8]}"

    root = candidate
    root.mkdir(parents=True, exist_ok=False)
    for relative in _PHASE_DIRS:
        (root / relative).mkdir(parents=True, exist_ok=True)
    custom = str(base) if host_base else None
    _write_meta(
        root,
        workspace_id=workspace_id,
        name=name,
        custom_host_path=custom,
    )
    resolved = root.resolve()
    _remember_workspace_root(workspace_id, resolved)
    return resolved


def _folder_name_from_project(name: str) -> str:
    """Filesystem-safe project folder; keep alphanumerics and dashes."""
    cleaned = re.sub(r"[^\w\- ]+", "", (name or "").strip(), flags=re.UNICODE)
    cleaned = re.sub(r"\s+", "", cleaned)
    cleaned = cleaned.strip("._-") or slugify(name)
    return cleaned[:80]


def _iter_scan_bases() -> list[Path]:
    bases: list[Path] = [storage_root()]
    for raw in list(_known_bases):
        try:
            p = Path(raw)
            if p.is_dir():
                bases.append(p)
        except OSError:
            continue
    # Dedupe
    seen: set[str] = set()
    out: list[Path] = []
    for b in bases:
        key = str(b.resolve())
        if key in seen:
            continue
        seen.add(key)
        out.append(b)
    return out


def resolve_workspace_root(workspace_id: UUID | str) -> Path | None:
    """Find provisioned root by `.fuzyo/workspace.json` id match."""
    target = str(workspace_id)

    # Fast path: persisted index (covers custom host bases across restarts).
    indexed = _load_path_index().get(target)
    if indexed:
        candidate = Path(indexed)
        meta = candidate / ".fuzyo" / "workspace.json"
        if meta.is_file():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
                if str(data.get("id") or "") == target:
                    host = data.get("custom_host_path")
                    if host:
                        _known_bases.add(str(host))
                    return candidate.resolve()
            except (OSError, json.JSONDecodeError):
                pass

    for base in _iter_scan_bases():
        if not base.exists():
            continue
        try:
            children = list(base.iterdir())
        except OSError:
            continue
        for child in children:
            if not child.is_dir():
                continue
            meta = child / ".fuzyo" / "workspace.json"
            if not meta.is_file():
                continue
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if str(data.get("id") or "") == target:
                host = data.get("custom_host_path")
                if host:
                    _known_bases.add(str(host))
                resolved = child.resolve()
                _remember_workspace_root(workspace_id, resolved)
                return resolved
    return None


def ensure_workspace_root(
    name: str,
    workspace_id: UUID | str,
    *,
    host_base: str | None = None,
) -> Path:
    existing = resolve_workspace_root(workspace_id)
    if existing is not None:
        return existing
    return provision_workspace(name, workspace_id, host_base=host_base)


def safe_join(root: Path, relative: str) -> Path:
    """Join path under root; raise ValueError on traversal."""
    root_resolved = root.resolve()
    cleaned = (relative or "").replace("\\", "/").lstrip("/")
    if not cleaned or cleaned.startswith("..") or "/../" in f"/{cleaned}/":
        raise ValueError("Invalid relative path")
    parts = [p for p in cleaned.split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ValueError("Path traversal rejected")
    joined = root_resolved.joinpath(*parts).resolve()
    try:
        joined.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError("Path escapes workspace root") from exc
    return joined


def write_file(root: Path, relative: str, content: str | bytes) -> Path:
    """Write file under root; backup existing to `.fuzyo/backups/{iso}/…`."""
    target = safe_join(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.is_file():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_rel = f".fuzyo/backups/{stamp}/{relative.replace(chr(92), '/')}"
        backup_path = safe_join(root, backup_rel)
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup_path)
    if isinstance(content, bytes):
        target.write_bytes(content)
    else:
        target.write_text(content, encoding="utf-8", newline="\n")
    return target


def _resolve_under_root(root: Path, relative: str | None) -> Path:
    """Resolve relative path under root; empty → root itself."""
    cleaned = (relative or "").replace("\\", "/").strip().lstrip("/")
    if not cleaned or cleaned in {".", "./"}:
        return root.resolve()
    return safe_join(root, cleaned)


def list_dir(
    root: Path,
    relative: str = "",
    *,
    depth: int = 2,
) -> dict[str, Any]:
    """List directory entries under root/relative (capped depth, ignores)."""
    max_depth = max(0, min(int(depth), 6))
    base = _resolve_under_root(root, relative)
    if not base.exists():
        raise FileNotFoundError(f"Path not found: {relative or '/'}")
    if not base.is_dir():
        raise NotADirectoryError(f"Not a directory: {relative or '/'}")

    root_resolved = root.resolve()
    base_rel = ""
    try:
        if base != root_resolved:
            base_rel = base.relative_to(root_resolved).as_posix()
    except ValueError as exc:
        raise ValueError("Path escapes workspace root") from exc

    def build_entries(current: Path, current_rel: str, remaining: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        try:
            children = sorted(
                current.iterdir(),
                key=lambda p: (not p.is_dir(), p.name.lower()),
            )
        except OSError:
            return out
        for child in children:
            name = child.name
            child_rel = f"{current_rel}/{name}" if current_rel else name
            if name in _IGNORE_DIR_NAMES or _should_ignore_path(child_rel):
                continue
            if child_rel.startswith(".fuzyo/backups"):
                continue
            item: dict[str, Any] = {
                "name": name,
                "path": child_rel,
                "type": "dir" if child.is_dir() else "file",
            }
            try:
                st = child.stat()
                item["mtime"] = st.st_mtime
                if child.is_file():
                    item["size"] = st.st_size
            except OSError:
                pass
            if child.is_dir() and remaining > 0:
                item["children"] = build_entries(child, child_rel, remaining - 1)
            out.append(item)
        return out

    return {
        "path": base_rel,
        "entries": build_entries(base, base_rel, max_depth),
    }


def read_file(root: Path, relative: str) -> dict[str, Any]:
    """Read UTF-8 text file under root. Raises ValueError/FileNotFoundError/OSError."""
    cleaned = (relative or "").replace("\\", "/").lstrip("/")
    if not cleaned:
        raise ValueError("path is required")
    target = safe_join(root, cleaned)
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"File not found: {cleaned}")
    # Reject obvious binaries by null-byte sniff
    raw = target.read_bytes()
    if b"\x00" in raw[:8192]:
        raise ValueError("Binary files are not supported in the editor")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("File is not valid UTF-8 text") from exc
    return {
        "path": cleaned,
        "content": text,
        "encoding": "utf-8",
        "size": len(raw),
    }


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


def materialize_upload_tree(
    root: Path,
    source_dir: Path,
    *,
    under: str = "src",
) -> int:
    """Copy files from source_dir into root/under preserving relative paths."""
    if not source_dir.exists():
        return 0
    copied = 0
    source_resolved = source_dir.resolve()
    for file_path in source_resolved.rglob("*"):
        if not file_path.is_file():
            continue
        try:
            rel = file_path.relative_to(source_resolved).as_posix()
        except ValueError:
            continue
        if _should_ignore_path(rel):
            continue
        dest_rel = f"{under.rstrip('/')}/{rel}" if under else rel
        try:
            dest = safe_join(root, dest_rel)
        except ValueError:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file_path, dest)
        copied += 1
    return copied


def materialize_single_file(
    root: Path,
    relative: str,
    data: bytes,
) -> Path | None:
    try:
        return write_file(root, relative, data)
    except (OSError, ValueError):
        return None


def read_meta(root: Path) -> dict[str, Any]:
    meta = root / ".fuzyo" / "workspace.json"
    if not meta.is_file():
        return {}
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}
