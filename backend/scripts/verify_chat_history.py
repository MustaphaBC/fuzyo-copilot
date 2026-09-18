#!/usr/bin/env python3
"""Verify chat history API: PUT → GET → DELETE.

Usage (from repo root, backend on :8000, migration 02 applied):
  python backend/scripts/verify_chat_history.py

Exits 0 on PASS. Exits 0 with SKIP if Supabase is not configured (503).
"""

from __future__ import annotations

import json
import sys
import uuid
import urllib.error
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8000"


def _request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    body = None
    headers: dict[str, str] = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        BASE + path,
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
    except urllib.error.URLError as exc:
        print(f"FAIL: backend unreachable ({exc})")
        sys.exit(1)

    if not raw:
        return status, None
    try:
        return status, json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return status, raw.decode("utf-8", errors="replace")


def main() -> int:
    status, health = _request("GET", "/health")
    if status != 200:
        print(f"FAIL: /health -> {status}")
        return 1

    status, ws = _request(
        "POST",
        "/api/v1/workspaces",
        {
            "name": f"history-verify-{uuid.uuid4().hex[:8]}",
            "description": "chat history verify",
            "tech_stack": [],
            "custom_instructions": None,
        },
    )
    if status == 503:
        print("SKIP: Supabase not configured (503)")
        return 0
    if status not in (200, 201) or not isinstance(ws, dict) or "id" not in ws:
        print(f"FAIL: create workspace -> {status} {ws}")
        return 1

    workspace_id = ws["id"]
    thread_id = str(uuid.uuid4())
    msg_user = str(uuid.uuid4())
    msg_assistant = str(uuid.uuid4())
    path = f"/api/v1/workspaces/{workspace_id}/threads/{thread_id}/messages"

    put_status, put_body = _request(
        "PUT",
        path,
        {
            "messages": [
                {
                    "id": msg_user,
                    "role": "user",
                    "content": "hello history",
                    "routing_badge": None,
                    "sort_index": 0,
                },
                {
                    "id": msg_assistant,
                    "role": "assistant",
                    "content": "hi from server",
                    "routing_badge": "CLOUD_API",
                    "sort_index": 1,
                },
            ]
        },
    )
    if put_status == 503:
        print("SKIP: chat_messages table / Supabase unavailable (503)")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 0
    if put_status != 200 or not isinstance(put_body, list) or len(put_body) != 2:
        print(f"FAIL: PUT messages -> {put_status} {put_body}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    get_status, get_body = _request("GET", path)
    if get_status != 200 or not isinstance(get_body, list):
        print(f"FAIL: GET messages -> {get_status} {get_body}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1
    if [m.get("content") for m in get_body] != ["hello history", "hi from server"]:
        print(f"FAIL: unexpected GET order/content {get_body}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    del_status, _ = _request("DELETE", path)
    if del_status != 200:
        print(f"FAIL: DELETE messages -> {del_status}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    empty_status, empty_body = _request("GET", path)
    if empty_status != 200 or empty_body != []:
        print(f"FAIL: GET after DELETE -> {empty_status} {empty_body}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
    print("PASS: chat history PUT/GET/DELETE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
