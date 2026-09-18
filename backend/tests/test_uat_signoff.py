"""Tests for UAT sign-off PVR PDF and content hashing."""

from __future__ import annotations

from backend.app.api.uat_signoff import compute_content_sha256
from backend.app.services.deliverable_exporter import (
    build_pvr_pdf,
    build_uat_sheet_markdown,
)


def test_compute_content_sha256_stable() -> None:
    payload = {
        "accepted": True,
        "deliverables": ["PVR", "UAT sheets"],
        "notes": "",
        "phase": 7,
        "phase_title": "Recette",
        "project_name": "Demo",
        "signed_at_utc": "2026-09-18T00:00:00Z",
        "validator_name": "Alice",
        "workspace_id": "00000000-0000-0000-0000-000000000001",
    }
    first = compute_content_sha256(payload)
    second = compute_content_sha256(payload)
    assert first == second
    assert len(first) == 64


def test_build_pvr_pdf_magic_bytes() -> None:
    digest = "a" * 64
    pdf = build_pvr_pdf(
        project_name="Fuzyo Demo",
        phase=7,
        phase_title="Recette",
        deliverables=["Procès-Verbal de Recette", "Fiches UAT"],
        validator_name="Bob Validateur",
        signed_at_utc="2026-09-18T12:00:00Z",
        content_sha256=digest,
        notes="OK pour prod",
        accepted=True,
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 200


def test_build_uat_sheet_markdown_lists_deliverables() -> None:
    sheet = build_uat_sheet_markdown(
        project_name="Fuzyo Demo",
        phase=3,
        phase_title="Architecture",
        deliverables=["DAT", "OpenAPI"],
        validator_name="Carol",
        signed_at_utc="2026-09-18T12:00:00Z",
        content_sha256="b" * 64,
        notes="Mermaid validé",
    )
    assert "# Fiche de tests UAT" in sheet
    assert "DAT" in sheet
    assert "OpenAPI" in sheet
    assert "Carol" in sheet
    assert "UAT-01" in sheet
