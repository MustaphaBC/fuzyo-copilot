"""Concurrency and fail-closed tests for the parallel privacy router."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.app.schemas.chat import (
    ChatRequest,
    RouteReason,
    RouterDecision,
    SdlcPhase,
    TargetClient,
)
from backend.app.services import privacy_router
from backend.app.services.privacy_router import route_prompt

_MODULE = "backend.app.services.privacy_router"
_SECRET_PROMPT = "Deploy with key sk-abcdefghijklmnopqrstuvwxyz012345"
_CLEAN_PROMPT = "Explain Clean Architecture briefly"

ClassifierFn = Callable[..., Awaitable[float | None]]


def _request(prompt: str = _CLEAN_PROMPT, *, force_confidential: bool = False) -> ChatRequest:
    return ChatRequest(
        prompt=prompt,
        sdlc_phase=SdlcPhase.ARCHITECTURE,
        force_confidential=force_confidential,
    )


@pytest.fixture(autouse=True)
def _router_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(f"{_MODULE}.settings.force_local_mock", False)
    monkeypatch.setattr(f"{_MODULE}.settings.cerebras_api_key", "test-key")
    monkeypatch.setattr(f"{_MODULE}.settings.privacy_classifier_timeout_s", 5.0)


def _set_classifier(monkeypatch: pytest.MonkeyPatch, fn: ClassifierFn) -> None:
    monkeypatch.setattr(f"{_MODULE}._classifier_sensitivity_score", fn)


def _fixed_score(score: float | None) -> ClassifierFn:
    async def classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        if send_gate is not None:
            await send_gate.wait()
        return score

    return classifier


async def _route_and_check_no_leaked_tasks(request: ChatRequest) -> RouterDecision:
    decision = await route_prompt(request)
    leftover = asyncio.all_tasks() - {asyncio.current_task()}
    assert not leftover, f"leaked tasks: {leftover}"
    return decision


def _run(request: ChatRequest) -> RouterDecision:
    return asyncio.run(_route_and_check_no_leaked_tasks(request))


def test_secrets_cancel_slow_classifier(monkeypatch: pytest.MonkeyPatch) -> None:
    state: dict[str, Any] = {"started": False, "cancelled": False}

    async def slow_classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        state["started"] = True
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise
        return 0.0

    _set_classifier(monkeypatch, slow_classifier)

    start = time.perf_counter()
    decision = _run(_request(_SECRET_PROMPT))
    elapsed = time.perf_counter() - start

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.SECRETS_DETECTED
    assert "openai_api_key" in decision.detected_secrets
    assert decision.sensitivity_score == 1.0
    assert state["started"] is True
    assert state["cancelled"] is True
    assert elapsed < 1.0


def test_secrets_never_transmitted_to_classifier() -> None:
    post = AsyncMock()
    client = MagicMock()
    client.post = post
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)

    with patch(f"{_MODULE}.httpx.AsyncClient", return_value=client):
        decision = _run(_request(_SECRET_PROMPT))

    assert decision.route_reason == RouteReason.SECRETS_DETECTED
    post.assert_not_awaited()


def test_classifier_raises_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken_classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        raise RuntimeError("boom")

    _set_classifier(monkeypatch, broken_classifier)

    decision = _run(_request())

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE
    assert decision.sensitivity_score == 1.0


def test_classifier_returns_none_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_classifier(monkeypatch, _fixed_score(None))

    decision = _run(_request())

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE


def test_classifier_timeout_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(f"{_MODULE}.settings.privacy_classifier_timeout_s", 0.05)

    async def hanging_classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        await asyncio.sleep(5)
        return 0.0

    _set_classifier(monkeypatch, hanging_classifier)

    start = time.perf_counter()
    decision = _run(_request())
    elapsed = time.perf_counter() - start

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE
    assert elapsed < 1.0


def test_scan_raises_fails_closed_without_sending(monkeypatch: pytest.MonkeyPatch) -> None:
    state: dict[str, bool] = {"gate_opened": False}

    def broken_scan(text: str) -> list[str]:
        raise RuntimeError("regex engine failure")

    async def gated_classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        assert send_gate is not None
        await send_gate.wait()
        state["gate_opened"] = True
        return 0.0

    monkeypatch.setattr(f"{_MODULE}.scan_secrets", broken_scan)
    _set_classifier(monkeypatch, gated_classifier)

    decision = _run(_request())

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE
    assert decision.detected_secrets == []
    assert state["gate_opened"] is False


def test_clean_prompt_low_score_routes_cloud(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_classifier(monkeypatch, _fixed_score(0.1))

    decision = _run(_request())

    assert decision.target_client == TargetClient.CLOUD_API
    assert decision.route_reason == RouteReason.CLOUD_ALLOWED
    assert decision.sensitivity_score == pytest.approx(0.1)
    assert decision.selected_provider == "gemini"


def test_high_score_routes_local_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    _set_classifier(monkeypatch, _fixed_score(0.9))

    decision = _run(_request())

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.SENSITIVITY_THRESHOLD
    assert decision.sensitivity_score == pytest.approx(0.9)


def test_force_confidential_skips_scan_and_classifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    classifier = AsyncMock(return_value=0.0)
    scan = MagicMock(return_value=[])
    _set_classifier(monkeypatch, classifier)
    monkeypatch.setattr(f"{_MODULE}.scan_secrets", scan)

    decision = _run(_request(_SECRET_PROMPT, force_confidential=True))

    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.FORCE_CONFIDENTIAL
    assert decision.sensitivity_score == 1.0
    classifier.assert_not_called()
    scan.assert_not_called()


def test_scan_and_classifier_run_concurrently(monkeypatch: pytest.MonkeyPatch) -> None:
    classifier_started = threading.Event()
    scan_finished = threading.Event()
    observed: dict[str, bool] = {}

    def blocking_scan(text: str) -> list[str]:
        observed["classifier_started_before_scan_done"] = classifier_started.wait(
            timeout=2.0
        )
        scan_finished.set()
        return []

    async def observing_classifier(
        prompt: str, *, send_gate: asyncio.Event | None = None
    ) -> float | None:
        observed["scan_done_when_classifier_started"] = scan_finished.is_set()
        classifier_started.set()
        assert send_gate is not None
        await send_gate.wait()
        return 0.2

    monkeypatch.setattr(f"{_MODULE}.scan_secrets", blocking_scan)
    _set_classifier(monkeypatch, observing_classifier)

    decision = _run(_request())

    assert observed["classifier_started_before_scan_done"] is True
    assert observed["scan_done_when_classifier_started"] is False
    assert decision.route_reason == RouteReason.CLOUD_ALLOWED


def test_telemetry_logs_timings_without_prompt_or_secrets(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _set_classifier(monkeypatch, _fixed_score(0.0))

    with caplog.at_level(logging.INFO, logger=privacy_router.logger.name):
        _run(_request(_SECRET_PROMPT))

    records = [r.getMessage() for r in caplog.records if "privacy_route " in r.getMessage()]
    assert len(records) == 1
    message = records[0]
    for field in ("outcome=secrets_detected", "reason=secrets_detected", "scan_ms=",
                  "classifier_ms=", "classifier_cancelled=True", "total_ms="):
        assert field in message
    assert "sk-abcdefghijklmnopqrstuvwxyz012345" not in message
    assert "Deploy with key" not in message
