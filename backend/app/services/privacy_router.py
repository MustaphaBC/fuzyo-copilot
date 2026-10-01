"""Privacy router: regex secret scan + Cerebras (fallback Groq) sensitivity classification."""

from __future__ import annotations

import asyncio
import functools
import json
import logging
import re
import ssl
import time
from dataclasses import dataclass, field
from typing import Final

import certifi
import httpx

from backend.app.core.config import settings
from backend.app.prompts.eval_prompts import CLASSIFIER_SYSTEM_PROMPT
from backend.app.schemas.chat import (
    ChatRequest,
    RouteReason,
    RouterDecision,
    SdlcPhase,
    TargetClient,
)
from backend.app.services.llm_base import build_chat_messages
from backend.app.services.model_registry import KNOWN_PROVIDERS

logger = logging.getLogger(__name__)

_SECRET_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    (
        "openai_api_key",
        re.compile(r"\bsk-(?:proj-|or-v1-)?[A-Za-z0-9\-_]{4,}\b"),
    ),
    (
        "github_token",
        re.compile(r"\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{10,}\b"),
    ),
    (
        "private_ip",
        re.compile(
            r"\b(?:"
            r"(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3})"
            r"|(?:192\.168\.\d{1,3}\.\d{1,3})"
            r"|(?:172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})"
            r"|(?:\d{1,3}(?:\.\d{1,3}){3})"
            r")\b"
        ),
    ),
    (
        "password_assignment",
        re.compile(
            r"(?i)\b(?:password|passwd|pwd)\b\s*[:=]\s*['\"]?[^\s'\"]{4,}"
        ),
    ),
    (
        "ssh_private_key",
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    ),
    (
        "aws_access_key",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    ),
    (
        "generic_bearer",
        re.compile(r"(?i)\bBearer\s+[A-Za-z0-9\-_\.=]{8,}"),
    ),
)

_PHASE_PROVIDER_MAP: Final[dict[SdlcPhase, tuple[str, str]]] = {
    SdlcPhase.EXPRESSION_DU_BESOIN: ("gemini", "gemini-3.6-flash"),
    SdlcPhase.ANALYSE_FONCTIONNELLE: ("gemini", "gemini-3.6-flash"),
    SdlcPhase.ARCHITECTURE: ("gemini", "gemini-3.6-flash"),
    SdlcPhase.GESTION_DE_PROJET: ("groq", "openai/gpt-oss-120b"),
    SdlcPhase.DEVELOPPEMENT: ("mistral", "codestral-latest"),
    SdlcPhase.TESTS_QA: ("groq", "openai/gpt-oss-120b"),
    SdlcPhase.RECETTE: ("gemini", "gemini-3.6-flash"),
    SdlcPhase.DEVOPS: ("groq", "openai/gpt-oss-120b"),
    SdlcPhase.MISE_EN_PRODUCTION: ("gemini", "gemini-3.6-flash"),
}

_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_SENSITIVITY_THRESHOLD = 0.7
_CLASSIFIER_HTTP_TIMEOUT: Final = httpx.Timeout(connect=1.0, read=1.5, write=1.0, pool=1.0)
# Account-level failures (bad key, billing, retired model): retrying per request only adds latency.
_CIRCUIT_STATUSES: Final[frozenset[int]] = frozenset({401, 402, 403, 404})


@dataclass(frozen=True)
class _ClassifierEndpoint:
    provider: str
    url: str
    api_key: str
    model: str
    extra_payload: dict[str, object] = field(default_factory=dict)


_circuit_open_until: dict[str, float] = {}


@functools.cache
def _classifier_ssl_context() -> ssl.SSLContext:
    # Loading the CA bundle blocks the event loop for hundreds of ms; do it once.
    return ssl.create_default_context(cafile=certifi.where())


_classifier_ssl_context()


def reset_classifier_circuit() -> None:
    """Re-enable every classifier provider (tests / key rotation)."""
    _circuit_open_until.clear()


def _circuit_open(provider: str) -> bool:
    until = _circuit_open_until.get(provider)
    if until is None:
        return False
    if time.monotonic() >= until:
        _circuit_open_until.pop(provider, None)
        return False
    return True


def _classifier_endpoints() -> list[_ClassifierEndpoint]:
    """Primary Cerebras, then the configured fallback; skips missing keys and open circuits."""
    candidates = [
        _ClassifierEndpoint(
            provider="cerebras",
            url=_CEREBRAS_URL,
            api_key=str(settings.cerebras_api_key or "").strip(),
            model=settings.privacy_classifier_cerebras_model,
        )
    ]
    if settings.privacy_classifier_fallback_provider.strip().lower() == "groq":
        candidates.append(
            _ClassifierEndpoint(
                provider="groq",
                url=_GROQ_URL,
                api_key=str(settings.groq_api_key or "").strip(),
                model=settings.privacy_classifier_groq_model,
                extra_payload={"reasoning_effort": "low", "reasoning_format": "hidden"},
            )
        )
    return [c for c in candidates if c.api_key and not _circuit_open(c.provider)]


