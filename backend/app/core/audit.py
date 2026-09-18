"""Append-only audit trail for host filesystem mutations."""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)

_MUTATING_METHODS = frozenset({"PUT", "POST", "PATCH", "DELETE"})
_WORKSPACE_PREFIX = "/api/v1/workspaces"


def audit_log_path() -> Path:
    """Resolve append-only audit log file (override with AUDIT_LOG_PATH)."""
    raw = (os.environ.get("AUDIT_LOG_PATH") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    # backend/app/core/audit.py → repo root (or /app in Docker)
    root = Path(__file__).resolve().parents[3]
    return (root / "logs" / "audit.log").resolve()


def append_audit_event(
    *,
    user_id: str | None,
    client_ip: str | None,
    endpoint: str,
    action: str,
    file_path: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Append one JSON line to the audit log (best-effort, never raises)."""
    record: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id or None,
        "client_ip": client_ip or None,
        "endpoint": endpoint,
        "action": action,
        "file_path": file_path or "-",
    }
    if extra:
        record["extra"] = extra
    try:
        path = audit_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        logger.warning("audit log write failed: %s", exc)


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _user_id_from_auth(request: Request) -> str | None:
    """Best-effort subject from JWT payload without full verification (audit only)."""
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    parts = token.split(".")
    if len(parts) < 2:
        return None
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        sub = payload.get("sub")
        return str(sub) if sub else None
    except (ValueError, json.JSONDecodeError, TypeError):
        return None


def _extract_file_path(path: str, body: bytes) -> str:
    if not body:
        if path.rstrip("/").endswith("/fs/file"):
            return "-"
        return "-"
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        # multipart upload — use filename hint if present later
        return "-"
    if not isinstance(data, dict):
        return "-"
    if isinstance(data.get("path"), str) and data["path"].strip():
        return data["path"].replace("\\", "/")
    if isinstance(data.get("relative_path"), str) and data["relative_path"].strip():
        return data["relative_path"].replace("\\", "/")
    if isinstance(data.get("file_name"), str) and data["file_name"].strip():
        return data["file_name"].replace("\\", "/")
    files = data.get("files")
    if isinstance(files, list) and files:
        paths: list[str] = []
        for item in files:
            if isinstance(item, dict):
                rel = item.get("relative_path") or item.get("path")
                if isinstance(rel, str) and rel.strip():
                    paths.append(rel.replace("\\", "/"))
        if paths:
            return ",".join(paths[:20])
    return "-"


def _action_for(method: str, path: str) -> str:
    if method == "PUT" and path.rstrip("/").endswith("/fs/file"):
        return "fs.write"
    if method == "POST" and path.rstrip("/").endswith("/apply-changes"):
        return "fs.apply_changes"
    if method == "POST" and path.rstrip("/").endswith("/save-artifact"):
        return "fs.save_artifact"
    if method == "POST" and path.rstrip("/").endswith("/documents"):
        return "fs.upload_document"
    if method == "POST" and path.rstrip("/").endswith("/create-and-ingest"):
        return "fs.create_and_ingest"
    if method == "POST" and path.rstrip("/") == _WORKSPACE_PREFIX:
        return "workspace.create"
    if method == "PUT" and "/workspaces/" in path:
        return "workspace.update"
    if method == "DELETE" and "/workspaces/" in path:
        return "workspace.delete"
    return f"{method.lower()}:{path}"


def should_audit_request(method: str, path: str) -> bool:
    if method not in _MUTATING_METHODS:
        return False
    if not path.startswith(_WORKSPACE_PREFIX):
        return False
    # Read-ish analytics POST not used; exclude GET already. Skip threads/messages if under workspaces?
    if "/threads" in path or path.endswith("/analytics"):
        return False
    return True


class AuditFsMiddleware(BaseHTTPMiddleware):
    """Log mutating workspace / host-FS API calls as append-only JSON lines."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        method = request.method.upper()
        path = request.url.path
        audit = should_audit_request(method, path)
        body = b""
        if audit and method in {"PUT", "POST", "PATCH"}:
            body = await request.body()

            async def receive() -> dict[str, Any]:
                return {"type": "http.request", "body": body, "more_body": False}

            request = Request(request.scope, receive)

        response = await call_next(request)

        if audit and 200 <= response.status_code < 400:
            append_audit_event(
                user_id=_user_id_from_auth(request),
                client_ip=_client_ip(request),
                endpoint=path,
                action=_action_for(method, path),
                file_path=_extract_file_path(path, body),
            )
        return response
