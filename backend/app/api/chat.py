"""SSE chat completions endpoint."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any, Final
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.app.api.deps import CurrentUser, ensure_owned_workspace, get_current_user
from backend.app.core.config import settings
from backend.app.core.logging_config import get_logger
from backend.app.core.rate_limit import limiter
from backend.app.core.sentry_setup import capture_sse_exception
from backend.app.prompts.sdlc_prompts import build_elite_system_prompt
from backend.app.prompts.skill_prompts import (
    SKILL_SYSTEM_PROMPTS,
    apply_skill_prefix,
    detect_skill_from_prompt,
    skill_rag_query,
)
from backend.app.schemas.chat import ChatRequest, RouterDecision, SkillMode, TargetClient
from backend.app.services.agent_runner import intercept_admin_tools
from backend.app.services.chat_orchestrator import (
    fetch_thread_history,
    touch_thread_updated_at,
)
from backend.app.services.cloud_providers import (
    CerebrasClient,
    GeminiClient,
    GroqClient,
    MistralClient,
    OpenAICompatibleClient,
    SambaNovaClient,
)
from backend.app.services.gatekeeper import evaluate_response
from backend.app.services.llm_base import BaseLLMClient
from backend.app.services.local_stub import MockLocalLLMClient
from backend.app.services.privacy_router import route_prompt
from backend.app.services.rag_service import search_workspace
from backend.app.services.token_tracker import estimate_token_usage, log_token_usage
from supabase import create_client

router = APIRouter(tags=["chat"])
_log = get_logger("fuzyo.chat")

_MAX_RETRY_ATTEMPTS: Final[int] = 3

_RATE_LIMIT_RE = re.compile(r"HTTP\s*429|rate[\s_-]?limit", re.IGNORECASE)
_PAYMENT_REQUIRED_RE = re.compile(
    r"HTTP\s*402|Payment Required|more credits|can only afford",
    re.IGNORECASE,
)
# Structured provider error tokens only — never match free-form assistant prose.
_PROVIDER_ERROR_TOKEN_RE = re.compile(r"^\[(?P<provider>[^\]]+?) error: HTTP (?P<code>\d{3})\b")
_FALLBACK_HTTP_CODES = frozenset({404, 429, 502, 503})

_BILLING_NOTICE = (
    "> **Billing notice:** Cloud provider returned HTTP 402 (payment/credits). "
    "Switched to local mock execution.\n\n"
)

_PROVIDER_CLIENTS: dict[str, type[BaseLLMClient]] = {
    "groq": GroqClient,
    "gemini": GeminiClient,
    "cerebras": CerebrasClient,
    "sambanova": SambaNovaClient,
    "mistral": MistralClient,
}


class OpenRouterClient(OpenAICompatibleClient):
    provider_name = "openrouter"
    default_base_url = "https://openrouter.ai/api/v1"
    default_model = "openrouter/auto"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        timeout: Any = None,
    ) -> None:
        super().__init__(
            api_key=api_key if api_key is not None else settings.openrouter_api_key,
            model=model,
            base_url=base_url,
            timeout=timeout,
        )


# Registered after class definition so OpenRouter is a first-class override target.
_PROVIDER_CLIENTS["openrouter"] = OpenRouterClient


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _resolve_client(decision: RouterDecision) -> BaseLLMClient:
    if decision.target_client == TargetClient.LOCAL_STUB:
        return MockLocalLLMClient()
    client_cls = _PROVIDER_CLIENTS.get(decision.selected_provider)
    if client_cls is None:
        return MockLocalLLMClient()
    return client_cls(model=decision.selected_model)


def _is_rate_limit_token(token: str) -> bool:
    """True only for structured provider error tokens that mention rate limits."""
    if not _PROVIDER_ERROR_TOKEN_RE.match(token or ""):
        return False
    return bool(_RATE_LIMIT_RE.search(token))


def _is_payment_required_token(token: str) -> bool:
    """True only for structured `[provider error: HTTP 402 …]` tokens."""
    if not _PROVIDER_ERROR_TOKEN_RE.match(token or ""):
        return False
    return bool(_PAYMENT_REQUIRED_RE.search(token))


def _is_fallback_error_token(token: str) -> bool:
    """404 / 429 / 502 / 503 from a structured `[provider error: HTTP NNN …]` token."""
    match = _PROVIDER_ERROR_TOKEN_RE.match(token or "")
    if not match:
        return False
    code = int(match.group("code"))
    return code in _FALLBACK_HTTP_CODES or _is_rate_limit_token(token)


def _is_payment_required_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        if response is not None and response.status_code == 402:
            return True
    return _is_payment_required_token(str(exc))


def _close_open_fence_suffix(text: str) -> str:
    """Close an unclosed Markdown fence so fallback content stays well-formed."""
    if text.count("```") % 2 == 1:
        return "\n```\n"
    return ""


async def _local_fallback_tokens(
    prior_text: str,
    user_prompt: str,
    system_prompt: str | None,
    history: list[dict[str, str]] | None = None,
) -> AsyncIterator[str]:
    """Yield fence closer (if needed), billing notice, then local mock tokens."""
    closer = _close_open_fence_suffix(prior_text)
    if closer:
        yield closer
    yield _BILLING_NOTICE
    local = MockLocalLLMClient()
    async for piece in local.generate_stream(
        user_prompt,
        system_prompt=system_prompt,
        model=None,
        history=history,
    ):
        yield piece


def _build_user_prompt(
    request: ChatRequest,
    rag_hits: list[dict[str, Any]],
    *,
    prompt_text: str | None = None,
) -> str:
    prompt = request.prompt if prompt_text is None else prompt_text
    if not rag_hits:
        return prompt
    snippets = []
    for index, hit in enumerate(rag_hits[:5], start=1):
        content = (hit.get("content") or "").strip()
        if content:
            snippets.append(f"[{index}] {content[:500]}")
    context = "\n\n".join(snippets)
    return (
        "Use the following workspace context when relevant.\n\n"
        f"{context}\n\n"
        f"User request:\n{prompt}"
    )


def _quality_sse(score: Any) -> str:
    return _sse(
        {
            "type": "quality",
            "is_valid": score.is_valid,
            "tier1_schema_pass": score.tier1_schema_pass,
            "tier2_heuristic_pass": score.tier2_heuristic_pass,
            "tier3_score": score.tier3_score,
            "feedback": score.feedback,
        }
    )


def _retry_user_prompt(
    original: str,
    score: Any,
    *,
    combined_feedback: str | None = None,
) -> str:
    feedback = (
        combined_feedback
        if combined_feedback is not None
        else ((score.feedback or "").strip() or "Quality gate failed; regenerate a complete answer.")
    )
    if not str(feedback).strip():
        feedback = "Quality gate failed; regenerate a complete answer."
    return (
        "[QUALITY FEEDBACK — RETRY REQUIRED]\n"
        f"tier3_score={score.tier3_score}\n"
        f"is_valid={score.is_valid}\n"
        f"feedback:\n{feedback}\n\n"
        "---\n"
        "Original request:\n"
        f"{original}"
    )


async def _event_stream(
    request: ChatRequest,
    workspace: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    decision = await route_prompt(request)
    yield _sse(
        {
            "type": "routing",
            "target_client": decision.target_client.value,
            "selected_provider": decision.selected_provider,
            "selected_model": decision.selected_model,
            "sensitivity_score": decision.sensitivity_score,
            "detected_secrets": decision.detected_secrets,
            "requires_rag": decision.requires_rag,
        }
    )

    # Skill detect/clean before RAG so embeddings never see raw /review|/debug prefixes.
    active_skill = request.skill
    if active_skill == SkillMode.NONE:
        active_skill = detect_skill_from_prompt(request.prompt)
    cleaned_prompt = apply_skill_prefix(active_skill, request.prompt)
    rag_query = skill_rag_query(active_skill, cleaned_prompt)

    rag_hits: list[dict[str, Any]] = []
    if decision.requires_rag and request.workspace_id:
        rag_source = "hybrid_supabase"
        try:
            rag_result = await search_workspace(request.workspace_id, rag_query)
            rag_hits = rag_result.hits
            rag_source = rag_result.source
            status = rag_result.status
        except Exception:  # noqa: BLE001
            status = "error"
            rag_hits = []
            rag_source = "fallback_bm25"
        yield _sse(
            {
                "type": "rag",
                "status": status,
                "source": rag_source,
                "hit_count": len(rag_hits),
                "query": rag_query,
                "snippets": [
                    (hit.get("content") or "")[:160]
                    for hit in rag_hits[:3]
                    if hit.get("content")
                ],
            }
        )
    else:
        yield _sse(
            {
                "type": "rag",
                "status": "skipped",
                "source": "none",
                "hit_count": 0,
                "query": rag_query,
                "snippets": [],
            }
        )

    ws = workspace or {}
    tech_stack = ws.get("tech_stack")
    if not isinstance(tech_stack, list):
        tech_stack = None
    system_prompt = build_elite_system_prompt(
        int(request.sdlc_phase),
        project_name=str(ws.get("name") or "") or None,
        stack=tech_stack,
    )
    user_prompt = _build_user_prompt(request, rag_hits, prompt_text=cleaned_prompt)

    if active_skill != SkillMode.NONE:
        addendum = SKILL_SYSTEM_PROMPTS.get(active_skill, "")
        if addendum:
            system_prompt = f"{system_prompt}\n\n{addendum}"
        yield _sse({"type": "skill", "mode": active_skill.value})

    history: list[dict[str, str]] = []
    if request.thread_id and request.workspace_id:
        history = fetch_thread_history(
            request.workspace_id,
            request.thread_id,
            int(request.history_window),
        )
        touch_thread_updated_at(request.thread_id)

    client = _resolve_client(decision)

    full_text_parts: list[str] = []
    completion_texts: list[str] = []
    used_openrouter = False
    used_local_billing_fallback = False

    async def _stream_from(
        active: BaseLLMClient,
        prompt: str,
    ) -> AsyncIterator[str]:
        async for piece in active.generate_stream(
            prompt,
            system_prompt=system_prompt or None,
            model=decision.selected_model,
            history=history,
        ):
            yield piece

    async def _emit_local_billing_fallback(
        prompt: str,
        parts: list[str],
    ) -> AsyncIterator[str]:
        nonlocal used_local_billing_fallback
        used_local_billing_fallback = True
        prior = "".join(parts)
        async for piece in _local_fallback_tokens(
            prior,
            prompt,
            system_prompt or None,
            history=history,
        ):
            parts.append(piece)
            yield _sse({"type": "token", "content": piece})

    async def _run_model_stream(
        prompt: str,
        *,
        parts: list[str],
        active_client: BaseLLMClient | None = None,
    ) -> AsyncIterator[str]:
        nonlocal used_openrouter
        stream_client = active_client if active_client is not None else client
        try:
            async for token in _stream_from(stream_client, prompt):
                if (
                    not used_openrouter
                    and not used_local_billing_fallback
                    and decision.target_client == TargetClient.CLOUD_API
                    and _is_payment_required_token(token)
                ):
                    async for event in _emit_local_billing_fallback(prompt, parts):
                        yield event
                    break

                if (
                    not used_openrouter
                    and not used_local_billing_fallback
                    and decision.target_client == TargetClient.CLOUD_API
                    and decision.selected_provider != "openrouter"
                    and _is_fallback_error_token(token)
                ):
                    used_openrouter = True
                    fallback = OpenRouterClient(model="openrouter/auto")
                    try:
                        async for fb_token in _stream_from(fallback, prompt):
                            if _is_payment_required_token(fb_token):
                                async for event in _emit_local_billing_fallback(
                                    prompt, parts
                                ):
                                    yield event
                                break
                            if _PROVIDER_ERROR_TOKEN_RE.match(fb_token or ""):
                                parts.append(fb_token)
                                yield _sse({"type": "token", "content": fb_token})
                                break
                            parts.append(fb_token)
                            yield _sse({"type": "token", "content": fb_token})
                    except httpx.HTTPStatusError as exc:
                        if _is_payment_required_error(exc):
                            async for event in _emit_local_billing_fallback(
                                prompt, parts
                            ):
                                yield event
                        else:
                            raise
                    break

                parts.append(token)
                yield _sse({"type": "token", "content": token})
        except httpx.HTTPStatusError as exc:
            if _is_payment_required_error(exc) and not used_local_billing_fallback:
                async for event in _emit_local_billing_fallback(prompt, parts):
                    yield event
            else:
                raise

    async for event in _run_model_stream(user_prompt, parts=full_text_parts):
        yield event

    full_text = "".join(full_text_parts)
    completion_texts.append(full_text)
    score = await evaluate_response(full_text, sdlc_phase=int(request.sdlc_phase))
    yield _quality_sse(score)

    attempt = 1
    accumulated_feedback: list[str] = []
    if score.feedback:
        accumulated_feedback.append(f"[attempt {attempt}] {score.feedback}")

    while (
        (not score.is_valid or score.tier3_score < 7)
        and attempt < _MAX_RETRY_ATTEMPTS
    ):
        attempt += 1
        reason = (score.feedback or "Quality gate failed")[:200]
        yield _sse(
            {
                "type": "retry",
                "attempt": attempt,
                "reason": reason,
                "attempt_score": score.tier3_score,
            }
        )

        combined_feedback = (
            "\n".join(accumulated_feedback) if accumulated_feedback else reason
        )
        retry_prompt = _retry_user_prompt(
            user_prompt,
            score,
            combined_feedback=combined_feedback,
        )
        retry_parts: list[str] = []
        retry_client: BaseLLMClient = (
            MockLocalLLMClient()
            if (used_local_billing_fallback or used_openrouter)
            else client
        )

        async for event in _run_model_stream(
            retry_prompt,
            parts=retry_parts,
            active_client=retry_client,
        ):
            yield event

        retry_text = "".join(retry_parts)
        completion_texts.append(retry_text)
        score = await evaluate_response(
            retry_text, sdlc_phase=int(request.sdlc_phase)
        )
        yield _quality_sse(score)

        if score.feedback:
            accumulated_feedback.append(f"[attempt {attempt}] {score.feedback}")

    # Token / cost accounting — character lengths only; never log prompt bodies.
    prompt_for_count = f"{system_prompt}\n{user_prompt}"
    usage = estimate_token_usage(
        provider=decision.selected_provider,
        model=decision.selected_model,
        prompt_text=prompt_for_count,
        completion_text="".join(completion_texts),
    )
    log_token_usage(
        usage,
        sdlc_phase=int(request.sdlc_phase),
        target_client=decision.target_client.value,
        force_confidential=bool(request.force_confidential),
    )
    _log.info(
        "chat_stream_complete",
        provider=decision.selected_provider,
        model=decision.selected_model,
        sdlc_phase=int(request.sdlc_phase),
        prompt_chars=len(prompt_for_count),
        completion_chars=sum(len(chunk) for chunk in completion_texts),
        force_confidential=bool(request.force_confidential),
    )


async def _admin_restricted_stream(tool: str) -> AsyncIterator[str]:
    notice = (
        f"This action (`{tool}`) requires an Admin role. "
        "Your request was blocked before model or tool execution."
    )
    yield _sse(
        {
            "type": "admin_restricted",
            "tool": tool,
            "message": notice,
        }
    )
    yield _sse({"type": "token", "content": notice})
    yield _sse(
        {
            "type": "quality",
            "is_valid": True,
            "tier1_schema_pass": True,
            "tier2_heuristic_pass": True,
            "tier3_score": 1.0,
            "feedback": "admin_restricted",
        }
    )


@router.post("/chat/completions")
@limiter.limit("20/minute")
async def chat_completions(
    request: Request,
    payload: ChatRequest,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> StreamingResponse:
    """SSE chat; rate-limited before streaming starts (20/min per client)."""
    workspace_row: dict[str, Any] | None = None
    if payload.workspace_id is not None:
        url = (settings.supabase_url or "").strip()
        key = (settings.supabase_secret_key or "").strip()
        if not url or not key:
            raise HTTPException(status_code=503, detail="Supabase not configured")
        try:
            client = create_client(url, key)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=503, detail=f"Supabase client error: {exc}"
            ) from exc
        workspace_row = ensure_owned_workspace(
            client, UUID(str(payload.workspace_id)), user.id
        )

    blocked_tool = intercept_admin_tools(payload.prompt, user.role)
    if blocked_tool:
        return StreamingResponse(
            _admin_restricted_stream(blocked_tool),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return StreamingResponse(
        _guarded_event_stream(payload, workspace_row),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _guarded_event_stream(
    request: ChatRequest,
    workspace: dict[str, Any] | None = None,
) -> AsyncIterator[str]:
    """Wrap SSE generation so mid-stream failures are captured, not fatal to Uvicorn."""
    try:
        async for event in _event_stream(request, workspace):
            yield event
    except Exception as exc:  # noqa: BLE001
        capture_sse_exception(
            exc,
            sdlc_phase=int(request.sdlc_phase),
            force_confidential=bool(request.force_confidential),
            workspace_id=str(request.workspace_id) if request.workspace_id else None,
        )
        yield _sse(
            {
                "type": "token",
                "content": (
                    "[internal stream error] The request failed mid-stream. "
                    "Operators have been notified."
                ),
            }
        )
        yield _sse(
            {
                "type": "quality",
                "is_valid": False,
                "tier1_schema_pass": False,
                "tier2_heuristic_pass": False,
                "tier3_score": 1,
                "feedback": "stream_error",
            }
        )
