"""Unit tests for LLM token / cost estimation."""

from __future__ import annotations

from backend.app.services.token_tracker import (
    estimate_cost_usd,
    estimate_token_usage,
    estimate_tokens,
)


def test_estimate_tokens_empty() -> None:
    assert estimate_tokens("") == 0


def test_estimate_tokens_heuristic() -> None:
    # 4 chars → 1 token; 5 chars → 2 tokens ((5+3)//4)
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("abcde") == 2
    assert estimate_tokens("x" * 100) == 25


def test_estimate_cost_local_stub_is_zero() -> None:
    assert estimate_cost_usd("local_stub", prompt_tokens=1000, completion_tokens=2000) == 0.0


def test_estimate_token_usage_groq() -> None:
    prompt = "a" * 40  # 10 tokens
    completion = "b" * 80  # 20 tokens
    usage = estimate_token_usage(
        provider="groq",
        model="openai/gpt-oss-120b",
        prompt_text=prompt,
        completion_text=completion,
    )
    assert usage.provider == "groq"
    assert usage.model == "openai/gpt-oss-120b"
    assert usage.prompt_tokens == 10
    assert usage.completion_tokens == 20
    assert usage.total_tokens == 30
    expected = (10 / 1_000_000.0) * 0.05 + (20 / 1_000_000.0) * 0.08
    assert usage.estimated_cost_usd == round(expected, 8)


def test_estimate_token_usage_unknown_provider_uses_auto_rates() -> None:
    usage = estimate_token_usage(
        provider="unknown-vendor",
        model="x",
        prompt_text="abcd",
        completion_text="abcd",
    )
    assert usage.prompt_tokens == 1
    assert usage.completion_tokens == 1
    # auto rates 0.20 / 0.60 per MTok
    expected = (1 / 1_000_000.0) * 0.20 + (1 / 1_000_000.0) * 0.60
    assert usage.estimated_cost_usd == round(expected, 8)
