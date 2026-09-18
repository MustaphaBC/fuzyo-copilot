"""SDLC phase → local path placement for chat artifacts."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import UUID

from backend.app.services import workspace_fs

_PHASE_DIR_MAP: dict[int, str] = {
    1: "docs/phase_1_expression_du_besoin",
    2: "docs/phase_2_analyse_fonctionnelle",
    3: "docs/phase_3_architecture",
    4: "docs/phase_4_gestion_de_projet",
    5: "src",
    6: "tests",
    7: "docs/phase_7_recette",
    8: "docs/phase_8_devops",
    9: "docs/phase_9_mise_en_production",
}

_UNSAFE_NAME = re.compile(r"[^\w.\- ]+", re.UNICODE)


def phase_dir(phase: int) -> str:
    try:
        key = int(phase)
    except (TypeError, ValueError):
        key = 1
    return _PHASE_DIR_MAP.get(key, _PHASE_DIR_MAP[1])


def sanitize_basename(file_name: str, *, default: str = "artifact.md") -> str:
    raw = (file_name or "").replace("\\", "/").split("/")[-1].strip()
    cleaned = _UNSAFE_NAME.sub("_", raw).strip(" ._")
    if not cleaned or cleaned in {".", ".."}:
        return default
    if len(cleaned) > 120:
        stem = Path(cleaned).stem[:100]
        suffix = Path(cleaned).suffix[:20]
        cleaned = f"{stem}{suffix}" if suffix else stem
    return cleaned


def suggest_filename(
    file_name: str | None,
    *,
    phase: int,
    language: str | None = None,
) -> str:
    if file_name and str(file_name).strip():
        return sanitize_basename(str(file_name))
    lang = (language or "").lower().strip()
    ext_map = {
        "python": ".py",
        "py": ".py",
        "javascript": ".js",
        "js": ".js",
        "typescript": ".ts",
        "ts": ".ts",
        "tsx": ".tsx",
        "jsx": ".jsx",
        "json": ".json",
        "yaml": ".yml",
        "yml": ".yml",
        "sql": ".sql",
        "markdown": ".md",
        "md": ".md",
        "mermaid": ".mermaid",
        "go": ".go",
        "toml": ".toml",
        "txt": ".txt",
        "text": ".txt",
    }
    ext = ext_map.get(lang, ".md")
    if int(phase) == 5:
        return f"assistant_module{ext}"
    if int(phase) == 6:
        return f"test_assistant{ext}"
    if lang == "mermaid":
        return "architecture_diagram.mermaid"
    return f"notes{ext}"


def place_artifact(
    workspace_id: UUID | str,
    *,
    phase: int,
    file_name: str,
    content: str,
    workspace_name: str | None = None,
) -> dict[str, Any]:
    """Write artifact into phase folder; provision root if missing."""
    root = workspace_fs.resolve_workspace_root(workspace_id)
    if root is None:
        root = workspace_fs.provision_workspace(
            workspace_name or "workspace",
            workspace_id,
        )
    basename = sanitize_basename(file_name)
    relative = f"{phase_dir(phase).rstrip('/')}/{basename}"
    absolute = workspace_fs.write_file(root, relative, content or "")
    return {
        "relative_path": relative.replace("\\", "/"),
        "absolute_path": str(absolute),
        "workspace_root": str(root),
    }
