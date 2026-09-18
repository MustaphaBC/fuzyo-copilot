"""Lightweight tests for gatekeeper retry prompt helper and N-retry constants."""

from __future__ import annotations

from backend.app.api.chat import _MAX_RETRY_ATTEMPTS, _retry_user_prompt
from backend.app.schemas.chat import QualityScore


def test_max_retry_attempts_constant() -> None:
    assert _MAX_RETRY_ATTEMPTS == 3


def test_retry_user_prompt_contains_feedback_banner() -> None:
    score = QualityScore(
        is_valid=False,
        tier1_schema_pass=True,
        tier2_heuristic_pass=False,
        tier3_score=3,
        feedback="Function body is a stub placeholder.",
    )
    text = _retry_user_prompt("Write Python with only pass-body functions", score)
    assert "[QUALITY FEEDBACK — RETRY REQUIRED]" in text
    assert "tier3_score=3" in text
    assert "stub placeholder" in text
    assert "Write Python with only pass-body functions" in text


def test_retry_user_prompt_combined_feedback() -> None:
    score = QualityScore(
        is_valid=False,
        tier1_schema_pass=True,
        tier2_heuristic_pass=False,
        tier3_score=4,
        feedback="latest only",
    )
    combined = "[attempt 1] first fail\n[attempt 2] second fail"
    text = _retry_user_prompt("original", score, combined_feedback=combined)
    assert "[attempt 1] first fail" in text
    assert "[attempt 2] second fail" in text
    assert "latest only" not in text.split("feedback:\n", 1)[1].split("\n\n---", 1)[0]
