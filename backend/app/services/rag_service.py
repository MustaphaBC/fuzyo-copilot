"""Cohere embeddings, Supabase hybrid search, and FlashRank reranking."""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx

from backend.app.core.config import settings
from backend.app.services.ingestion import DocumentChunk, get_loader

logger = logging.getLogger(__name__)

_COHERE_EMBED_URL = "https://api.cohere.com/v2/embed"
_EMBED_MODEL = "embed-v4.0"
_EMBED_DIM = 1536
_DEFAULT_MATCH_COUNT = 20
_EMBED_CACHE_MAX = 1024

_embed_cache: OrderedDict[str, list[float]] = OrderedDict()
_embed_cache_stats: dict[str, int] = {"hits": 0, "misses": 0, "api_calls": 0}


def _embed_cache_key(text: str, *, model: str, input_type: str) -> str:
    payload = f"{model}|{input_type}|{text}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def clear_embedding_cache() -> None:
    """Drop all cached vectors and reset hit/miss/api counters."""
    _embed_cache.clear()
    _embed_cache_stats["hits"] = 0
    _embed_cache_stats["misses"] = 0
    _embed_cache_stats["api_calls"] = 0


def get_embedding_cache_stats() -> dict[str, int]:
    """Return a copy of cache counters (hits, misses, api_calls) plus size."""
    return {
        "hits": _embed_cache_stats["hits"],
        "misses": _embed_cache_stats["misses"],
        "api_calls": _embed_cache_stats["api_calls"],
        "size": len(_embed_cache),
        "maxsize": _EMBED_CACHE_MAX,
    }


def _cache_get(key: str) -> list[float] | None:
    vector = _embed_cache.get(key)
    if vector is None:
        return None
    _embed_cache.move_to_end(key)
    _embed_cache_stats["hits"] += 1
    return list(vector)


def _cache_put(key: str, vector: list[float]) -> None:
    _embed_cache[key] = list(vector)
    _embed_cache.move_to_end(key)
    while len(_embed_cache) > _EMBED_CACHE_MAX:
        _embed_cache.popitem(last=False)


def _get_supabase_client() -> Any | None:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        logger.warning("Supabase credentials missing; RAG store/search disabled.")
        return None
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to create Supabase client: %s", exc)
        return None


def _pad_or_trim(vector: list[float], dim: int = _EMBED_DIM) -> list[float]:
    if len(vector) == dim:
        return vector
    if len(vector) > dim:
        return vector[:dim]
    return vector + [0.0] * (dim - len(vector))


