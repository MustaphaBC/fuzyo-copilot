"""Skill-mode system addenda and slash-prefix helpers (/plan|/analyze|/review|/debug)."""

from __future__ import annotations

import re
from types import MappingProxyType
from typing import Mapping

from backend.app.schemas.chat import SkillMode

_SKILL_PREFIX_RE = re.compile(
    r"^\s*/(?P<skill>plan|analyze|review|debug)(?:\s+|\s*\n+\s*|$)",
    re.IGNORECASE,
)

SKILL_SYSTEM_PROMPTS: Mapping[SkillMode, str] = MappingProxyType(
    {
        SkillMode.PLAN: """
[SKILL: /plan]
You are in PLAN mode. Produce actionable planning artifacts only.
Required structure (Markdown):
1. ## Roadmap — phased milestones with outcomes
2. ## Backlog — table: ID | Title | Priority | Estimate | Dependencies
3. ## Sprint slice — next 1–2 sprints (concrete stories)
4. ## Risks — table: Risk | Impact | Mitigation
5. ## Mermaid — one ```mermaid flowchart of delivery sequence
No conversational filler. Prefer tables over prose.
""".strip(),
        SkillMode.ANALYZE: """
[SKILL: /analyze]
You are in ANALYZE mode. Assess gaps, feasibility, and impact.
Required structure (Markdown):
1. ## Summary — 3–5 bullets
2. ## Gap analysis — table: Area | Current | Gap | Severity
3. ## Feasibility — table: Option | Effort | Risk | Recommendation
4. ## Impact — table: Stakeholder | Impact | Notes
5. ## Recommendations — prioritized numbered list
Be evidence-based; call out unknowns explicitly. No filler.
""".strip(),
        SkillMode.REVIEW: """
[SKILL: /review]
You are in REVIEW mode. Critique code/design for defects and security.
Required structure (Markdown):
1. ## Issues — table: ID | Severity | Location | Finding | Fix
2. ## OWASP / security — checklist of relevant checks (pass/fail/n-a)
3. ## Quality notes — maintainability, typing, error handling
4. ## Verdict — Approve | Approve with changes | Request changes
Focus on concrete findings. Prefer complete fix snippets over vague advice.
""".strip(),
        SkillMode.DEBUG: """
[SKILL: /debug]
You are in DEBUG mode. Diagnose failures and propose a verified fix.
Required structure (Markdown):
1. ## Root cause — most likely cause with evidence
2. ## Annotated stack / symptoms — quote relevant lines
3. ## Fix — complete corrected code or config in fenced blocks
4. ## Prevention — how to avoid recurrence (tests, guards, logging)
Do not leave TODOs or empty stubs in the fix.
""".strip(),
    }
)


def detect_skill_from_prompt(prompt: str) -> SkillMode:
    """Return skill mode if prompt starts with a known slash prefix."""
    match = _SKILL_PREFIX_RE.match(prompt or "")
    if not match:
        return SkillMode.NONE
    return SkillMode(match.group("skill").lower())


def apply_skill_prefix(skill: SkillMode, prompt: str) -> str:
    """Strip leading /plan|/analyze|/review|/debug (and following ws/newlines)."""
    text = prompt or ""
    if skill == SkillMode.NONE:
        return text
    match = _SKILL_PREFIX_RE.match(text)
    if not match:
        return text
    return text[match.end() :].lstrip()


_SKILL_RAG_HINTS: dict[SkillMode, str] = {
    SkillMode.PLAN: "planning roadmap: ",
    SkillMode.ANALYZE: "gap analysis: ",
    SkillMode.REVIEW: "code review: ",
    SkillMode.DEBUG: "error debug: ",
}


def skill_rag_query(skill: SkillMode, cleaned_prompt: str) -> str:
    """Return the RAG query string for the given skill and cleaned prompt.

    Prepends a retrieval-intent hint for PLAN, ANALYZE, REVIEW, and DEBUG.
    Returns cleaned_prompt unchanged for NONE.
    """
    hint = _SKILL_RAG_HINTS.get(skill, "")
    return (hint + cleaned_prompt) if hint else cleaned_prompt
