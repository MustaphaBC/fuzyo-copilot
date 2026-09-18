#!/usr/bin/env python3
"""Offline verification for OpenRouter HTTP 402 → local stub fallback.

Usage (repo root):
  python backend/scripts/verify_openrouter_402.py
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncIterator
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import httpx

from backend.app.api.chat import (
    _BILLING_NOTICE,
    _close_open_fence_suffix,
    _is_payment_required_error,
    _is_payment_required_token,
    _local_fallback_tokens,
)


def _fail(msg: str) -> None:
    print(f"FAIL  {msg}")
    raise SystemExit(1)


def test_helpers() -> None:
    assert _is_payment_required_token(
        "[openrouter error: HTTP 402 {\"error\":{\"message\":\"more credits\"}}]"
    ), "token detector missed HTTP 402"
    assert not _is_payment_required_token("[openrouter error: HTTP 429 rate limit]")

    req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    resp = httpx.Response(402, request=req)
    exc = httpx.HTTPStatusError("Payment Required", request=req, response=resp)
    assert _is_payment_required_error(exc)

    assert _close_open_fence_suffix("hello") == ""
    assert _close_open_fence_suffix("```mermaid\nflowchart LR\n  A-->B") == "\n```\n"
    print("PASS  helpers")


async def test_local_fallback_stream() -> None:
    prior = "```mermaid\nflowchart LR\n  A-->B\n"
    pieces: list[str] = []
    async for piece in _local_fallback_tokens(prior, "hello architecture", None):
        pieces.append(piece)
    text = "".join(pieces)

    if "```" not in text[:20] and prior.count("```") % 2 == 1:
        # closer should be first yield
        if not pieces or pieces[0] != "\n```\n":
            _fail(f"expected fence closer first, got {pieces[:2]!r}")

    if _BILLING_NOTICE not in text:
        _fail("missing billing notice")
    if "[LOCAL MOCK EXECUTION]" not in text:
        _fail("missing local mock tokens")

    full = prior + text
    if full.count("```") % 2 != 0:
        _fail(f"unclosed fence remains: count={full.count('```')}")

    print("PASS  local_fallback_stream")


async def test_openrouter_raises_402_path() -> None:
    """Simulate OpenRouter raise → catch → local fallback composition."""

    async def fake_openrouter_stream() -> AsyncIterator[str]:
        req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
        resp = httpx.Response(402, request=req, text='{"error":"credits"}')
        raise httpx.HTTPStatusError("HTTP 402", request=req, response=resp)
        yield  # pragma: no cover — makes this an async generator
        # unreachable

    prior_parts = ["```mermaid\nA-->B\n"]
    out: list[str] = []
    try:
        async for token in fake_openrouter_stream():
            out.append(token)
    except httpx.HTTPStatusError as exc:
        if not _is_payment_required_error(exc):
            _fail("expected payment-required HTTPStatusError")
        prior = "".join(prior_parts)
        async for piece in _local_fallback_tokens(prior, "prompt", None):
            out.append(piece)

    text = "".join(out)
    if _BILLING_NOTICE not in text:
        _fail("fallback after raise missing notice")
    if "[LOCAL MOCK EXECUTION]" not in text:
        _fail("fallback after raise missing local mock")
    if ("".join(prior_parts) + text).count("```") % 2 != 0:
        _fail("fences still unbalanced after raise fallback")
    print("PASS  openrouter_raises_402_path")


async def test_402_token_path() -> None:
    token = "[openrouter error: HTTP 402 Payment Required more credits needed]"
    if not _is_payment_required_token(token):
        _fail("402 token not detected")
    prior = "partial ```mermaid\n"
    pieces: list[str] = []
    async for piece in _local_fallback_tokens(prior, "x", None):
        pieces.append(piece)
    combined = prior + "".join(pieces)
    if combined.count("```") % 2 != 0:
        _fail("token-path fence close failed")
    print("PASS  402_token_path")


def main() -> int:
    test_helpers()
    asyncio.run(test_local_fallback_stream())
    asyncio.run(test_openrouter_raises_402_path())
    asyncio.run(test_402_token_path())
    print("\nAll OpenRouter 402 checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
