"""Tests for phase PDF export."""

from __future__ import annotations

from pathlib import Path

from backend.app.services.deliverable_exporter import build_phase_pdf, download_filename


def test_build_phase_pdf_magic_bytes() -> None:
    payload = build_phase_pdf("TestWS", 1, {}, root=None)
    assert payload.startswith(b"%PDF-")


def test_build_phase_pdf_includes_workspace_name(tmp_path: Path) -> None:
    docs = tmp_path / "docs" / "phase_3_architecture"
    docs.mkdir(parents=True)
    (docs / "notes.md").write_text("# Arch note\n\nHello PDF", encoding="utf-8")
    audit = {
        "scores": {"code_quality": 70},
        "phases": [
            {
                "id": 3,
                "name": "Architecture",
                "status": "in_progress",
                "pct": 40,
                "deliverables": ["docs/phase_3_architecture/notes.md"],
                "expected_deliverables": ["DAT"],
            }
        ],
    }
    payload = build_phase_pdf("TestWS", 3, audit, root=tmp_path)
    assert payload.startswith(b"%PDF-")
    assert b"TestWS" in payload


def test_build_phase_pdf_none_audit() -> None:
    payload = build_phase_pdf("TestWS", 2, None, root=None)
    assert payload.startswith(b"%PDF-")


def test_download_filename_pdf() -> None:
    assert download_filename("Acme App", 1, "pdf") == "Acme_App_phase_1.pdf"
