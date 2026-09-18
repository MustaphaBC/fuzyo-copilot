"""Shared Fuzyo model registry (keyed providers + catalog metadata)."""

from __future__ import annotations

from typing import Any

from backend.app.core.config import settings

# Catalog of Fuzyo-supported chat providers (existing keys only).
PROVIDER_CATALOG: tuple[dict[str, str], ...] = (
    {
        "provider": "groq",
        "id": "openai/gpt-oss-120b",
        "label": "Groq GPT-OSS 120B",
        "key_attr": "groq_api_key",
    },
    {
        "provider": "gemini",
        "id": "gemini-3.6-flash",
        "label": "Gemini 3.6 Flash",
        "key_attr": "gemini_api_key",
    },
    {
        "provider": "cerebras",
        "id": "llama3.1-8b",
        "label": "Cerebras Llama 3.1 8B",
        "key_attr": "cerebras_api_key",
    },
    {
        "provider": "sambanova",
        "id": "Meta-Llama-3.3-70B-Instruct",
        "label": "SambaNova Llama 3.3 70B",
        "key_attr": "sambanova_api_key",
    },
    {
        "provider": "mistral",
        "id": "codestral-latest",
        "label": "Mistral Codestral",
        "key_attr": "mistral_api_key",
    },
    {
        "provider": "openrouter",
        "id": "openrouter/auto",
        "label": "OpenRouter Auto",
        "key_attr": "openrouter_api_key",
    },
)

KNOWN_PROVIDERS: frozenset[str] = frozenset(
    item["provider"] for item in PROVIDER_CATALOG
)


def list_available_models() -> list[dict[str, Any]]:
    """Return Auto + models whose API keys are configured (no secrets leaked)."""
    rows: list[dict[str, Any]] = [
        {
            "provider": "auto",
            "id": "auto",
            "label": "Auto (SDLC routing)",
        }
    ]
    for item in PROVIDER_CATALOG:
        key = getattr(settings, item["key_attr"], "") or ""
        if not str(key).strip():
            continue
        rows.append(
            {
                "provider": item["provider"],
                "id": item["id"],
                "label": item["label"],
            }
        )
    return rows
