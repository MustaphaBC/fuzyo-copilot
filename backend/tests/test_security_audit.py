"""Unit tests for audit trail and rate-limit helpers."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from starlette.responses import JSONResponse, Response

from backend.app.core.audit import (
    AuditFsMiddleware,
    append_audit_event,
    audit_log_path,
    should_audit_request,
    _action_for,
    _extract_file_path,
)
from backend.app.core.rate_limit import rate_limit_key
from backend.app.main import rate_limit_exceeded_handler


def test_should_audit_workspace_mutations() -> None:
    assert should_audit_request("PUT", "/api/v1/workspaces/abc/fs/file")
    assert should_audit_request("POST", "/api/v1/workspaces/abc/apply-changes")
    assert should_audit_request("POST", "/api/v1/workspaces")
    assert not should_audit_request("GET", "/api/v1/workspaces/abc/fs/file")
    assert not should_audit_request("POST", "/api/v1/chat/completions")
    assert not should_audit_request("POST", "/api/v1/workspaces/abc/threads")


def test_action_and_file_path_extraction() -> None:
    assert _action_for("PUT", "/api/v1/workspaces/x/fs/file") == "fs.write"
    assert _action_for("POST", "/api/v1/workspaces/x/apply-changes") == "fs.apply_changes"
    body = json.dumps({"path": "src/App.jsx", "content": "x"}).encode()
    assert _extract_file_path("/api/v1/workspaces/x/fs/file", body) == "src/App.jsx"
    apply_body = json.dumps(
        {"files": [{"relative_path": "src/a.py", "content": "1"}]}
    ).encode()
    assert "src/a.py" in _extract_file_path(
        "/api/v1/workspaces/x/apply-changes", apply_body
    )


def test_append_audit_event_writes_json_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log_file = tmp_path / "audit.log"
    monkeypatch.setenv("AUDIT_LOG_PATH", str(log_file))
    append_audit_event(
        user_id="user-1",
        client_ip="127.0.0.1",
        endpoint="/api/v1/workspaces/w/fs/file",
        action="fs.write",
        file_path="src/main.py",
    )
    assert log_file.is_file()
    line = log_file.read_text(encoding="utf-8").strip()
    record = json.loads(line)
    assert record["user_id"] == "user-1"
    assert record["client_ip"] == "127.0.0.1"
    assert record["endpoint"] == "/api/v1/workspaces/w/fs/file"
    assert record["action"] == "fs.write"
    assert record["file_path"] == "src/main.py"
    assert "timestamp" in record
    assert audit_log_path() == log_file.resolve()


def test_audit_middleware_logs_successful_put(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log_file = tmp_path / "audit.log"
    monkeypatch.setenv("AUDIT_LOG_PATH", str(log_file))

    app = FastAPI()

    @app.put("/api/v1/workspaces/{workspace_id}/fs/file")
    async def put_file(workspace_id: str, request: Request) -> dict[str, str]:
        body = await request.json()
        return {"path": body.get("path", "")}

    app.add_middleware(AuditFsMiddleware)
    client = TestClient(app)
    response = client.put(
        "/api/v1/workspaces/11111111-1111-1111-1111-111111111111/fs/file",
        json={"path": "docs/note.md", "content": "hello"},
    )
    assert response.status_code == 200
    assert log_file.is_file()
    record = json.loads(log_file.read_text(encoding="utf-8").strip())
    assert record["action"] == "fs.write"
    assert record["file_path"] == "docs/note.md"
    assert record["endpoint"].endswith("/fs/file")


def test_audit_middleware_skips_failed_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log_file = tmp_path / "audit.log"
    monkeypatch.setenv("AUDIT_LOG_PATH", str(log_file))

    app = FastAPI()

    @app.put("/api/v1/workspaces/{workspace_id}/fs/file")
    async def put_file(workspace_id: str) -> Response:
        return JSONResponse({"detail": "nope"}, status_code=400)

    app.add_middleware(AuditFsMiddleware)
    client = TestClient(app)
    response = client.put(
        "/api/v1/workspaces/11111111-1111-1111-1111-111111111111/fs/file",
        json={"path": "x.py", "content": ""},
    )
    assert response.status_code == 400
    assert not log_file.exists()


def test_rate_limit_key_prefers_bearer() -> None:
    req = MagicMock(spec=Request)
    req.headers = {"authorization": "Bearer FAKESECRET_g2h3i4j5k6l7m8n9o0p1.payload.sig"}
    key = rate_limit_key(req)
    assert key.startswith("bearer:")


def test_rate_limit_exceeded_handler_returns_json_retry_after() -> None:
    req = MagicMock(spec=Request)
    limit = MagicMock()
    limit.get_expiry = MagicMock(return_value=60)
    limit.error_message = None
    limit.limit = "20 per 1 minute"
    exc = MagicMock(spec=RateLimitExceeded)
    exc.limit = limit
    response = asyncio.run(rate_limit_exceeded_handler(req, exc))
    assert response.status_code == 429
    assert response.headers.get("Retry-After") == "60"
    body = json.loads(response.body.decode("utf-8"))
    assert "detail" in body
    assert body["retry_after"] == 60