def scan_secrets(text: str) -> list[str]:
    """Return unique secret labels found in text (never raw secret values)."""
    found: list[str] = []
    for label, pattern in _SECRET_PATTERNS:
        if pattern.search(text) and label not in found:
            found.append(label)
    return found


def _local_decision(
    *,
    sensitivity_score: float,
    reason: RouteReason,
    detected_secrets: list[str] | None = None,
    requires_rag: bool = False,
) -> RouterDecision:
    return RouterDecision(
        target_client=TargetClient.LOCAL_STUB,
        selected_provider="local_stub",
        selected_model="mock-local",
        sensitivity_score=sensitivity_score,
        detected_secrets=detected_secrets or [],
        requires_rag=requires_rag,
        route_reason=reason,
    )


def _cloud_decision(
    request: ChatRequest,
    *,
    sensitivity_score: float,
) -> RouterDecision:
    provider, model = _PHASE_PROVIDER_MAP[request.sdlc_phase]

    override_provider = (request.provider_override or "").strip().lower() or None
    override_model = (request.model_override or "").strip() or None

    # Single-key UI sends both; apply together to avoid provider/model desync.
    if override_provider and override_model:
        if override_provider in KNOWN_PROVIDERS:
            provider = override_provider
            model = override_model
    elif override_model and not override_provider:
        # Legacy: model-only override keeps phase provider (may mismatch).
        model = override_model

    return RouterDecision(
        target_client=TargetClient.CLOUD_API,
        selected_provider=provider,
        selected_model=model,
        sensitivity_score=sensitivity_score,
        detected_secrets=[],
        requires_rag=bool(request.workspace_id),
    )


def _parse_sensitivity_score(text: str) -> float | None:
    """Extract a 0.0–1.0 sensitivity score, or None if unparseable."""
    stripped = text.strip()
    if not stripped:
        return None

    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict) and "sensitivity_score" in payload:
            return min(1.0, max(0.0, float(payload["sensitivity_score"])))
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    match = re.search(r"sensitivity_score['\"]?\s*[:=]\s*([01](?:\.\d+)?)", stripped)
    if match:
        return min(1.0, max(0.0, float(match.group(1))))

    match = re.search(r"\b(0(?:\.\d+)?|1(?:\.0+)?)\b", stripped)
    if match:
        return min(1.0, max(0.0, float(match.group(1))))

    return None


async def _score_with_endpoint(
    client: httpx.AsyncClient,
    endpoint: _ClassifierEndpoint,
    messages: list[dict[str, str]],
) -> float | None:
    """One non-stream classification call; None on any failure (caller fails over / closed)."""
    payload: dict[str, object] = {
        "model": endpoint.model,
        "messages": messages,
        "stream": False,
        "max_tokens": 256,
        "temperature": 0,
        **endpoint.extra_payload,
    }
    headers = {
        "Authorization": f"Bearer {endpoint.api_key}",
        "Content-Type": "application/json",
    }
    try:
        response = await client.post(endpoint.url, headers=headers, json=payload)
        if response.status_code in _CIRCUIT_STATUSES:
            _circuit_open_until[endpoint.provider] = (
                time.monotonic() + settings.privacy_classifier_circuit_s
            )
            logger.warning(
                "privacy_router classifier %s answered %s; skipping it for %ss",
                endpoint.provider,
                response.status_code,
                settings.privacy_classifier_circuit_s,
            )
            return None
        response.raise_for_status()
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        text = str(content or "").strip()
        if not text:
            return None
        return _parse_sensitivity_score(text)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning(
            "privacy_router classifier %s failed (%s)",
            endpoint.provider,
            type(exc).__name__,
        )
        return None


async def _classifier_sensitivity_score(
    prompt: str,
    *,
    send_gate: asyncio.Event | None = None,
) -> float | None:
    """Fast non-stream sensitivity classification (Cerebras, then fallback provider).

    Returns a 0.0–1.0 score from the first provider that answers, or None when
    every provider is unavailable (missing key, open circuit, timeout, HTTP/API
    error, empty/unparseable payload) so callers can fail closed.

    When ``send_gate`` is given, request setup runs immediately but the prompt
    is only transmitted once the gate is set (i.e. the secret scan came back
    clean), so secrets never reach a cloud classifier.
    """
    endpoints = _classifier_endpoints()
    if not endpoints:
        return None

    messages = build_chat_messages(prompt, CLASSIFIER_SYSTEM_PROMPT)
    async with httpx.AsyncClient(
        timeout=_CLASSIFIER_HTTP_TIMEOUT, verify=_classifier_ssl_context()
    ) as client:
        if send_gate is not None:
            await send_gate.wait()
        for endpoint in endpoints:
            score = await _score_with_endpoint(client, endpoint, messages)
            if score is not None:
                return score
    return None


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


