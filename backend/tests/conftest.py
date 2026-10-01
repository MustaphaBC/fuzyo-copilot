"""Shared pytest fixtures."""

from __future__ import annotations

import pytest

from backend.app.api.deps import clear_auth_caches
from backend.app.services.privacy_router import reset_classifier_circuit
from backend.app.services.provider_fallback import reset_provider_circuits


@pytest.fixture(autouse=True)
def _isolated_runtime_logs(tmp_path, monkeypatch):
    """Keep usage/audit JSONL writes out of the repo during tests."""
    monkeypatch.setenv("USAGE_LOG_PATH", str(tmp_path / "usage.log"))
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.log"))


@pytest.fixture(autouse=True)
def _fresh_auth_caches():
    """Token/ownership caches are process-global; isolate each test."""
    clear_auth_caches()
    yield
    clear_auth_caches()


@pytest.fixture(autouse=True)
def _offline_privacy_classifier(monkeypatch):
    """No real Groq fallback calls from a developer .env; fallback tests opt back in."""
    monkeypatch.setattr(
        "backend.app.services.privacy_router.settings.privacy_classifier_fallback_provider",
        "",
    )
    reset_classifier_circuit()
    reset_provider_circuits()
    yield
    reset_classifier_circuit()
    reset_provider_circuits()
