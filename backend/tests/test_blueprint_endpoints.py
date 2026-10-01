"""Tests for blueprint gap-closure features: routing reasons, admin gate,
knowledge aggregation, phase prompt preview, settings, audit and usage metrics."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from backend.app.api import deps
from backend.app.api.admin import read_audit_entries, summarize_usage
from backend.app.api.deps import CurrentUser, get_current_user, require_admin
from backend.app.api.knowledge import aggregate_documents, document_key, split_prompt_sections
from backend.app.api.me import UserSettings, coerce_settings
from backend.app.prompts.sdlc_prompts import build_elite_system_prompt
from backend.app.schemas.chat import ChatRequest, RouteReason, SdlcPhase, TargetClient
from backend.app.services import ingest_jobs
from backend.app.services.privacy_router import route_prompt
from backend.app.services.token_tracker import (
    estimate_token_usage,
    log_token_usage,
    read_usage_records,
)


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


# --- Privacy router reasons -------------------------------------------------


def test_route_reason_force_confidential(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.app.services.privacy_router.settings.force_local_mock", False)
    decision = _run(
        route_prompt(ChatRequest(prompt="hi", sdlc_phase=SdlcPhase.ARCHITECTURE, force_confidential=True))
    )
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.FORCE_CONFIDENTIAL


def test_route_reason_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.app.services.privacy_router.settings.force_local_mock", False)
    decision = _run(
        route_prompt(
            ChatRequest(prompt="key sk-proj-abcdefghijklmnop", sdlc_phase=SdlcPhase.ARCHITECTURE)
        )
    )
    assert decision.route_reason == RouteReason.SECRETS_DETECTED
    assert decision.detected_secrets


def test_route_reason_classifier_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.app.services.privacy_router.settings.force_local_mock", False)
    monkeypatch.setattr("backend.app.services.privacy_router.settings.cerebras_api_key", "")
    decision = _run(route_prompt(ChatRequest(prompt="hello", sdlc_phase=SdlcPhase.ARCHITECTURE)))
    assert decision.target_client == TargetClient.LOCAL_STUB
    assert decision.route_reason == RouteReason.CLASSIFIER_UNAVAILABLE


# --- Admin gate --------------------------------------------------------------


def _creds() -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials="token")


def test_user_metadata_admin_is_not_platform_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"sub": str(uuid4()), "user_metadata": {"role": "admin"}, "app_metadata": {}}
    monkeypatch.setattr(deps, "decode_supabase_jwt", lambda _token: payload)
    user = _run(get_current_user(_creds()))
    assert user.role == "admin"
    assert user.is_platform_admin is False
    with pytest.raises(HTTPException) as exc:
        _run(require_admin(user))
    assert exc.value.status_code == 403


def test_app_metadata_admin_is_platform_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"sub": str(uuid4()), "user_metadata": {}, "app_metadata": {"role": "admin"}}
    monkeypatch.setattr(deps, "decode_supabase_jwt", lambda _token: payload)
    user = _run(get_current_user(_creds()))
    assert user.is_platform_admin is True
    assert _run(require_admin(user)) is user


# --- Knowledge ---------------------------------------------------------------


def test_document_key_prefers_name_then_basename() -> None:
    assert document_key({"name": "docs/spec.md", "source": "/tmp/x.md"}) == "docs/spec.md"
    assert document_key({"source": "C:\\tmp\\abc.pdf"}) == "abc.pdf"
    assert document_key({}) is None
    assert document_key(None) is None


def test_aggregate_documents_groups_and_counts() -> None:
    rows = [
        {"metadata": {"name": "a.md", "file_type": "markdown", "sdlc_phase": 1}, "created_at": "2026-01-01"},
        {"metadata": {"name": "a.md", "file_type": "markdown", "sdlc_phase": 1}, "created_at": "2026-01-03"},
        {"metadata": {"source": "/tmp/b.pdf", "sdlc_phase": "2"}, "created_at": "2026-01-02"},
        {"metadata": {}, "created_at": "2026-01-02"},
    ]
    docs = aggregate_documents(rows)
    assert [d.name for d in docs] == ["a.md", "b.pdf"]
    assert docs[0].chunks == 2
    assert docs[0].first_indexed_at == "2026-01-01"
    assert docs[0].last_indexed_at == "2026-01-03"
    assert docs[1].sdlc_phase == 2


def test_split_prompt_sections_matches_elite_prompt() -> None:
    prompt = build_elite_system_prompt(3, project_name="Demo", stack=["FastAPI"])
    sections = split_prompt_sections(prompt)
    assert "Architect" in sections.role
    assert "Demo" in sections.context
    assert sections.objective
    assert "OWASP" in sections.constraints
    assert sections.output_format
    assert "[CONTEXTE]" not in sections.role


# --- Settings ------------------------------------------------------------------


def test_coerce_settings_keeps_valid_and_resets_invalid() -> None:
    settings = coerce_settings({"appearance": "light", "density": "huge", "default_sdlc_phase": 5})
    assert settings.appearance == "light"
    assert settings.density == "comfortable"
    assert settings.default_sdlc_phase == 5
    assert coerce_settings("garbage") == UserSettings()


# --- Audit & usage -------------------------------------------------------------


def test_read_audit_entries_newest_first_with_filter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.log"
    lines = [
        {"timestamp": "t1", "action": "fs.write", "user_id": "u1", "endpoint": "/a"},
        {"timestamp": "t2", "action": "workspace.delete", "user_id": "u2", "endpoint": "/b"},
        {"timestamp": "t3", "action": "fs.write", "user_id": "u2", "endpoint": "/c"},
    ]
    log.write_text("\n".join(json.dumps(line) for line in lines) + "\nnot-json\n", encoding="utf-8")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(log))
    entries, scanned, available = read_audit_entries(limit=10, action="fs.write")
    assert available is True
    assert scanned == 4
    assert [e.timestamp for e in entries] == ["t3", "t1"]


def test_usage_records_persist_and_summarize() -> None:
    usage = estimate_token_usage(provider="groq", model="m", prompt_text="a" * 40, completion_text="b" * 80)
    log_token_usage(usage, sdlc_phase=6, target_client="CLOUD_API", latency_ms=100, attempts=1,
                    quality_score=8, quality_passed=True, route_reason="cloud_allowed")
    log_token_usage(usage, sdlc_phase=6, target_client="LOCAL_STUB", latency_ms=300, attempts=2,
                    quality_score=5, quality_passed=False, route_reason="secrets_detected")
    records = read_usage_records()
    assert len(records) == 2
    assert "prompt" not in json.dumps(records).replace("prompt_tokens", "")
    summary = summarize_usage(records)
    assert summary.requests == 2
    assert summary.local_share_pct == 50.0
    assert summary.quality_pass_rate_pct == 50.0
    assert summary.retry_rate_pct == 50.0
    assert summary.avg_latency_ms == 200.0
    assert summary.by_provider[0].key == "groq"
    assert summary.route_reasons == {"cloud_allowed": 1, "secrets_detected": 1}


def test_summarize_usage_empty() -> None:
    assert summarize_usage([]).requests == 0


# --- Ingest jobs -----------------------------------------------------------------


def test_ingest_job_scoped_to_owner_and_workspace() -> None:
    ingest_jobs.clear_jobs()
    ws, owner = uuid4(), uuid4()
    job = ingest_jobs.create_job(ws, owner)
    assert ingest_jobs.get_job(job.id, owner_id=owner, workspace_id=ws) is job
    assert ingest_jobs.get_job(job.id, owner_id=uuid4(), workspace_id=ws) is None
    ingest_jobs.finish_job(job)
    payload = job.to_dict()
    assert payload["status"] == "completed"
    assert payload["step"] == "ready"
    assert "owner_id" not in payload
    ingest_jobs.finish_job(job, error="boom")
    assert job.status == "failed"


def test_current_user_default_not_admin() -> None:
    assert CurrentUser(id=uuid4()).is_platform_admin is False