async def _timed_scan(prompt: str, timings: dict[str, float]) -> list[str]:
    start = time.perf_counter()
    try:
        return await asyncio.to_thread(scan_secrets, prompt)
    finally:
        timings["scan_ms"] = _elapsed_ms(start)


async def _timed_classifier(
    prompt: str,
    send_gate: asyncio.Event,
    timings: dict[str, float],
) -> float | None:
    start = time.perf_counter()
    try:
        return await asyncio.wait_for(
            _classifier_sensitivity_score(prompt, send_gate=send_gate),
            timeout=settings.privacy_classifier_timeout_s,
        )
    finally:
        timings["classifier_ms"] = _elapsed_ms(start)


async def _cancel_and_drain(*tasks: asyncio.Task[object]) -> None:
    """Cancel unfinished tasks and consume every outcome (no leaked exceptions)."""
    for task in tasks:
        if not task.done():
            task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def _decide(
    request: ChatRequest,
    scan_task: asyncio.Task[list[str]],
    classifier_task: asyncio.Task[float | None],
    send_gate: asyncio.Event,
    requires_rag: bool,
) -> tuple[RouterDecision, str]:
    """Return the routing decision plus a telemetry outcome label."""
    try:
        detected = await scan_task
    except Exception as exc:
        # Absence of secrets cannot be proven: fail closed without claiming a match.
        logger.warning(
            "privacy_router secret scan failed (%s); failing closed",
            type(exc).__name__,
        )
        classifier_task.cancel()
        return (
            _local_decision(
                sensitivity_score=1.0,
                reason=RouteReason.CLASSIFIER_UNAVAILABLE,
                requires_rag=requires_rag,
            ),
            "scan_error",
        )

    if detected:
        classifier_task.cancel()
        return (
            _local_decision(
                sensitivity_score=1.0,
                reason=RouteReason.SECRETS_DETECTED,
                detected_secrets=detected,
                requires_rag=requires_rag,
            ),
            "secrets_detected",
        )

    send_gate.set()
    outcome: str | None = None
    score: float | None = None
    try:
        score = await classifier_task
    except TimeoutError:
        outcome = "classifier_timeout"
    except Exception as exc:
        logger.warning(
            "privacy_router classifier failed (%s); failing closed",
            type(exc).__name__,
        )
        outcome = "classifier_error"

    if score is None:
        # Classifier unavailable: never send to cloud LLMs.
        return (
            _local_decision(
                sensitivity_score=1.0,
                reason=RouteReason.CLASSIFIER_UNAVAILABLE,
                requires_rag=requires_rag,
            ),
            outcome or "classifier_no_score",
        )
    if score > _SENSITIVITY_THRESHOLD:
        return (
            _local_decision(
                sensitivity_score=score,
                reason=RouteReason.SENSITIVITY_THRESHOLD,
                requires_rag=requires_rag,
            ),
            "sensitivity_threshold",
        )

    return _cloud_decision(request, sensitivity_score=score), "cloud_allowed"


def _log_route(
    decision: RouterDecision,
    *,
    outcome: str,
    started: float,
    timings: dict[str, float],
    classifier_cancelled: bool = False,
) -> None:
    logger.info(
        "privacy_route outcome=%s reason=%s target=%s scan_ms=%s "
        "classifier_ms=%s classifier_cancelled=%s total_ms=%s",
        outcome,
        decision.route_reason.value,
        decision.target_client.value,
        timings.get("scan_ms"),
        timings.get("classifier_ms"),
        classifier_cancelled,
        _elapsed_ms(started),
    )


async def route_prompt(request: ChatRequest) -> RouterDecision:
    """Route a chat request to LOCAL_STUB or CLOUD_API (fail-closed).

    The secret scan (worker thread) and the Cerebras classifier run
    concurrently; the classifier only transmits the prompt once the scan is
    clean and is cancelled as soon as secrets are found.
    """
    started = time.perf_counter()
    requires_rag = bool(request.workspace_id)
    timings: dict[str, float] = {}

    if request.force_confidential or settings.force_local_mock:
        decision = _local_decision(
            sensitivity_score=1.0,
            reason=RouteReason.FORCE_CONFIDENTIAL,
            requires_rag=requires_rag,
        )
        _log_route(
            decision, outcome="force_confidential", started=started, timings=timings
        )
        return decision

    send_gate = asyncio.Event()
    scan_task = asyncio.create_task(_timed_scan(request.prompt, timings))
    classifier_task = asyncio.create_task(
        _timed_classifier(request.prompt, send_gate, timings)
    )
    try:
        decision, outcome = await _decide(
            request, scan_task, classifier_task, send_gate, requires_rag
        )
    finally:
        await _cancel_and_drain(scan_task, classifier_task)

    _log_route(
        decision,
        outcome=outcome,
        started=started,
        timings=timings,
        classifier_cancelled=classifier_task.cancelled(),
    )
    return decision
