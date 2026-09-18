"""Tests for BM25 RAG fallback when vector search fails."""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest

from backend.app.services import rag_bm25_fallback
from backend.app.services.rag_bm25_fallback import bm25_search, tokenize
from backend.app.services.rag_service import (
    SOURCE_BM25,
    SOURCE_HYBRID,
    search_workspace,
)


def test_tokenize_basic() -> None:
    assert tokenize("Hello RAG_42!") == ["hello", "rag_42"]


def test_bm25_search_ranks_relevant_doc(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = uuid4()
    root = tmp_path / "proj"
    root.mkdir()
    (root / "docs").mkdir()
    (root / "docs" / "architecture.md").write_text(
        "FastAPI SSE streaming uses Server-Sent Events for chat completions.",
        encoding="utf-8",
    )
    (root / "docs" / "other.md").write_text(
        "Unrelated gardening tips for tomatoes and soil.",
        encoding="utf-8",
    )

    monkeypatch.setattr(
        rag_bm25_fallback.workspace_fs,
        "resolve_workspace_root",
        lambda _wid: root,
    )

    hits = bm25_search(workspace_id, "FastAPI SSE streaming chat")
    assert hits
    assert "SSE" in (hits[0].get("content") or "")
    assert hits[0].get("bm25_score", 0) > 0


def test_search_workspace_falls_back_on_supabase_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = uuid4()
    root = tmp_path / "ws"
    root.mkdir()
    (root / "readme.md").write_text(
        "Confidential privacy router fail-closed routes to LOCAL_STUB.",
        encoding="utf-8",
    )

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("supabase down")

    monkeypatch.setattr(
        "backend.app.services.rag_service._vector_hybrid_search",
        _boom,
    )
    monkeypatch.setattr(
        rag_bm25_fallback.workspace_fs,
        "resolve_workspace_root",
        lambda _wid: root,
    )

    result = asyncio.run(search_workspace(workspace_id, "privacy router LOCAL_STUB"))
    assert result.source == SOURCE_BM25
    assert result.status == "degraded_bm25"
    assert result.hits
    assert "fail-closed" in (result.hits[0].get("content") or "")


def test_search_workspace_falls_back_on_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    workspace_id = uuid4()
    root = tmp_path / "ws2"
    root.mkdir()
    (root / "note.md").write_text(
        "BM25 fallback recovers when vector search times out.",
        encoding="utf-8",
    )

    async def _slow(*_args, **_kwargs):
        await asyncio.sleep(5)
        return [{"content": "should not appear"}]

    monkeypatch.setattr(
        "backend.app.services.rag_service._vector_hybrid_search",
        _slow,
    )
    monkeypatch.setattr(
        "backend.app.services.rag_service._VECTOR_SEARCH_TIMEOUT_S",
        0.05,
    )
    monkeypatch.setattr(
        rag_bm25_fallback.workspace_fs,
        "resolve_workspace_root",
        lambda _wid: root,
    )

    result = asyncio.run(search_workspace(workspace_id, "BM25 fallback times out"))
    assert result.source == SOURCE_BM25
    assert result.status == "degraded_bm25"
    assert any("BM25" in (hit.get("content") or "") for hit in result.hits)


def test_search_workspace_hybrid_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _ok(*_args, **_kwargs):
        return [{"content": "vector hit", "metadata": {}}]

    monkeypatch.setattr(
        "backend.app.services.rag_service._vector_hybrid_search",
        _ok,
    )
    result = asyncio.run(search_workspace(uuid4(), "anything"))
    assert result.source == SOURCE_HYBRID
    assert result.status == "ok"
    assert result.hits[0]["content"] == "vector hit"
