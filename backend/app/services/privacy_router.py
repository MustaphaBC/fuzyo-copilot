"""Privacy router: regex secret scan + Cerebras sensitivity classification."""

from __future__ import annotations

import json
import re
from typing import Final

import httpx

from backend.app.core.config import settings
from backend.app.prompts.eval_prompts import CLASSIFIER_SYSTEM_PROMPT
from backend.app.schemas.chat import ChatRequest, RouterDecision, SdlcPhase, TargetClient
from backend.app.services.llm_base import build_chat_messages
from backend.app.services.model_registry import KNOWN_PROVIDERS

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
_CEREBRAS_MODEL = "llama3.1-8b"
_SENSITIVITY_THRESHOLD = 0.7


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


async def _cerebras_sensitivity_score(prompt: str) -> float | None:
    """Fast non-stream Cerebras classification.

    Returns a 0.0–1.0 score on success, or None when the classifier is
    unavailable (missing key, timeout, HTTP/API error, empty/unparseable
    payload) so callers can fail closed.
    """
    api_key = settings.cerebras_api_key
    if not str(api_key or "").strip():
        return None

    payload = {
        "model": _CEREBRAS_MODEL,
        "messages": build_chat_messages(prompt, CLASSIFIER_SYSTEM_PROMPT),
        "stream": False,
        "max_tokens": 128,
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(connect=0.15, read=0.15, write=0.15, pool=0.15)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(_CEREBRAS_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            text = str(content or "").strip()
            if not text:
                return None
            return _parse_sensitivity_score(text)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None


async def route_prompt(request: ChatRequest) -> RouterDecision:
    """Route a chat request to LOCAL_STUB or CLOUD_API (fail-closed)."""
    requires_rag = bool(request.workspace_id)

    if request.force_confidential or settings.force_local_mock:
        return _local_decision(sensitivity_score=1.0, requires_rag=requires_rag)

    detected = scan_secrets(request.prompt)
    if detected:
        return _local_decision(
            sensitivity_score=1.0,
            detected_secrets=detected,
            requires_rag=requires_rag,
        )

    score = await _cerebras_sensitivity_score(request.prompt)
    if score is None:
        # Classifier unavailable: never send to cloud LLMs.
        return _local_decision(sensitivity_score=1.0, requires_rag=requires_rag)
    if score > _SENSITIVITY_THRESHOLD:
        return _local_decision(sensitivity_score=score, requires_rag=requires_rag)

    return _cloud_decision(request, sensitivity_score=score)
