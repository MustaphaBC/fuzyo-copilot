"""Local mock LLM client for confidential / offline execution."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from backend.app.services.llm_base import BaseLLMClient


class MockLocalLLMClient(BaseLLMClient):
    """Simulates token streaming without external network calls."""

    def __init__(self, delay_seconds: float = 0.02) -> None:
        self._delay_seconds = delay_seconds

    async def generate_stream(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        model: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[str]:
        _ = system_prompt, model
        prior_users = [
            (turn.get("content") or "").strip()
            for turn in (history or [])
            if turn.get("role") == "user" and (turn.get("content") or "").strip()
        ]
        memory = ""
        if prior_users:
            # Echo prior user content so confidential multi-turn verify can assert recall.
            joined = " | ".join(prior_users[-3:])
            memory = f" Prior context: {joined}."

        reply = (
            "[LOCAL MOCK EXECUTION] "
            f"Received prompt ({len(prompt)} chars).{memory} "
            "This response was generated locally without cloud APIs."
        )
        tokens = reply.split(" ")
        for index, token in enumerate(tokens):
            chunk = token if index == len(tokens) - 1 else f"{token} "
            yield chunk
            await asyncio.sleep(self._delay_seconds)
