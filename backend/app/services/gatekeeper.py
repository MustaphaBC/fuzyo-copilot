"""3-tier progressive quality gatekeeper (schema, heuristics, LLM judge)."""

from __future__ import annotations

import json
import re
from typing import Final

import httpx

from backend.app.core.config import settings
from backend.app.prompts.eval_prompts import JUDGE_SYSTEM_PROMPT
from backend.app.schemas.chat import QualityScore
from backend.app.services.llm_base import build_chat_messages

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL = "openai/gpt-oss-120b"
_PASS_THRESHOLD = 7

_TODO_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"\b(?:TODO|FIXME)(?:\s*:?\s*(?:implement|add code)?)?\b",
    re.IGNORECASE,
)
_EMPTY_DEF_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"(?m)^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?\s*:\s*(?:pass|\.\.\.)?\s*(?:#.*)?$",
)
_TRUNCATED_LINE_PATTERN: Final[re.Pattern[str]] = re.compile(r"(?m)^.*\\\s*$")
_FENCE_ELLIPSIS_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"```[\s\S]*?\n\s*\.\.\.\s*\n[\s\S]*?```"
)


def _tier1_schema_check(text: str) -> tuple[bool, str]:
    """Local Markdown/JSON structure validation (no network)."""
    fence_count = len(re.findall(r"(?m)^```", text))
    if fence_count % 2 != 0:
        return False, "Unclosed Markdown fenced code block detected."

    stripped = text.strip()
    # Validate JSON only for true JSON documents (not "[LOCAL ...]" / "[gemini error: ...]").
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            json.loads(stripped)
        except json.JSONDecodeError:
            return False, "Response looks like JSON but failed to parse."
    elif re.match(r"^\[\s*(?:[{\[\"]|\]|\d|true|false|null)", stripped) and stripped.endswith("]"):
        try:
            json.loads(stripped)
        except json.JSONDecodeError:
            return False, "Response looks like JSON but failed to parse."

    lines = text.splitlines()
    for index, line in enumerate(lines):
        if "|" in line and line.strip().startswith("|"):
            # Header-like row: require a separator row nearby
            window = lines[index + 1 : index + 3]
            if not any(re.search(r"\|?\s*-{3,}", row) for row in window):
                # Only flag when the row looks like a table header (2+ pipes)
                if line.count("|") >= 2 and not re.search(r"-{3,}", line):
                    return False, "Markdown table header missing separator row."
            break

    return True, ""


def _tier2_heuristic_check(text: str) -> tuple[bool, str]:
    """Local static heuristics for stubs, TODOs, and truncated code."""
    if _TODO_PATTERN.search(text):
        return False, "TODO/FIXME placeholder detected in response."

    if _EMPTY_DEF_PATTERN.search(text):
        return False, "Empty or pass-only function body detected."

    # Functions whose body is only a TODO-like token on the same/next line
    if re.search(
        r"def\s+\w+\s*\([^)]*\)\s*:\s*(?:TODO|FIXME|\.\.\.|pass)\b",
        text,
        re.IGNORECASE,
    ):
        return False, "Function body is a stub placeholder."

    if _TRUNCATED_LINE_PATTERN.search(text):
        return False, "Truncated line ending with backslash detected."

    if _FENCE_ELLIPSIS_PATTERN.search(text):
        return False, "Ellipsis stub inside a fenced code block detected."

    return True, ""


def _parse_judge_result(text: str) -> tuple[int, str]:
    """Parse tier3_score and feedback from judge output."""
    stripped = text.strip()
    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            score = int(payload.get("tier3_score", 1))
            feedback = str(payload.get("feedback", "")).strip()
            return max(1, min(10, score)), feedback
    except (json.JSONDecodeError, TypeError, ValueError):
        pass

    score_match = re.search(r"tier3_score['\"]?\s*[:=]\s*(\d{1,2})", stripped, re.I)
    feedback_match = re.search(
        r"feedback['\"]?\s*[:=]\s*['\"]?(.*?)(?:['\"]?\s*$|\n)",
        stripped,
        re.I | re.S,
    )
    score = int(score_match.group(1)) if score_match else 1
    score = max(1, min(10, score))
    feedback = feedback_match.group(1).strip() if feedback_match else stripped[:500]
    return score, feedback


async def _tier3_groq_judge(
    response: str,
    *,
    sdlc_phase: int | None,
    prior_feedback: str,
) -> tuple[int, str, bool]:
    """Call Groq judge; returns (score, feedback, is_valid)."""
    api_key = settings.groq_api_key
    if not api_key:
        feedback = prior_feedback or "Tier 3 judge unavailable: missing GROQ_API_KEY."
        feedback += " Retry with a complete response that removes TODOs/stubs and fixes structure."
        return 1, feedback, False

    user_content = response
    if sdlc_phase is not None:
        user_content = f"SDLC phase: {sdlc_phase}\n\nAssistant response to evaluate:\n{response}"
    if prior_feedback:
        user_content += f"\n\nLocal gatekeeper findings:\n{prior_feedback}"

    payload = {
        "model": _GROQ_MODEL,
        "messages": build_chat_messages(user_content, JUDGE_SYSTEM_PROMPT),
        "stream": False,
        "max_tokens": 256,
        "temperature": 0,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            http_response = await client.post(_GROQ_URL, headers=headers, json=payload)
            http_response.raise_for_status()
            data = http_response.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            score, feedback = _parse_judge_result(str(content))
            if score < _PASS_THRESHOLD:
                feedback = (
                    f"{feedback} Retry: regenerate a complete, phase-aligned answer "
                    "without TODOs, empty stubs, or broken Markdown/JSON."
                ).strip()
            return score, feedback, score >= _PASS_THRESHOLD
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        feedback = (
            f"{prior_feedback} Tier 3 judge failed ({exc.__class__.__name__}). "
            "Retry with a complete response that removes TODOs/stubs and fixes structure."
        ).strip()
        return 1, feedback, False


async def evaluate_response(
    response: str,
    *,
    sdlc_phase: int | None = None,
) -> QualityScore:
    """Run Tier 1 + Tier 2 locally; call Tier 3 Groq only when either fails."""
    tier1_pass, tier1_feedback = _tier1_schema_check(response)
    tier2_pass, tier2_feedback = _tier2_heuristic_check(response)

    local_notes = "; ".join(
        note for note in (tier1_feedback, tier2_feedback) if note
    )

    if tier1_pass and tier2_pass:
        return QualityScore(
            is_valid=True,
            tier1_schema_pass=True,
            tier2_heuristic_pass=True,
            tier3_score=10,
            feedback="",
        )

    tier3_score, feedback, is_valid = await _tier3_groq_judge(
        response,
        sdlc_phase=sdlc_phase,
        prior_feedback=local_notes,
    )
    return QualityScore(
        is_valid=is_valid,
        tier1_schema_pass=tier1_pass,
        tier2_heuristic_pass=tier2_pass,
        tier3_score=tier3_score,
        feedback=feedback,
    )
