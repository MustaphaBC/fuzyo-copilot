"""Deterministic project analyzer for SDLC audit reports."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from backend.app.prompts.sdlc_catalog import SDLC_CATALOG

_LANG_COLORS: dict[str, str] = {
    "JavaScript": "#f1e05a",
    "TypeScript": "#3178c6",
    "Python": "#3572A5",
    "Go": "#00ADD8",
    "SQL": "#e38c00",
    "YAML": "#cb171e",
    "JSON": "#292929",
    "Markdown": "#083fa1",
    "HTML": "#e34c26",
    "CSS": "#563d7c",
    "Shell": "#89e051",
    "Other": "#6e7681",
}

_EXT_LANG: dict[str, str] = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".go": "Go",
    ".sql": "SQL",
    ".yml": "YAML",
    ".yaml": "YAML",
    ".json": "JSON",
    ".md": "Markdown",
    ".markdown": "Markdown",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "CSS",
    ".sh": "Shell",
    ".toml": "Other",
    ".txt": "Other",
    ".csv": "Other",
}

_PHASE_DEFS: list[dict[str, Any]] = [
    {
        "id": 1,
        "name": SDLC_CATALOG[1].name,
        "keys": ("readme", "spec", "besoin", "prd", "brief", "cdc"),
    },
    {
        "id": 2,
        "name": SDLC_CATALOG[2].name,
        "keys": ("analyse", "functional", "requirements", "specs", "sfd"),
    },
    {
        "id": 3,
        "name": SDLC_CATALOG[3].name,
        "keys": ("architecture", "adr", "design", "diagram", "openapi"),
    },
    {
        "id": 4,
        "name": SDLC_CATALOG[4].name,
        "keys": ("roadmap", "backlog", "jira", "product", "sprint"),
    },
    {
        "id": 5,
        "name": SDLC_CATALOG[5].name,
        "keys": ("src/", "app/", "lib/", "components/", "services/"),
    },
    {
        "id": 6,
        "name": SDLC_CATALOG[6].name,
        "keys": ("test", "spec.", "__tests__", "e2e", "pytest", "qa"),
    },
    {
        "id": 7,
        "name": SDLC_CATALOG[7].name,
        "keys": ("recette", "uat", "acceptance", "staging", "pvr"),
    },
    {
        "id": 8,
        "name": SDLC_CATALOG[8].name,
        "keys": ("dockerfile", "docker-compose", ".github/", "ci", "deploy", "k8s"),
    },
    {
        "id": 9,
        "name": SDLC_CATALOG[9].name,
        "keys": ("production", "release", "prod", "helm", "terraform"),
    },
]


def _norm(path: str) -> str:
    return str(path or "").replace("\\", "/").lower()


def _collect_paths(
    *,
    source_names: list[str] | None = None,
    root: Path | None = None,
) -> list[str]:
    paths: list[str] = []
    for name in source_names or []:
        if name:
            paths.append(str(name))
    if root is not None and root.exists():
        for file_path in root.rglob("*"):
            if file_path.is_file():
                try:
                    rel = file_path.relative_to(root)
                except ValueError:
                    rel = file_path
                paths.append(str(rel).replace("\\", "/"))
    # de-dupe preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for path in paths:
        key = _norm(path)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(path.replace("\\", "/"))
    return ordered


def _language_breakdown(paths: list[str]) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for path in paths:
        ext = Path(path).suffix.lower()
        lang = _EXT_LANG.get(ext)
        if lang:
            counts[lang] += 1
    total = sum(counts.values()) or 1
    items = [
        {
            "name": name,
            "pct": round((count / total) * 100.0, 1),
            "color": _LANG_COLORS.get(name, _LANG_COLORS["Other"]),
        }
        for name, count in counts.most_common()
    ]
    return items


def _parse_frameworks(root: Path | None, paths: list[str]) -> list[str]:
    found: set[str] = set()
    path_set = {_norm(p) for p in paths}

    def read_text(name: str) -> str:
        if root is None:
            return ""
        candidate = root / name
        if candidate.is_file():
            try:
                return candidate.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                return ""
        return ""

    pkg = read_text("package.json")
    if pkg:
        try:
            data = json.loads(pkg)
            deps = {
                **(data.get("dependencies") or {}),
                **(data.get("devDependencies") or {}),
            }
            mapping = {
                "react": "React",
                "vite": "Vite",
                "next": "Next.js",
                "express": "Express",
                "tailwindcss": "Tailwind",
                "@supabase/supabase-js": "Supabase",
                "typescript": "TypeScript",
            }
            for key, label in mapping.items():
                if key in deps:
                    found.add(label)
        except json.JSONDecodeError:
            pass

    req = read_text("requirements.txt")
    if req:
        lower = req.lower()
        for key, label in (
            ("fastapi", "FastAPI"),
            ("django", "Django"),
            ("flask", "Flask"),
            ("pytest", "Pytest"),
            ("sqlalchemy", "SQLAlchemy"),
        ):
            if key in lower:
                found.add(label)

    if any("dockerfile" in _norm(p) for p in paths) or (root and (root / "Dockerfile").is_file()):
        found.add("Docker")
    if any(p.endswith("go.mod") or p.endswith("/go.mod") for p in path_set):
        found.add("Go modules")
        gom = read_text("go.mod")
        if "gin-gonic" in gom:
            found.add("Gin")

    return sorted(found)


def _phase_status(hits: int, strong: bool) -> tuple[str, float]:
    if hits >= 3 or strong:
        return "completed", min(100.0, 55.0 + hits * 8.0)
    if hits >= 1:
        return "in_progress", min(70.0, 25.0 + hits * 15.0)
    return "pending", 0.0


def _analyze_phases(paths: list[str]) -> list[dict[str, Any]]:
    lowered = [_norm(p) for p in paths]
    phases: list[dict[str, Any]] = []
    for definition in _PHASE_DEFS:
        keys = definition["keys"]
        hits = 0
        deliverables: list[str] = []
        for path, raw in zip(lowered, paths, strict=True):
            if any(key in path for key in keys):
                hits += 1
                if len(deliverables) < 8:
                    deliverables.append(raw)
        strong = hits >= 5
        status, pct = _phase_status(hits, strong)
        phases.append(
            {
                "id": definition["id"],
                "name": definition["name"],
                "status": status,
                "pct": round(pct, 1),
                "deliverables": deliverables,
                "expected_deliverables": list(
                    SDLC_CATALOG[definition["id"]].expected_deliverables
                ),
                "key_question": SDLC_CATALOG[definition["id"]].key_question,
            }
        )
    return phases


def _scores(paths: list[str], phases: list[dict[str, Any]], frameworks: list[str]) -> dict[str, float]:
    lowered = [_norm(p) for p in paths]
    has_tests = any("test" in p or "e2e" in p or "pytest" in p for p in lowered)
    has_ci = any(
        "dockerfile" in p or ".github/" in p or "ci" in p or "compose" in p for p in lowered
    )
    has_docs = any(p.endswith(".md") or "readme" in p or "spec" in p for p in lowered)
    code_files = sum(1 for p in lowered if Path(p).suffix.lower() in _EXT_LANG)
    rag_ready = min(100.0, code_files * 2.5 + (20.0 if has_docs else 0.0))
    completed = sum(1 for phase in phases if phase["status"] == "completed")
    quality = min(100.0, completed * 10.0 + len(frameworks) * 4.0 + (15.0 if has_tests else 0.0))
    security = 40.0 + (20.0 if has_ci else 0.0) + (10.0 if any(".env" not in p for p in lowered[:1]) else 0.0)
    # Prefer presence of lockfiles / docker as weak security signals
    if any("package-lock" in p or "poetry.lock" in p or "go.sum" in p for p in lowered):
        security += 15.0
    security = min(100.0, security)
    test_score = 75.0 if has_tests else (25.0 if any("assert" in p for p in lowered) else 10.0)
    return {
        "code_quality": round(quality, 1),
        "rag_readiness": round(rag_ready, 1),
        "security": round(security, 1),
        "test_completeness": round(test_score, 1),
    }


def _estimate_size(root: Path | None, paths: list[str]) -> int:
    if root is None or not root.exists():
        return len(paths) * 2048
    total = 0
    for path in paths:
        candidate = root / path
        if candidate.is_file():
            try:
                total += candidate.stat().st_size
            except OSError:
                total += 1024
        else:
            total += 1024
    return total


def analyze_project(
    *,
    source_names: list[str] | None = None,
    root: Path | None = None,
) -> dict[str, Any]:
    """Build sdlc_audit_report JSON from paths and optional unpacked tree."""
    paths = _collect_paths(source_names=source_names, root=root)
    languages = _language_breakdown(paths)
    frameworks = _parse_frameworks(root, paths)
    phases = _analyze_phases(paths)
    scores = _scores(paths, phases, frameworks)
    return {
        "languages": languages,
        "frameworks": frameworks,
        "file_count": len(paths),
        "size_bytes": _estimate_size(root, paths),
        "phases": phases,
        "scores": scores,
    }


def analyze_from_chunk_metadata(chunks: list[dict[str, Any]]) -> dict[str, Any]:
    sources: list[str] = []
    for chunk in chunks:
        metadata = chunk.get("metadata") or {}
        if not isinstance(metadata, dict):
            continue
        source = metadata.get("source")
        if source:
            sources.append(str(source))
    return analyze_project(source_names=sources)
