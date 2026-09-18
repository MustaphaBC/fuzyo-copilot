"""Estimate and log LLM token usage / cost without storing prompt text."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from backend.app.core.logging_config import get_logger

_log = get_logger("fuzyo.tokens")

# Approximate USD per 1M tokens (input / output). Indicative only — update as needed.
_PRICE_PER_MTOK: Mapping[str, tuple[float, float]] = {
    "groq": (0.05, 0.08),
    "gemini": (0.10, 0.40),
    "cerebras": (0.10, 0.10),
    "sambanova": (0.50, 1.00),
    "mistral": (0.30, 0.90),
    "openrouter": (0.50, 1.50),
    "local_stub": (0.0, 0.0),
    "auto": (0.20, 0.60),
}


@dataclass(frozen=True, slots=True)
class TokenUsage:
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float


def estimate_tokens(text: str) -> int:
    """Heuristic token count (~4 characters per token). Empty → 0."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def estimate_cost_usd(
    provider: str,
    *,
    prompt_tokens: int,
    completion_tokens: int,
) -> float:
    key = (provider or "auto").strip().lower() or "auto"
    inp_rate, out_rate = _PRICE_PER_MTOK.get(key, _PRICE_PER_MTOK["auto"])
    cost = (prompt_tokens / 1_000_000.0) * inp_rate + (
        completion_tokens / 1_000_000.0
    ) * out_rate
    return round(cost, 8)


def estimate_token_usage(
    *,
    provider: str,
    model: str,
    prompt_text: str,
    completion_text: str,
) -> TokenUsage:
    """Compute usage from text lengths only (callers must not log prompt_text)."""
    prompt_tokens = estimate_tokens(prompt_text)
    completion_tokens = estimate_tokens(completion_text)
    total = prompt_tokens + completion_tokens
    cost = estimate_cost_usd(
        provider,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    return TokenUsage(
        provider=(provider or "unknown").strip() or "unknown",
        model=(model or "unknown").strip() or "unknown",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total,
        estimated_cost_usd=cost,
    )


def log_token_usage(
    usage: TokenUsage,
    *,
    sdlc_phase: int | None = None,
    target_client: str | None = None,
    force_confidential: bool = False,
) -> None:
    """Emit a structured usage event — never includes prompt/completion bodies."""
    _log.info(
        "llm_token_usage",
        provider=usage.provider,
        model=usage.model,
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        estimated_cost_usd=usage.estimated_cost_usd,
        sdlc_phase=sdlc_phase,
        target_client=target_client,
        force_confidential=bool(force_confidential),
    )
