"""Cloud LLM provider wrappers using OpenAI-compatible streaming APIs."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from backend.app.core.config import settings
from backend.app.services.llm_base import BaseLLMClient, build_chat_messages


class OpenAICompatibleClient(BaseLLMClient):
    """Shared SSE streaming client for OpenAI-compatible chat completions."""

    provider_name: str = "openai_compatible"
    default_base_url: str = ""
    default_model: str = ""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        self.api_key = api_key or ""
        self.model = model or self.default_model
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.timeout = timeout or httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)

    async def generate_stream(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        model: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[str]:
        if not self.api_key:
            yield f"[{self.provider_name} error: missing API key]"
            return

        selected_model = model or self.model
        payload = {
            "model": selected_model,
            "messages": build_chat_messages(prompt, system_prompt, history=history),
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        url = f"{self.base_url}/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code == 402:
                        await response.aread()
                        raise httpx.HTTPStatusError(
                            f"HTTP 402 Payment Required from {self.provider_name}",
                            request=response.request,
                            response=response,
                        )
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        yield _http_error_token(self.provider_name, response.status_code, body)
                        return

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        if data == "[DONE]":
                            break
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = event.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        content = delta.get("content")
                        if content:
                            yield content
        except httpx.TimeoutException:
            yield f"[{self.provider_name} error: request timed out]"
        except httpx.HTTPStatusError:
            raise
        except httpx.HTTPError as exc:
            yield f"[{self.provider_name} error: {exc.__class__.__name__}]"


def _http_error_token(provider: str, status_code: int, body: str) -> str:
    """Build a short error token without leaking secrets."""
    snippet = " ".join(body.split())[:180]
    return f"[{provider} error: HTTP {status_code} {snippet}]".strip()


class GroqClient(OpenAICompatibleClient):
    provider_name = "groq"
    default_base_url = "https://api.groq.com/openai/v1"
    # Groq retired llama-3.3-70b-versatile (404) for free/dev tiers Aug 2026.
    default_model = "openai/gpt-oss-120b"
    _DEPRECATED_MODELS = {
        "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
        "llama-3.1-8b-instant": "openai/gpt-oss-20b",
        "llama3-70b-8192": "openai/gpt-oss-120b",
        "llama3-8b-8192": "openai/gpt-oss-20b",
    }

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        mapped = self._DEPRECATED_MODELS.get(model or "", model)
        super().__init__(
            api_key=api_key if api_key is not None else settings.groq_api_key,
            model=mapped,
            base_url=base_url,
            timeout=timeout,
        )


class GeminiClient(BaseLLMClient):
    """Google Gemini via native Generative Language SSE API."""

    provider_name = "gemini"
    default_model = "gemini-3.6-flash"
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.gemini_api_key
        self.model = model or self.default_model
        self.base_url = (base_url or self.default_base_url).rstrip("/")
        self.timeout = timeout or httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)

    async def generate_stream(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        model: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncIterator[str]:
        if not self.api_key:
            yield f"[{self.provider_name} error: missing API key]"
            return

        selected_model = model or self.model
        contents: list[dict] = []
        for turn in history or []:
            role = turn.get("role")
            text = turn.get("content") or ""
            if role == "user":
                contents.append({"role": "user", "parts": [{"text": text}]})
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": text}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        payload: dict = {"contents": contents}
        if system_prompt:
            payload["system_instruction"] = {"parts": [{"text": system_prompt}]}

        url = f"{self.base_url}/models/{selected_model}:streamGenerateContent?alt=sse"
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "x-goog-api-key": self.api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code == 402:
                        await response.aread()
                        raise httpx.HTTPStatusError(
                            f"HTTP 402 Payment Required from {self.provider_name}",
                            request=response.request,
                            response=response,
                        )
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        # Never echo the API key if Google embeds it in the error URL.
                        body = body.replace(self.api_key, "***")
                        yield _http_error_token(self.provider_name, response.status_code, body)
                        return

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        for candidate in event.get("candidates") or []:
                            content = candidate.get("content") or {}
                            for part in content.get("parts") or []:
                                text = part.get("text")
                                if text:
                                    yield text
        except httpx.TimeoutException:
            yield f"[{self.provider_name} error: request timed out]"
        except httpx.HTTPStatusError:
            raise
        except httpx.HTTPError as exc:
            yield f"[{self.provider_name} error: {exc.__class__.__name__}]"


class CerebrasClient(OpenAICompatibleClient):
    provider_name = "cerebras"
    default_base_url = "https://api.cerebras.ai/v1"
    default_model = "llama3.1-8b"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key if api_key is not None else settings.cerebras_api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
        )


class SambaNovaClient(OpenAICompatibleClient):
    provider_name = "sambanova"
    default_base_url = "https://api.sambanova.ai/v1"
    default_model = "Meta-Llama-3.3-70B-Instruct"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key if api_key is not None else settings.sambanova_api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
        )


class MistralClient(OpenAICompatibleClient):
    provider_name = "mistral"
    default_base_url = "https://api.mistral.ai/v1"
    default_model = "codestral-latest"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        super().__init__(
            api_key=api_key if api_key is not None else settings.mistral_api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
        )
