"""Live SSE smoke against a real staging/local API (no mocks).

Run on demand (API must be up, JWT valid, provider keys configured)::

    set RUN_LIVE_TESTS=true
    set LIVE_BEARER_TOKEN=<supabase_access_token>
    set LIVE_API_BASE_URL=http://127.0.0.1:8000
    pytest -m live -q

Skipped by default when RUN_LIVE_TESTS is unset so CI stays green.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
import pytest

pytestmark = pytest.mark.live

_LIVE_TRUTHY = frozenset({"1", "true", "yes"})
_TODO_RE = re.compile(r"\b(?:TODO|FIXME)\b", re.IGNORECASE)
_EMPTY_DEF_RE = re.compile(
    r"(?m)^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:\s*(?:pass|\.\.\.)?\s*(?:#.*)?$"
)
_MIN_RESPONSE_CHARS = 80
_DEFAULT_BASE = "http://127.0.0.1:8000"
_PROMPT = (
    "Rédige exactement 5 exigences non-fonctionnelles testables pour une API "
    "FastAPI de chat SSE (latence, disponibilité, sécurité, observabilité, "
    "limites de débit). Réponse Markdown structurée, sans placeholders."
)


def _live_enabled() -> bool:
    return os.environ.get("RUN_LIVE_TESTS", "").strip().lower() in _LIVE_TRUTHY


def _require_live_env() -> tuple[str, str]:
    if not _live_enabled():
        pytest.skip("Set RUN_LIVE_TESTS=true to run live SSE smoke")
    token = (os.environ.get("LIVE_BEARER_TOKEN") or "").strip()
    if not token:
        pytest.skip("LIVE_BEARER_TOKEN is required when RUN_LIVE_TESTS=true")
    base = (os.environ.get("LIVE_API_BASE_URL") or _DEFAULT_BASE).strip().rstrip("/")
    return base, token


def _parse_sse_events(raw: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for block in raw.split("\n\n"):
        lines = [line for line in block.splitlines() if line.startswith("data:")]
        if not lines:
            continue
        payload = "".join(line[5:].lstrip() for line in lines)
        if not payload or payload == "[DONE]":
            continue
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            events.append(data)
    return events


def _first_index(types: list[str], name: str) -> int:
    try:
        return types.index(name)
    except ValueError as exc:
        raise AssertionError(f"Missing SSE event type: {name}") from exc


def test_live_chat_completions_sse_order_and_quality() -> None:
    base, token = _require_live_env()
    url = f"{base}/api/v1/chat/completions"
    body = {
        "prompt": _PROMPT,
        "sdlc_phase": 3,
        "force_confidential": False,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", url, headers=headers, json=body) as response:
            assert response.status_code == 200, (
                f"Unexpected status {response.status_code}: {response.read()[:500]!r}"
            )
            content_type = (response.headers.get("content-type") or "").lower()
            assert "text/event-stream" in content_type, content_type
            raw = "".join(response.iter_text())

    events = _parse_sse_events(raw)
    assert events, "No SSE data events parsed from response"

    types = [str(event.get("type") or "") for event in events]
    routing_i = _first_index(types, "routing")
    rag_i = _first_index(types, "rag")
    token_i = _first_index(types, "token")
    quality_i = _first_index(types, "quality")

    assert routing_i < rag_i < token_i < quality_i, (
        f"SSE order invalid: routing={routing_i}, rag={rag_i}, "
        f"token={token_i}, quality={quality_i}; types={types}"
    )

    pieces = [
        str(event.get("content") or "")
        for event in events
        if event.get("type") == "token" and event.get("content")
    ]
    assert pieces, "Expected at least one non-empty token event"
    assembled = "".join(pieces)
    assert len(assembled.strip()) >= _MIN_RESPONSE_CHARS, (
        f"Assembled response too short ({len(assembled.strip())} chars)"
    )
    assert not _TODO_RE.search(assembled), "Response contains TODO/FIXME stub"
    assert not _EMPTY_DEF_RE.search(assembled), "Response contains empty def stubs"

    quality = next(event for event in events if event.get("type") == "quality")
    if "is_valid" in quality:
        assert quality["is_valid"] is True, f"quality.is_valid failed: {quality}"
