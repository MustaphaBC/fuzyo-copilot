#!/usr/bin/env python3
"""Fuzyo Copilot Task 9.1 — local E2E verification against a live backend.

Usage (from repo root):
  python backend/scripts/e2e_verify.py

Optional auth:
  set FUZYO_BEARER=<supabase_access_token>  # required for /api/v1 after auth ship

Exit 0 only when all cases pass.
Unauthenticated API probes expect HTTP 401 when no bearer is set.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

BASE = "http://127.0.0.1:8000"
ROUTING_MS_MAX = 200
TTFB_MS_MAX = 2000
BEARER = (os.environ.get("FUZYO_BEARER") or "").strip()


class CaseResult:
    def __init__(self, name: str) -> None:
        self.name = name
        self.ok = True
        self.notes: list[str] = []
        self.warnings: list[str] = []
        self.skipped = False

    def fail(self, msg: str) -> None:
        self.ok = False
        self.notes.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def skip(self, msg: str) -> None:
        self.skipped = True
        self.notes.append(msg)

    def check(self, cond: bool, msg: str) -> None:
        if not cond:
            self.fail(msg)


def _auth_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = dict(extra or {})
    if BEARER:
        headers["Authorization"] = f"Bearer {BEARER}"
    return headers


def _request(
    method: str,
    path: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
    with_auth: bool = True,
) -> tuple[int, bytes]:
    merged = _auth_headers(headers) if with_auth else dict(headers or {})
    req = urllib.request.Request(
        BASE + path,
        data=body,
        headers=merged,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _json_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    with_auth: bool = True,
) -> tuple[int, Any]:
    body = None
    headers: dict[str, str] = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    status, raw = _request(
        method, path, body=body, headers=headers, with_auth=with_auth
    )
    if not raw:
        return status, None
    try:
        return status, json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return status, raw.decode("utf-8", errors="replace")


def stream_chat(payload: dict[str, Any], timeout: float = 180.0) -> dict[str, Any]:
    """POST chat completions; return timing + parsed SSE events."""
    body = json.dumps(payload).encode("utf-8")
    headers = _auth_headers(
        {"Content-Type": "application/json", "Accept": "text/event-stream"}
    )
    req = urllib.request.Request(
        BASE + "/api/v1/chat/completions",
        data=body,
        headers=headers,
        method="POST",
    )
    t0 = time.perf_counter()
    routing_ms: float | None = None
    first_token_ms: float | None = None
    events: list[dict[str, Any]] = []
    parse_errors = 0
    buffer = ""

    try:
        resp_cm = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"chat HTTP {exc.code}: {raw[:300]}") from exc

    with resp_cm as resp:
        while True:
            chunk = resp.read(256)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip("\r")
                if not line.startswith("data:"):
                    continue
                payload_str = line[5:].strip()
                if not payload_str or payload_str == "[DONE]":
                    continue
                try:
                    event = json.loads(payload_str)
                except json.JSONDecodeError:
                    parse_errors += 1
                    continue
                if not isinstance(event, dict):
                    parse_errors += 1
                    continue
                events.append(event)
                etype = event.get("type")
                now = (time.perf_counter() - t0) * 1000.0
                if etype == "routing" and routing_ms is None:
                    routing_ms = now
                if etype == "token" and first_token_ms is None:
                    first_token_ms = now

    if buffer.strip().startswith("data:"):
        payload_str = buffer.strip()[5:].strip()
        if payload_str and payload_str != "[DONE]":
            try:
                events.append(json.loads(payload_str))
            except json.JSONDecodeError:
                parse_errors += 1

    types = [e.get("type") for e in events]
    tokens = "".join(
        str(e.get("content") or "") for e in events if e.get("type") == "token"
    )
    routing = next((e for e in events if e.get("type") == "routing"), None)
    rag = next((e for e in events if e.get("type") == "rag"), None)
    quality = next((e for e in events if e.get("type") == "quality"), None)

    return {
        "events": events,
        "types": types,
        "tokens": tokens,
        "routing": routing,
        "rag": rag,
        "quality": quality,
        "routing_ms": routing_ms,
        "first_token_ms": first_token_ms,
        "parse_errors": parse_errors,
    }


def upload_markdown(workspace_id: str, text: str, sdlc_phase: int = 1) -> dict[str, Any]:
    boundary = "----fuzyoe2e"
    filename = "e2e-doc.md"
    parts = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="sdlc_phase"\r\n\r\n{sdlc_phase}\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: text/markdown\r\n\r\n"
    ).encode("utf-8") + text.encode("utf-8") + f"\r\n--{boundary}--\r\n".encode("utf-8")
    status, raw = _request(
        "POST",
        f"/api/v1/workspaces/{workspace_id}/documents",
        body=parts,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        timeout=180.0,
    )
    if status >= 400:
        raise RuntimeError(f"upload failed {status}: {raw[:300]!r}")
    return json.loads(raw.decode("utf-8"))


def case_health() -> CaseResult:
    r = CaseResult("preflight_health")
    try:
        status, data = _json_request("GET", "/health", with_auth=False)
        r.check(status == 200, f"health status {status}")
        r.check(isinstance(data, dict) and data.get("status") == "ok", f"health body {data!r}")
    except Exception as exc:  # noqa: BLE001
        r.fail(f"backend unreachable at {BASE}: {exc}")
    return r


def case_auth_required() -> CaseResult:
    """Without bearer, /api/v1 must 401. With bearer, probe must not 401 for missing auth."""
    r = CaseResult("auth_bearer_gate")
    status, body = _json_request("GET", "/api/v1/workspaces", with_auth=False)
    r.check(status == 401, f"unauthenticated workspaces expected 401 got {status} {body!r}")
    if not BEARER:
        r.warn(
            "FUZYO_BEARER unset — authenticated cases will SKIP. "
            "Export a Supabase access_token to run full E2E."
        )
    else:
        authed, _ = _json_request("GET", "/api/v1/workspaces", with_auth=True)
        r.check(
            authed != 401,
            f"with FUZYO_BEARER expected non-401 for workspaces got {authed}",
        )
    return r


def _require_bearer(r: CaseResult) -> bool:
    if BEARER:
        return True
    r.skip("SKIP: set FUZYO_BEARER to a valid Supabase access_token")
    return False


def case_confidential() -> CaseResult:
    r = CaseResult("confidentiality_force_local")
    if not _require_bearer(r):
        return r
    stream = stream_chat(
        {
            "prompt": "Design a simple REST resource for tasks",
            "sdlc_phase": 5,
            "force_confidential": True,
        }
    )
    routing = stream["routing"] or {}
    r.check(stream["parse_errors"] == 0, f"SSE JSON errors: {stream['parse_errors']}")
    r.check(routing.get("target_client") == "LOCAL_STUB", f"routing={routing}")
    r.check(
        "[LOCAL MOCK EXECUTION]" in stream["tokens"],
        "missing [LOCAL MOCK EXECUTION] in tokens",
    )
    r.check(stream["quality"] is not None, "missing quality event")
    if stream["routing_ms"] is None:
        r.fail("no routing event timing")
    else:
        r.check(
            stream["routing_ms"] < ROUTING_MS_MAX,
            f"routing {stream['routing_ms']:.1f}ms >= {ROUTING_MS_MAX}ms",
        )
    if stream["first_token_ms"] is None:
        r.fail("no first token timing")
    else:
        r.check(
            stream["first_token_ms"] < TTFB_MS_MAX,
            f"TTFB {stream['first_token_ms']:.1f}ms >= {TTFB_MS_MAX}ms",
        )
    return r


def case_secret_detection() -> CaseResult:
    r = CaseResult("regex_secret_auto_route")
    if not _require_bearer(r):
        return r
    stream = stream_chat(
        {
            "prompt": "Please call OpenAI with key sk-test-12345ABCD for debugging only",
            "sdlc_phase": 5,
            "force_confidential": False,
        }
    )
    routing = stream["routing"] or {}
    secrets = routing.get("detected_secrets") or []
    r.check(routing.get("target_client") == "LOCAL_STUB", f"expected LOCAL_STUB got {routing}")
    r.check(
        "openai_api_key" in secrets,
        f"expected openai_api_key in detected_secrets={secrets!r}",
    )
    r.check("[LOCAL MOCK EXECUTION]" in stream["tokens"], "expected local mock tokens")
    return r


def case_sse_shape() -> CaseResult:
    r = CaseResult("sse_token_streaming_shape")
    if not _require_bearer(r):
        return r
    stream = stream_chat(
        {
            "prompt": "Say hello briefly",
            "sdlc_phase": 1,
            "force_confidential": True,
        }
    )
    types = [t for t in stream["types"] if t]
    r.check(stream["parse_errors"] == 0, f"parse errors {stream['parse_errors']}")
    r.check(len(types) >= 4, f"too few events: {types}")
    try:
        i_routing = types.index("routing")
        i_rag = types.index("rag")
        i_token = types.index("token")
        i_quality = types.index("quality")
    except ValueError:
        r.fail(f"missing required event types in {types}")
        return r
    r.check(
        i_routing < i_rag < i_token < i_quality,
        f"bad order indices routing={i_routing} rag={i_rag} token={i_token} quality={i_quality}",
    )
    r.check(types.count("token") >= 1, "expected at least one token")
    return r


def case_workspace_delete() -> CaseResult:
    r = CaseResult("workspace_deletion_cascade")
    if not _require_bearer(r):
        return r
    status, created = _json_request(
        "POST",
        "/api/v1/workspaces",
        {
            "name": "e2e-purge-temp",
            "description": "Task 9.1 delete cascade",
            "tech_stack": ["Python"],
            "custom_instructions": None,
        },
    )
    r.check(status == 200 and isinstance(created, dict), f"create failed {status} {created}")
    if not r.ok or not isinstance(created, dict):
        return r
    ws_id = created["id"]
    try:
        up = upload_markdown(
            ws_id,
            "# E2E purge doc\n\nFastAPI React pytest coverage notes.\n",
            sdlc_phase=1,
        )
        inserted = int(up.get("chunks_inserted") or 0)
        r.check(inserted >= 1, f"expected chunks_inserted>=1 got {up}")

        del_status, deleted = _json_request("DELETE", f"/api/v1/workspaces/{ws_id}")
        r.check(del_status == 200, f"delete status {del_status} {deleted}")
        if isinstance(deleted, dict):
            purged = int(deleted.get("purged_chunks") or 0)
            r.check(purged >= 1, f"purged_chunks={purged} expected >=1 ({deleted})")
            r.check(
                purged == inserted or purged >= inserted,
                f"purged_chunks {purged} vs inserted {inserted}",
            )

        an_status, _ = _json_request("GET", f"/api/v1/workspaces/{ws_id}/analytics")
        r.check(an_status == 404, f"analytics after delete expected 404 got {an_status}")
    except Exception as exc:  # noqa: BLE001
        r.fail(str(exc))
        _json_request("DELETE", f"/api/v1/workspaces/{ws_id}")
    return r


def case_rag_smoke() -> CaseResult:
    r = CaseResult("rag_with_workspace")
    if not _require_bearer(r):
        return r
    status, created = _json_request(
        "POST",
        "/api/v1/workspaces",
        {
            "name": "e2e-rag-temp",
            "description": "Task 9.1 RAG",
            "tech_stack": ["FastAPI"],
            "custom_instructions": None,
        },
    )
    r.check(status == 200 and isinstance(created, dict), f"create failed {status} {created}")
    if not r.ok or not isinstance(created, dict):
        return r
    ws_id = created["id"]
    try:
        up = upload_markdown(
            ws_id,
            "# Project brief\n\nThis workspace documents the Fuzyo chat gateway and vector search.\n",
            sdlc_phase=2,
        )
        r.check(int(up.get("chunks_inserted") or 0) >= 1, f"upload {up}")

        stream = stream_chat(
            {
                "prompt": "What does this workspace document about the chat gateway?",
                "sdlc_phase": 2,
                "force_confidential": True,
                "workspace_id": ws_id,
            }
        )
        rag = stream["rag"]
        r.check(rag is not None, "missing rag event")
        if rag is not None:
            status_val = rag.get("status")
            r.check(
                status_val in {"ok", "empty", "error", "skipped"},
                f"unexpected rag status {status_val!r}",
            )
            r.check("hit_count" in rag, "rag missing hit_count")
            if status_val == "error":
                r.warn("rag status=error (search failed but stream continued)")
            if status_val == "skipped":
                r.warn("rag status=skipped despite workspace_id (requires_rag false?)")
        r.check(stream["quality"] is not None, "stream missing quality after RAG chat")
        r.check("[LOCAL MOCK EXECUTION]" in stream["tokens"], "expected local tokens")
    except Exception as exc:  # noqa: BLE001
        r.fail(str(exc))
    finally:
        _json_request("DELETE", f"/api/v1/workspaces/{ws_id}")
    return r


def case_cloud_architecture() -> CaseResult:
    r = CaseResult("cloud_architecture_gemini")
    if not _require_bearer(r):
        return r
    stream = stream_chat(
        {
            "prompt": (
                "Propose a high-level microservices architecture for a chat copilot "
                "with an API gateway and a vector database. Include a mermaid flowchart."
            ),
            "sdlc_phase": 3,
            "force_confidential": False,
        },
        timeout=180.0,
    )
    routing = stream["routing"] or {}
    tokens = stream["tokens"]
    r.check(routing.get("target_client") == "CLOUD_API", f"expected CLOUD_API got {routing}")
    r.check(
        routing.get("selected_provider") == "gemini",
        f"expected gemini provider got {routing.get('selected_provider')!r}",
    )
    r.check(bool(tokens.strip()), "empty cloud tokens")
    lower = tokens.lower()
    r.check(
        "missing api key" not in lower and "[gemini error" not in lower,
        f"cloud error in tokens: {tokens[:240]!r}",
    )
    if "```mermaid" not in tokens and "mermaid" not in lower:
        r.warn("no mermaid fence in cloud tokens (model omitted diagram)")
    r.check(stream["quality"] is not None, "missing quality event")
    return r


def main() -> int:
    print(f"Fuzyo E2E verify -> {BASE}")
    if BEARER:
        print("Auth: FUZYO_BEARER set (authenticated /api/v1 cases enabled)\n")
    else:
        print("Auth: FUZYO_BEARER unset (authenticated /api/v1 cases will SKIP)\n")

    results = [
        case_health(),
        case_auth_required(),
        case_confidential(),
        case_secret_detection(),
        case_sse_shape(),
        case_workspace_delete(),
        case_rag_smoke(),
        case_cloud_architecture(),
    ]

    if not results[0].ok:
        print("FAIL  preflight_health")
        for note in results[0].notes:
            print(f"  - {note}")
        print("\nStart backend: python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000")
        return 1

    failed = 0
    skipped = 0
    for result in results:
        if result.skipped and result.ok:
            mark = "SKIP"
            skipped += 1
        elif result.ok:
            mark = "PASS"
        else:
            mark = "FAIL"
            failed += 1
        print(f"{mark}  {result.name}")
        for note in result.notes:
            print(f"  - {note}")
        for warning in result.warnings:
            print(f"  ! {warning}")

    print()
    if failed:
        print(f"{failed} case(s) failed.")
        return 1
    if skipped:
        print(f"All runnable cases passed ({skipped} skipped without FUZYO_BEARER).")
    else:
        print("All E2E cases passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
