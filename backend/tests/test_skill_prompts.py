"""Tests for SkillMode schema + skill_prompts helpers."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.prompts.skill_prompts import (
    SKILL_SYSTEM_PROMPTS,
    apply_skill_prefix,
    detect_skill_from_prompt,
    skill_rag_query,
)
from backend.app.schemas.chat import ChatRequest, SkillMode, SdlcPhase


def test_chat_request_skill_plan_parses() -> None:
    req = ChatRequest(prompt="x", sdlc_phase=SdlcPhase.EXPRESSION_DU_BESOIN, skill="plan")
    assert req.skill == SkillMode.PLAN


def test_chat_request_unknown_skill_raises() -> None:
    with pytest.raises(ValidationError):
        ChatRequest(prompt="x", sdlc_phase=1, skill="hacker")


def test_chat_request_skill_defaults_to_none() -> None:
    req = ChatRequest(prompt="x", sdlc_phase=1)
    assert req.skill == SkillMode.NONE


def test_apply_skill_prefix_strips_plan() -> None:
    assert (
        apply_skill_prefix(SkillMode.PLAN, "/plan build a sprint backlog")
        == "build a sprint backlog"
    )


def test_apply_skill_prefix_strips_frontend_newline_form() -> None:
    assert (
        apply_skill_prefix(SkillMode.PLAN, "/plan\n\nbuild a sprint backlog")
        == "build a sprint backlog"
    )


def test_apply_skill_prefix_none_is_noop() -> None:
    assert apply_skill_prefix(SkillMode.NONE, "normal prompt") == "normal prompt"


def test_detect_skill_from_prompt() -> None:
    assert detect_skill_from_prompt("/debug AttributeError on line 42") == SkillMode.DEBUG
    assert detect_skill_from_prompt("regular question") == SkillMode.NONE
    assert detect_skill_from_prompt("/review\n\ndef foo(): pass") == SkillMode.REVIEW


def test_skill_system_prompts_non_empty() -> None:
    for mode in (SkillMode.PLAN, SkillMode.ANALYZE, SkillMode.REVIEW, SkillMode.DEBUG):
        assert mode in SKILL_SYSTEM_PROMPTS
        assert SKILL_SYSTEM_PROMPTS[mode].strip()


def test_skill_rag_query_plan_hint() -> None:
    assert (
        skill_rag_query(SkillMode.PLAN, "build a sprint backlog for auth module")
        == "planning roadmap: build a sprint backlog for auth module"
    )


def test_skill_rag_query_analyze_hint() -> None:
    assert (
        skill_rag_query(SkillMode.ANALYZE, "gap analysis on current architecture")
        == "gap analysis: gap analysis on current architecture"
    )


def test_skill_rag_query_review_hint() -> None:
    assert (
        skill_rag_query(SkillMode.REVIEW, "def foo(): pass")
        == "code review: def foo(): pass"
    )


def test_skill_rag_query_debug_hint() -> None:
    assert (
        skill_rag_query(SkillMode.DEBUG, "AttributeError on line 42")
        == "error debug: AttributeError on line 42"
    )


def test_skill_rag_query_none_unchanged() -> None:
    assert skill_rag_query(SkillMode.NONE, "any prompt") == "any prompt"
