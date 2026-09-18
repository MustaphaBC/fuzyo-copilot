#!/usr/bin/env python3
"""Verify multi-turn memory via confidential local stub + thread history.

Usage (from repo root, backend on :8000, migrations 02+03 applied):
  python backend/scripts/verify_multi_turn.py

Exits 0 on PASS. Exits 0 with SKIP if Supabase/tables unavailable (503).
"""

from __future__ import annotations

import json
import os
import sys
import uuid
import urllib.error
import urllib.request
from typing import Any

BASE = os.environ.get("FUZYO_BASE", "http://127.0.0.1:8000").rstrip("/")


def _request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 120.0,
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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


def _consume_sse_text(raw: bytes | str) -> str:
    if isinstance(raw, bytes):
        text = raw.decode("utf-8", errors="replace")
    else:
        text = raw
    parts: list[str] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "token":
            parts.append(event.get("content") or "")
    return "".join(parts)


def main() -> int:
    status, _ = _request("GET", "/health")
    if status != 200:
        print(f"FAIL: /health -> {status}")
        return 1

    status, ws = _request(
        "POST",
        "/api/v1/workspaces",
        {
            "name": f"mt-verify-{uuid.uuid4().hex[:8]}",
            "description": "multi-turn verify",
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
    thread_status, thread = _request(
        "POST",
        f"/api/v1/workspaces/{workspace_id}/threads",
        {"title": "Multi-turn test"},
    )
    if thread_status == 503:
        print("SKIP: chat_threads missing (503) — apply 03_chat_threads.sql")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 0
    if thread_status not in (200, 201) or not isinstance(thread, dict):
        print(f"FAIL: create thread -> {thread_status} {thread}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    thread_id = thread["id"]
    msg_user = str(uuid.uuid4())
    msg_assistant = str(uuid.uuid4())
    put_status, put_body = _request(
        "PUT",
        f"/api/v1/workspaces/{workspace_id}/threads/{thread_id}/messages",
        {
            "messages": [
                {
                    "id": msg_user,
                    "role": "user",
                    "content": "My tech stack is Python/FastAPI",
                    "sort_index": 0,
                },
                {
                    "id": msg_assistant,
                    "role": "assistant",
                    "content": "Noted: Python/FastAPI.",
                    "routing_badge": "LOCAL_STUB",
                    "sort_index": 1,
                },
            ]
        },
    )
    if put_status == 503:
        print("SKIP: chat_messages unavailable (503)")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 0
    if put_status != 200:
        print(f"FAIL: PUT history -> {put_status} {put_body}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    # Stream confidential completion — mock echoes prior user content.
    body = json.dumps(
        {
            "prompt": "What is my tech stack?",
            "sdlc_phase": 5,
            "force_confidential": True,
            "workspace_id": workspace_id,
            "thread_id": thread_id,
            "history_window": 6,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/api/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            chat_status = resp.status
    except urllib.error.HTTPError as exc:
        chat_status = exc.code
        raw = exc.read()
        print(f"FAIL: completions HTTP {chat_status} {raw[:300]!r}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    if chat_status != 200:
        print(f"FAIL: completions -> {chat_status}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    text = _consume_sse_text(raw)
    if "Python" not in text or "FastAPI" not in text:
        print(f"FAIL: response missing stack recall: {text!r}")
        _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
        return 1

    _request("DELETE", f"/api/v1/workspaces/{workspace_id}")
    print("PASS: multi-turn history recalled via confidential stub")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
