#!/usr/bin/env python3
"""Verify Cohere embedding LRU cache skips HTTP on identical queries.

Usage (repo root):
  python backend/scripts/verify_embed_cache.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import httpx

from backend.app.core import config as config_mod
from backend.app.services import rag_service
from backend.app.services.rag_service import (
    _EMBED_CACHE_MAX,
    _EMBED_DIM,
    _EMBED_MODEL,
    _embed_cache,
    _embed_cache_key,
    clear_embedding_cache,
    embed_texts,
    get_embedding_cache_stats,
)


def _fail(msg: str) -> None:
    print(f"FAIL  {msg}")
    raise SystemExit(1)


def _fake_embedding_response(texts: list[str]) -> dict[str, Any]:
    vectors = []
    for index, _ in enumerate(texts):
        # Distinct but valid-length stub vectors
        base = float(index + 1)
        vectors.append([base] * _EMBED_DIM)
    return {"embeddings": {"float": vectors}}


async def test_identical_queries_use_cache() -> None:
    clear_embedding_cache()
    query = "identical vector search query"

    post_mock = AsyncMock()

    async def fake_post(url: str, **kwargs: Any) -> MagicMock:
        payload = kwargs.get("json") or {}
        texts = list(payload.get("texts") or [])
        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json = MagicMock(return_value=_fake_embedding_response(texts))
        return response

    post_mock.side_effect = fake_post

    mock_client = MagicMock()
    mock_client.post = post_mock
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with (
        patch.object(config_mod.settings, "cohere_api_key", "test-cohere-key"),
        patch("httpx.AsyncClient", return_value=mock_client),
    ):
        t0 = time.perf_counter()
        first = await embed_texts([query], input_type="search_query")
        t1 = time.perf_counter()
        second = await embed_texts([query], input_type="search_query")
        t2 = time.perf_counter()

    if not first or not second:
        _fail("expected non-empty embeddings")
    if first != second:
        _fail("cached vector mismatch")

    stats = get_embedding_cache_stats()
    if stats["api_calls"] != 1:
        _fail(f"expected api_calls=1 got {stats['api_calls']}")
    if stats["hits"] < 1:
        _fail(f"expected hits>=1 got {stats['hits']}")
    if post_mock.await_count != 1:
        _fail(f"expected 1 HTTP post, got {post_mock.await_count}")

    first_ms = (t1 - t0) * 1000
    second_ms = (t2 - t1) * 1000
    print(
        f"PASS  identical_queries api_calls=1 hits={stats['hits']} "
        f"first={first_ms:.3f}ms second={second_ms:.3f}ms (0ms Cohere on second)"
    )


async def test_eviction() -> None:
    clear_embedding_cache()
    # Shrink max for a fast eviction check via temporary patch.
    original_max = rag_service._EMBED_CACHE_MAX
    rag_service._EMBED_CACHE_MAX = 3

    post_mock = AsyncMock()

    async def fake_post(url: str, **kwargs: Any) -> MagicMock:
        payload = kwargs.get("json") or {}
        texts = list(payload.get("texts") or [])
        response = MagicMock()
        response.raise_for_status = MagicMock()
        response.json = MagicMock(return_value=_fake_embedding_response(texts))
        return response

    post_mock.side_effect = fake_post
    mock_client = MagicMock()
    mock_client.post = post_mock
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    try:
        with (
            patch.object(config_mod.settings, "cohere_api_key", "test-cohere-key"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            for index in range(4):
                await embed_texts([f"evict-{index}"], input_type="search_query")

        oldest = _embed_cache_key("evict-0", model=_EMBED_MODEL, input_type="search_query")
        newest = _embed_cache_key("evict-3", model=_EMBED_MODEL, input_type="search_query")
        if oldest in _embed_cache:
            _fail("oldest key should have been evicted")
        if newest not in _embed_cache:
            _fail("newest key should remain")
        if len(_embed_cache) > 3:
            _fail(f"cache size {len(_embed_cache)} exceeds max 3")
        print("PASS  eviction")
    finally:
        rag_service._EMBED_CACHE_MAX = original_max
        clear_embedding_cache()


def main() -> int:
    asyncio.run(test_identical_queries_use_cache())
    asyncio.run(test_eviction())
    print("\nAll embedding cache checks passed.")
    return 0


if __name__ == "__main__":
    # silence unused import lint for httpx in type checkers
    _ = httpx
    _ = _EMBED_CACHE_MAX
    sys.exit(main())
