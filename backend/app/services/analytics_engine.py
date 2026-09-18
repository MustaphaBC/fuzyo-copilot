"""Workspace analytics aggregation with short TTL cache."""

from __future__ import annotations

import re
import time
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException

from backend.app.services.project_analyzer import analyze_from_chunk_metadata

_CACHE_TTL_SECONDS = 300.0

_TECH_KEYWORDS = (
    "React",
    "FastAPI",
    "Python",
    "PostgreSQL",
    "TypeScript",
    "JavaScript",
    "Docker",
    "Supabase",
    "Vite",
    "Tailwind",
    "Node.js",
    "Django",
    "Flask",
)

_TESTABILITY_PATTERNS = (
    re.compile(r"\bpytest\b", re.I),
    re.compile(r"\bunittest\b", re.I),
    re.compile(r"\bassert\b", re.I),
    re.compile(r"\bcoverage\b", re.I),
    re.compile(r"\btest(?:s|ing|_case)?\b", re.I),
)

# workspace_id str -> (expires_at_monotonic, payload dict)
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def invalidate_analytics_cache(workspace_id: UUID | str) -> None:
    _cache.pop(str(workspace_id), None)


def is_supabase_unreachable(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.ConnectTimeout, httpx.ConnectError, httpx.ReadTimeout)):
        return True
    name = exc.__class__.__name__
    if name in {"ConnectTimeout", "ConnectError", "ReadTimeout", "TimeoutException"}:
        return True
    message = str(exc).lower()
    return "10060" in message or "timed out" in message or "connecttimeout" in message


def _safe_count(client: Any, table: str, filters: dict[str, str]) -> int:
    try:
        query = client.table(table).select("id", count="exact")
        for key, value in filters.items():
            query = query.eq(key, value)
        result = query.limit(1).execute()
        count = getattr(result, "count", None)
        if isinstance(count, int):
            return count
        data = result.data or []
        return len(data)
    except Exception:  # noqa: BLE001
        return 0


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
        pass


def _dominant_phase(phases_seen: set[int], phase_hits: dict[int, int]) -> int | None:
    if phase_hits:
        return max(phase_hits.items(), key=lambda item: item[1])[0]
    if phases_seen:
        return min(phases_seen)
    return None


async def build_workspace_analytics(
    client: Any,
    workspace: dict[str, Any],
    owner_id: UUID,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Aggregate RAG + SDLC metrics for a workspace. Cached 5 minutes."""
    workspace_id = workspace["id"]
    cache_key = str(workspace_id)
    now = time.monotonic()

    if not force_refresh:
        cached = _cache.get(cache_key)
        if cached and cached[0] > now:
            return dict(cached[1])

    try:
        chunks_result = (
            client.table("document_chunks")
            .select("id, content, metadata")
            .eq("workspace_id", cache_key)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        if is_supabase_unreachable(exc):
            raise HTTPException(status_code=503, detail="Supabase unreachable") from exc
        raise HTTPException(
            status_code=502, detail=f"Supabase chunks query failed: {exc}"
        ) from exc

    chunks = chunks_result.data or []
    chunk_count = len(chunks)

    sources: set[str] = set()
    phases_seen: set[int] = set()
    phase_hits: dict[int, int] = {}
    detected_stack: set[str] = set()
    test_hits = 0

    for item in workspace.get("tech_stack") or []:
        detected_stack.add(str(item))

    for chunk in chunks:
        metadata = chunk.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}
        source = metadata.get("source")
        if source:
            sources.add(str(source))
        phase = metadata.get("sdlc_phase")
        try:
            phase_int = int(phase)
            if 1 <= phase_int <= 9:
                phases_seen.add(phase_int)
                phase_hits[phase_int] = phase_hits.get(phase_int, 0) + 1
        except (TypeError, ValueError):
            pass

        content = chunk.get("content") or ""
        for keyword in _TECH_KEYWORDS:
            if re.search(rf"\b{re.escape(keyword)}\b", content, re.I):
                detected_stack.add(keyword)
        if any(pattern.search(content) for pattern in _TESTABILITY_PATTERNS):
            test_hits += 1

    phase_completion = {str(i): (i in phases_seen) for i in range(1, 10)}
    sdlc_pct = round((len(phases_seen) / 9.0) * 100.0, 2)
    doc_coverage = float(min(100, chunk_count * 10))
    testability = 0.0
    if chunk_count:
        testability = round(min(100.0, (test_hits / chunk_count) * 100.0), 2)

    report = workspace.get("sdlc_audit_report")
    if not isinstance(report, dict) or not report:
        report = analyze_from_chunk_metadata(chunks)
        await _persist_audit_report(client, workspace_id, owner_id, report)

    prompt_count = _safe_count(
        client,
        "chat_messages",
        {"workspace_id": cache_key, "role": "user"},
    )
    thread_count = _safe_count(client, "chat_threads", {"workspace_id": cache_key})

    payload: dict[str, Any] = {
        "workspace_id": workspace_id,
        "name": workspace["name"],
        "chunk_count": chunk_count,
        "document_count": len(sources),
        "sdlc_phase_completion": phase_completion,
        "sdlc_completion_pct": sdlc_pct,
        "tech_stack": sorted(detected_stack),
        "documentation_coverage_pct": doc_coverage,
        "testability_score": testability,
        "sdlc_audit_report": report,
        "prompt_count": prompt_count,
        "thread_count": thread_count,
        "active_sdlc_phase": _dominant_phase(phases_seen, phase_hits),
    }
    _cache[cache_key] = (now + _CACHE_TTL_SECONDS, dict(payload))
    return payload
