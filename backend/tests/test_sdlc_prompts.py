"""Unit tests for FUZYO elite SDLC prompt builder + catalog."""

from __future__ import annotations

from backend.app.prompts.sdlc_catalog import SDLC_CATALOG, phase_export_title
from backend.app.prompts.sdlc_prompts import (
    ELITE_PROMPT_MARKERS,
    SDLC_PROMPTS,
    build_elite_system_prompt,
)


def test_catalog_has_nine_phases() -> None:
    assert sorted(SDLC_CATALOG.keys()) == list(range(1, 10))
    for phase, entry in SDLC_CATALOG.items():
        assert entry.id == phase
        assert entry.name
        assert entry.key_question
        assert entry.expected_deliverables
        assert entry.default_role
        assert entry.output_format


def test_build_elite_system_prompt_contains_five_markers() -> None:
    for phase in range(1, 10):
        prompt = build_elite_system_prompt(
            phase,
            project_name="Todo Master App",
            stack=["React", "JavaScript"],
        )
        assert prompt
        for marker in ELITE_PROMPT_MARKERS:
            assert marker in prompt, f"phase {phase} missing {marker}"
        assert "Todo Master App" in prompt
        assert "React" in prompt
        assert SDLC_CATALOG[phase].expected_deliverables[0] in prompt


def test_sdlc_prompts_map_matches_builder_defaults() -> None:
    assert sorted(SDLC_PROMPTS.keys()) == list(range(1, 10))
    for phase in range(1, 10):
        assert SDLC_PROMPTS[phase] == build_elite_system_prompt(phase)
        for marker in ELITE_PROMPT_MARKERS:
            assert marker in SDLC_PROMPTS[phase]


def test_phase_export_titles() -> None:
    assert "CDC" in phase_export_title(1)
    assert phase_export_title(5) == "Développement"
    assert phase_export_title(99).startswith("Phase ")
