"""Abstract streaming LLM client interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class BaseLLMClient(ABC):
    """Unified interface for local and cloud LLM providers.

    Implementations must return an async generator that yields string tokens.
    """

    @abstractmethod
    async def generate_stream(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        model: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[str]:
        """Stream response tokens for the given prompt.

        Yields:
            Successive string tokens from the model response.
        """
        ...


def build_chat_messages(
    prompt: str,
    system_prompt: str | None = None,
    history: list[dict[str, str]] | None = None,
) -> list[dict[str, str]]:
    """Build an OpenAI-style chat message list with optional prior turns.

    System prompt (when present) is always index 0. Prior user/assistant
    turns follow, then the current user prompt.
    """
    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for turn in history or []:
        role = turn.get("role")
        if role not in ("user", "assistant"):
            continue
        messages.append({"role": role, "content": turn.get("content") or ""})
    messages.append({"role": "user", "content": prompt})
    return messages
