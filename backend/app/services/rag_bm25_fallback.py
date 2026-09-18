"""Local BM25 keyword search fallback when vector RAG is unavailable."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from uuid import UUID

from rank_bm25 import BM25Okapi

from backend.app.services import workspace_fs

_TOKEN_RE = re.compile(r"[a-z0-9_]+", re.IGNORECASE)
_TEXT_SUFFIXES = frozenset(
    {
        ".md",
        ".txt",
        ".py",
        ".js",
        ".jsx",
        ".ts",
        ".tsx",
        ".json",
        ".yml",
        ".yaml",
        ".toml",
        ".rst",
        ".java",
        ".go",
        ".rs",
        ".sql",
        ".css",
        ".html",
    }
)
_IGNORE_DIR_NAMES = frozenset(
    {
        "node_modules",
        ".git",
        ".venv",
        "venv",
        "dist",
        "build",
        "__pycache__",
        ".tox",
        ".mypy_cache",
        "test-results",
        "playwright-report",
    }
)
_MAX_FILE_CHARS = 12_000
_MAX_DOCS = 400
_CHUNK_SIZE = 2_000


def tokenize(text: str) -> list[str]:
    return [tok.lower() for tok in _TOKEN_RE.findall(text or "")]


def _should_skip_dir(name: str) -> bool:
    return name in _IGNORE_DIR_NAMES or name.startswith(".")


def _chunk_text(text: str, *, relative_path: str) -> list[dict[str, Any]]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    if len(cleaned) <= _CHUNK_SIZE:
        return [
            {
                "content": cleaned,
                "metadata": {"path": relative_path, "source": "bm25_local"},
            }
        ]
    chunks: list[dict[str, Any]] = []
    start = 0
    index = 0
    while start < len(cleaned) and len(chunks) < 40:
        end = min(len(cleaned), start + _CHUNK_SIZE)
        piece = cleaned[start:end].strip()
        if piece:
            chunks.append(
                {
                    "content": piece,
                    "metadata": {
                        "path": relative_path,
                        "chunk": index,
                        "source": "bm25_local",
                    },
                }
            )
            index += 1
        if end >= len(cleaned):
            break
        start = max(end - 200, start + 1)
    return chunks


def load_workspace_documents(workspace_id: str | UUID) -> list[dict[str, Any]]:
    """Load text-like files from the local workspace tree into memory."""
    root = workspace_fs.resolve_workspace_root(workspace_id)
    if root is None or not root.is_dir():
        return []

    documents: list[dict[str, Any]] = []
    try:
        for path in root.rglob("*"):
            if len(documents) >= _MAX_DOCS:
                break
            if not path.is_file():
                continue
            try:
                relative = path.relative_to(root)
            except ValueError:
                continue
            if any(_should_skip_dir(part) for part in relative.parts):
                continue
            if path.suffix.lower() not in _TEXT_SUFFIXES:
                continue
            try:
                rel_str = str(relative).replace("\\", "/")
                raw = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            documents.extend(
                _chunk_text(raw[:_MAX_FILE_CHARS], relative_path=rel_str)
            )
            if len(documents) >= _MAX_DOCS:
                documents = documents[:_MAX_DOCS]
                break
    except OSError:
        return documents
    return documents


def bm25_search(
    workspace_id: str | UUID,
    query: str,
    *,
    match_count: int = 20,
    documents: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Rank in-memory (or freshly loaded) workspace docs with BM25Okapi."""
    query = (query or "").strip()
    if not query:
        return []

    corpus = documents if documents is not None else load_workspace_documents(workspace_id)
    if not corpus:
        return []

    tokenized_corpus = [tokenize(str(doc.get("content") or "")) for doc in corpus]
    if not any(tokenized_corpus):
        return []

    bm25 = BM25Okapi(tokenized_corpus)
    query_tokens = tokenize(query)
    scores = [float(s) for s in bm25.get_scores(query_tokens)]
    if not scores or max(scores) <= 0:
        # Tiny corpora can yield all-zero BM25 IDF; fall back to term overlap.
        qset = set(query_tokens)
        scores = [
            float(len(qset.intersection(set(toks)))) for toks in tokenized_corpus
        ]

    ranked_indices = sorted(
        range(len(scores)),
        key=lambda idx: float(scores[idx]),
        reverse=True,
    )

    hits: list[dict[str, Any]] = []
    for idx in ranked_indices[: max(1, match_count)]:
        score = float(scores[idx])
        if score <= 0 and hits:
            break
        item = dict(corpus[idx])
        item["bm25_score"] = score
        item["rerank_score"] = score
        hits.append(item)
    return hits
