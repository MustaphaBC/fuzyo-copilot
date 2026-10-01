"""Unit tests for fail-closed privacy routing."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from backend.app.schemas.chat import ChatRequest, RouteReason, SdlcPhase, TargetClient
from backend.app.services.privacy_router import (
    _CEREBRAS_URL,
    _GROQ_URL,
    _parse_sensitivity_score,
    route_prompt,
    scan_secrets,
)


def _request(
    prompt: str = "Explain Clean Architecture briefly",
    *,
    force_confidential: bool = False,
    workspace_id: str | None = None,
) -> ChatRequest:
    return ChatRequest(
        prompt=prompt,
        sdlc_phase=SdlcPhase.ARCHITECTURE,
        force_confidential=force_confidential,
        workspace_id=workspace_id,
    )


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


def _mock_async_client(post: AsyncMock) -> MagicMock:
    client = MagicMock()
    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


def _ok_response(content: str) -> MagicMock:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(
        return_value={"choices": [{"message": {"content": content}}]}
    )
    return response


def test_parse_sensitivity_score_json() -> None:
    assert _parse_sensitivity_score('{"sensitivity_score": 0.42}') == pytest.approx(0.42)


def test_parse_sensitivity_score_unparseable_returns_none() -> None:
    assert _parse_sensitivity_score("not a score") is None
    assert _parse_sensitivity_score("") is None


def test_scan_secrets_detects_openai_key() -> None:
    labels = scan_secrets("use key sk-proj-abcdefghijklmnop")
    assert "openai_api_key" in labels


def test_force_confidential_routes_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    decision = _run(route_prompt(_request(force_confidential=True)))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0
    assert decision.selected_provider == "local_stub"


def test_missing_cerebras_key_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0
    assert decision.selected_provider == "local_stub"


def test_timeout_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "test-key",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    post = AsyncMock(side_effect=httpx.TimeoutException("read timed out"))
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0


def test_api_exception_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "test-key",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    request = httpx.Request("POST", "https://api.cerebras.ai/v1/chat/completions")
    response = httpx.Response(500, request=request)
    post = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "server error",
            request=request,
            response=response,
        )
    )
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0


def test_valid_low_score_routes_cloud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "test-key",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    post = AsyncMock(
        return_value=_ok_response('{"sensitivity_score": 0.1}')
    )
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.CLOUD_API
    assert decision.sensitivity_score == pytest.approx(0.1)
    assert decision.selected_provider == "gemini"


def test_valid_high_score_routes_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "test-key",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    post = AsyncMock(
        return_value=_ok_response('{"sensitivity_score": 0.9}')
    )
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == pytest.approx(0.9)
    assert decision.selected_provider == "local_stub"


def test_regex_secret_detection_routes_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    decision = _run(
        route_prompt(
            _request("Deploy with key sk-abcdefghijklmnopqrstuvwxyz012345")
        )
    )
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0
    assert "openai_api_key" in decision.detected_secrets


def test_unparseable_classifier_payload_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.cerebras_api_key",
        "test-key",
    )
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.force_local_mock",
        False,
    )
    post = AsyncMock(return_value=_ok_response("no numeric score here"))
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.sensitivity_score == 1.0


def _status_response(status_code: int) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    return response


def _enable_groq_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    for attr, value in (
        ("force_local_mock", False),
        ("cerebras_api_key", "cerebras-key"),
        ("groq_api_key", "groq-key"),
        ("privacy_classifier_fallback_provider", "groq"),
    ):
        monkeypatch.setattr(f"backend.app.services.privacy_router.settings.{attr}", value)


def test_cerebras_billing_error_falls_back_to_groq_and_opens_circuit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_groq_fallback(monkeypatch)

    async def post(url: str, **_: Any) -> MagicMock:
        if url == _CEREBRAS_URL:
            return _status_response(402)
        return _ok_response('{"sensitivity_score": 0.1}')

    mock_post = AsyncMock(side_effect=post)
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(mock_post),
    ):
        first = _run(route_prompt(_request()))
        second = _run(route_prompt(_request()))

    assert first.target_client == TargetClient.CLOUD_API
    assert second.target_client == TargetClient.CLOUD_API
    called_urls = [call.args[0] for call in mock_post.call_args_list]
    assert called_urls == [_CEREBRAS_URL, _GROQ_URL, _GROQ_URL]


def test_all_classifiers_failing_stays_local(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_groq_fallback(monkeypatch)
    post = AsyncMock(side_effect=httpx.ConnectTimeout("connect timed out"))
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(route_prompt(_request()))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE
    assert post.await_count == 2


def test_secrets_never_reach_fallback_classifier(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_groq_fallback(monkeypatch)
    post = AsyncMock(return_value=_ok_response('{"sensitivity_score": 0.0}'))
    with patch(
        "backend.app.services.privacy_router.httpx.AsyncClient",
        return_value=_mock_async_client(post),
    ):
        decision = _run(
            route_prompt(_request("Deploy with key sk-abcdefghijklmnopqrstuvwxyz012345"))
        )
    assert decision.route_reason == RouteReason.SECRETS_DETECTED
    post.assert_not_awaited()