async def _cohere_embed(
    texts: list[str],
    *,
    input_type: str,
) -> list[list[float]]:
    """Call Cohere embed API for the given texts. Returns [] on failure."""
    if not texts:
        return []
    api_key = (settings.cohere_api_key or "").strip()
    if not api_key:
        logger.warning("COHERE_API_KEY missing; embeddings unavailable.")
        return []

    payload = {
        "model": _EMBED_MODEL,
        "texts": texts,
        "input_type": input_type,
        "embedding_types": ["float"],
        "output_dimension": _EMBED_DIM,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    timeout = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)

    _embed_cache_stats["api_calls"] += 1
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(_COHERE_EMBED_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Cohere embed failed: %s", exc)
        return []

    embeddings = (
        data.get("embeddings", {}).get("float")
        or data.get("embeddings")
        or []
    )
    if not isinstance(embeddings, list) or not embeddings:
        logger.warning("Cohere embed returned no vectors.")
        return []

    return [_pad_or_trim([float(x) for x in vec]) for vec in embeddings]


async def embed_texts(
    texts: list[str],
    *,
    input_type: str = "search_document",
) -> list[list[float]]:
    """Embed texts via Cohere with an in-memory LRU cache.

    Cache key: sha256(model|input_type|text). Misses are batched into one API call.
    Returns [] on missing key / network / API failure (nothing cached on failure).
    """
    if not texts:
        return []

    keys = [
        _embed_cache_key(text, model=_EMBED_MODEL, input_type=input_type) for text in texts
    ]
    results: list[list[float] | None] = [None] * len(texts)
    miss_indices: list[int] = []
    miss_texts: list[str] = []

    for index, key in enumerate(keys):
        cached = _cache_get(key)
        if cached is not None:
            results[index] = cached
        else:
            _embed_cache_stats["misses"] += 1
            miss_indices.append(index)
            miss_texts.append(texts[index])

    if not miss_indices:
        return [list(vector) for vector in results]  # type: ignore[arg-type]

    fetched = await _cohere_embed(miss_texts, input_type=input_type)
    if not fetched or len(fetched) != len(miss_texts):
        # Do not poison cache; fail the whole batch like the previous API.
        return []

    for offset, index in enumerate(miss_indices):
        vector = fetched[offset]
        _cache_put(keys[index], vector)
        results[index] = vector

    return [list(vector) for vector in results]  # type: ignore[arg-type]


async def ingest_file(
    workspace_id: str | UUID,
    path: Path | str,
    *,
    sdlc_phase: int = 1,
) -> int:
    """Parse, embed, and insert document chunks. Returns number of rows inserted."""
    file_path = Path(path)
    try:
        loader = get_loader(file_path)
    except ValueError as exc:
        logger.warning("%s", exc)
        return 0

    chunks = loader.load(file_path, sdlc_phase=sdlc_phase)
    if not chunks:
        return 0

    vectors = await embed_texts([c.content for c in chunks], input_type="search_document")
    if not vectors or len(vectors) != len(chunks):
        logger.warning("Embedding failed for %s; skipping insert.", file_path)
        return 0

    client = _get_supabase_client()
    if client is None:
        return 0

    rows = [
        {
            "workspace_id": str(workspace_id),
            "content": chunk.content,
            "metadata": chunk.metadata,
            "embedding": vector,
        }
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]

    try:
        result = client.table("document_chunks").insert(rows).execute()
        inserted = len(result.data or [])
        return inserted
    except Exception as exc:  # noqa: BLE001
        logger.warning("Supabase insert failed: %s", exc)
        return 0


def _flashrank_rerank(query: str, candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not candidates:
        return []
    try:
        from flashrank import Ranker, RerankRequest

        ranker = Ranker()
        passages = [
            {"id": index, "text": item.get("content") or ""}
            for index, item in enumerate(candidates)
        ]
        request = RerankRequest(query=query, passages=passages)
        ranked = ranker.rerank(request)
        ordered: list[dict[str, Any]] = []
        for hit in ranked:
            idx = hit.get("id")
            if isinstance(idx, int) and 0 <= idx < len(candidates):
                item = dict(candidates[idx])
                item["rerank_score"] = hit.get("score")
                ordered.append(item)
        return ordered or candidates
    except Exception as exc:  # noqa: BLE001 — keep RPC order
        logger.warning("FlashRank unavailable; using RRF order: %s", exc)
        return candidates


async def hybrid_search(
    workspace_id: str | UUID,
    query: str,
    *,
    match_count: int = _DEFAULT_MATCH_COUNT,
) -> list[dict[str, Any]]:
    """Embed query, call hybrid_search_rrf, then FlashRank the top candidates."""
    query = (query or "").strip()
    if not query:
        return []

    vectors = await embed_texts([query], input_type="search_query")
    if not vectors:
        return []

    client = _get_supabase_client()
    if client is None:
        return []

    try:
        response = client.rpc(
            "hybrid_search_rrf",
            {
                "p_workspace_id": str(workspace_id),
                "p_query_text": query,
                "p_query_embedding": vectors[0],
                "p_match_count": match_count,
            },
        ).execute()
        candidates = list(response.data or [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("hybrid_search_rrf RPC failed: %s", exc)
        return []

    return _flashrank_rerank(query, candidates[:match_count])
