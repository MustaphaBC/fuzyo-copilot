"""Cloud provider failover chain in the SSE chat stream."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from backend.app.api import chat
from backend.app.schemas.chat import (
    ChatRequest,
    QualityScore,
    RouteReason,
    RouterDecision,
    SdlcPhase,
    TargetClient,
)
from backend.app.services.provider_fallback import (
    fallback_candidates,
    is_provider_open,
    reset_provider_circuits,
)

_ALL_KEYS = (
    "groq_api_key",
    "gemini_api_key",
    "cerebras_api_key",
    "sambanova_api_key",
    "mistral_api_key",
    "openrouter_api_key",
)


def _fake_client(tokens: list[str] | Exception) -> type:
    class FakeClient:
        calls = 0

        def __init__(self, *, model: str | None = None) -> None:
            self.model = model

        async def generate_stream(self, prompt: str, **_: Any) -> AsyncIterator[str]:
            type(self).calls += 1
            if isinstance(tokens, Exception):
                raise tokens
            for token in tokens:
                yield token

    return FakeClient


def _decision(target: TargetClient = TargetClient.CLOUD_API) -> RouterDecision:
    local = target == TargetClient.LOCAL_STUB
    return RouterDecision(
        target_client=target,
        selected_provider="local_stub" if local else "gemini",
        selected_model="mock-local" if local else "gemini-3.6-flash",
        sensitivity_score=1.0 if local else 0.0,
        route_reason=RouteReason.FORCE_CONFIDENTIAL if local else RouteReason.CLOUD_ALLOWED,
    )


@pytest.fixture(autouse=True)
def _chat_env(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_provider_circuits()
    for attr in _ALL_KEYS:
        monkeypatch.setattr(f"backend.app.core.config.settings.{attr}", "")

    async def good_score(text: str, **_: Any) -> QualityScore:
        return QualityScore(
            is_valid=True, tier1_schema_pass=True, tier2_heuristic_pass=True, tier3_score=9
        )

    monkeypatch.setattr(chat, "evaluate_response", good_score)
    monkeypatch.setattr(chat, "log_token_usage", lambda *a, **k: None)
    yield
    reset_provider_circuits()


def _use(
    monkeypatch: pytest.MonkeyPatch,
    clients: dict[str, type],
    *,
    order: str,
    decision: RouterDecision | None = None,
) -> None:
    for provider in clients:
        monkeypatch.setattr(f"backend.app.core.config.settings.{provider}_api_key", "key")
        monkeypatch.setitem(chat._PROVIDER_CLIENTS, provider, clients[provider])
    monkeypatch.setattr("backend.app.core.config.settings.llm_fallback_order", order)

    async def fake_route(_: ChatRequest) -> RouterDecision:
        return decision or _decision()

    monkeypatch.setattr(chat, "route_prompt", fake_route)


def _events() -> list[dict[str, Any]]:
    async def collect() -> list[dict[str, Any]]:
        request = ChatRequest(prompt="Explain CQRS", sdlc_phase=SdlcPhase.ARCHITECTURE)
        return [
            json.loads(raw.removeprefix("data: ").strip())
            async for raw in chat._event_stream(request)
        ]

    return asyncio.run(collect())


def _text(events: list[dict[str, Any]]) -> str:
    return "".join(e["content"] for e in events if e["type"] == "token")


def _hops(events: list[dict[str, Any]]) -> list[tuple[str, str, str, str]]:
    return [
        (e["from_provider"], e["to_provider"], e["target"], e["reason"])
        for e in events
        if e["type"] == "fallback"
    ]


def test_skips_billing_blocked_provider_and_reaches_working_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use(
        monkeypatch,
        {
            "gemini": _fake_client(["[gemini error: HTTP 503 overloaded]"]),
            "openrouter": _fake_client(["[openrouter error: HTTP 402 Payment Required]"]),
            "groq": _fake_client(["Hello ", "world"]),
        },
        order="openrouter,groq",
    )
    events = _events()
    assert _hops(events) == [
        ("gemini", "openrouter", "CLOUD", "http_503"),
        ("openrouter", "groq", "CLOUD", "billing_402"),
    ]
    assert _text(events) == "Hello world"
    assert is_provider_open("openrouter")
    assert is_provider_open("gemini")


def test_open_circuit_skips_provider_on_next_request(monkeypatch: pytest.MonkeyPatch) -> None:
    openrouter = _fake_client(["[openrouter error: HTTP 402 Payment Required]"])
    _use(
        monkeypatch,
        {
            "gemini": _fake_client(["[gemini error: HTTP 503 overloaded]"]),
            "openrouter": openrouter,
            "groq": _fake_client(["ok"]),
        },
        order="openrouter,groq",
    )
    _events()
    second = _events()
    assert openrouter.calls == 1
    assert _hops(second) == [("gemini", "groq", "CLOUD", "circuit_open")]
    assert _text(second) == "ok"


def test_transport_error_fails_over(monkeypatch: pytest.MonkeyPatch) -> None:
    _use(
        monkeypatch,
        {
            "gemini": _fake_client(httpx.ConnectError("dns failure")),
            "groq": _fake_client(["ok"]),
        },
        order="groq",
    )
    events = _events()
    assert _hops(events) == [("gemini", "groq", "CLOUD", "provider_error")]
    assert _text(events) == "ok"


def test_every_provider_failing_ends_on_local_model(monkeypatch: pytest.MonkeyPatch) -> None:
    _use(
        monkeypatch,
        {
            "gemini": _fake_client(["[gemini error: HTTP 503 overloaded]"]),
            "groq": _fake_client(["[groq error: HTTP 429 rate limit]"]),
        },
        order="groq",
    )
    events = _events()
    assert _hops(events) == [
        ("gemini", "groq", "CLOUD", "http_503"),
        ("groq", "local_stub", "LOCAL", "http_429"),
    ]
    assert "LOCAL MOCK EXECUTION" in _text(events)


def test_local_decision_never_fails_over_to_cloud(monkeypatch: pytest.MonkeyPatch) -> None:
    groq = _fake_client(["cloud answer"])
    _use(
        monkeypatch,
        {"groq": groq},
        order="groq",
        decision=_decision(TargetClient.LOCAL_STUB),
    )
    events = _events()
    assert _hops(events) == []
    assert groq.calls == 0
    assert "LOCAL MOCK EXECUTION" in _text(events)


def test_candidates_skip_unkeyed_and_excluded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.app.core.config.settings.groq_api_key", "key")
    monkeypatch.setattr("backend.app.core.config.settings.mistral_api_key", "key")
    monkeypatch.setattr(
        "backend.app.core.config.settings.llm_fallback_order", "sambanova,groq,mistral"
    )
    names = [c.provider for c in fallback_candidates(exclude={"groq"})]
    assert names == ["mistral"]
