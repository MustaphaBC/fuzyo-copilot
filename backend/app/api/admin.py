"""Admin console endpoints (users, audit log, AI providers, observability).

Guarded by ``require_admin`` — the role must be set in Supabase ``app_metadata``.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import Counter, deque
from typing import Annotated, Any, Final

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.api.deps import CurrentUser, require_admin
from backend.app.core.audit import audit_log_path
from backend.app.core.config import settings
from backend.app.core.logging_config import get_logger
from backend.app.core.rbac import normalize_role
from backend.app.services.cloud_providers import (
    CerebrasClient,
    GeminiClient,
    GroqClient,
    MistralClient,
    SambaNovaClient,
)
from backend.app.services.token_tracker import read_usage_records
from supabase import create_client

router = APIRouter(prefix="/admin", tags=["admin"])
_log = get_logger("fuzyo.admin")

_PING_TIMEOUT: Final[httpx.Timeout] = httpx.Timeout(4.0, connect=2.0)


class AdminUser(BaseModel):
    id: str
    email: str | None = None
    full_name: str | None = None
    organization: str | None = None
    profile_role: str = "developer"
    platform_role: str | None = None
    created_at: str | None = None
    last_sign_in_at: str | None = None


class AdminUsersResponse(BaseModel):
    users: list[AdminUser] = Field(default_factory=list)
    total: int = 0
    source: str = "profiles"


class AuditEntry(BaseModel):
    timestamp: str | None = None
    user_id: str | None = None
    client_ip: str | None = None
    endpoint: str | None = None
    action: str | None = None
    file_path: str | None = None


class AuditResponse(BaseModel):
    entries: list[AuditEntry] = Field(default_factory=list)
    total_scanned: int = 0
    log_available: bool = False


class ProviderStatus(BaseModel):
    provider: str
    purpose: str
    default_model: str | None = None
    configured: bool
    status: str  # not_configured | unchecked | ok | error
    latency_ms: int | None = None
    detail: str | None = None


class ProvidersResponse(BaseModel):
    providers: list[ProviderStatus]
    force_local_mock: bool


class MetricsBucket(BaseModel):
    key: str
    requests: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0


class MetricsResponse(BaseModel):
    requests: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    avg_latency_ms: float | None = None
    p95_latency_ms: int | None = None
    local_share_pct: float = 0.0
    quality_pass_rate_pct: float | None = None
    retry_rate_pct: float | None = None
    by_provider: list[MetricsBucket] = Field(default_factory=list)
    by_phase: list[MetricsBucket] = Field(default_factory=list)
    route_reasons: dict[str, int] = Field(default_factory=dict)
    recent: list[dict[str, Any]] = Field(default_factory=list)


def _supabase() -> Any:
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_secret_key or "").strip()
    if not url or not key:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    try:
        return create_client(url, key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Supabase client error: {exc}") from exc


def _auth_users_by_id(client: Any) -> dict[str, dict[str, Any]]:
    """Email / app_metadata role from auth.users (service role); best-effort."""
    try:
        response = client.auth.admin.list_users()
    except Exception as exc:  # noqa: BLE001
        _log.warning("admin_list_auth_users_failed", error=str(exc))
        return {}
    users = response if isinstance(response, list) else getattr(response, "users", None) or []
    out: dict[str, dict[str, Any]] = {}
    for item in users:
        uid = str(getattr(item, "id", "") or "")
        if not uid:
            continue
        app_meta = getattr(item, "app_metadata", None) or {}
        out[uid] = {
            "email": getattr(item, "email", None),
            "platform_role": app_meta.get("role") if isinstance(app_meta, dict) else None,
            "last_sign_in_at": _iso(getattr(item, "last_sign_in_at", None)),
        }
    return out


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


@router.get("/users", response_model=AdminUsersResponse)
async def admin_users(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
) -> AdminUsersResponse:
    client = _supabase()
    try:
        result = (
            client.table("profiles")
            .select("id, full_name, role, organization, created_at")
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"profiles query failed (apply migration 06): {exc}",
        ) from exc
    auth_users = _auth_users_by_id(client)
    users: list[AdminUser] = []
    for row in result.data or []:
        uid = str(row.get("id"))
        auth = auth_users.get(uid, {})
        users.append(
            AdminUser(
                id=uid,
                email=auth.get("email"),
                full_name=row.get("full_name"),
                organization=row.get("organization"),
                profile_role=normalize_role(row.get("role")),
                platform_role=auth.get("platform_role"),
                created_at=row.get("created_at"),
                last_sign_in_at=auth.get("last_sign_in_at"),
            )
        )
    return AdminUsersResponse(
        users=users,
        total=len(users),
        source="profiles+auth" if auth_users else "profiles",
    )


def read_audit_entries(
    *,
    limit: int,
    action: str | None = None,
    user_id: str | None = None,
    scan_max: int = 20_000,
) -> tuple[list[AuditEntry], int, bool]:
    """Newest-first audit entries from the JSONL audit log (pure file read)."""
    path = audit_log_path()
    if not path.is_file():
        return [], 0, False
    tail: deque[str] = deque(maxlen=scan_max)
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    tail.append(line)
    except OSError:
        return [], 0, False
    entries: list[AuditEntry] = []
    for line in reversed(tail):
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        if action and data.get("action") != action:
            continue
        if user_id and data.get("user_id") != user_id:
            continue
        entries.append(
            AuditEntry(
                timestamp=data.get("timestamp"),
                user_id=data.get("user_id"),
                client_ip=data.get("client_ip"),
                endpoint=data.get("endpoint"),
                action=data.get("action"),
                file_path=data.get("file_path"),
            )
        )
        if len(entries) >= limit:
            break
    return entries, len(tail), True


@router.get("/audit", response_model=AuditResponse)
async def admin_audit(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    limit: int = Query(200, ge=1, le=2000),
    action: str | None = Query(None, max_length=100),
    user_id: str | None = Query(None, max_length=64),
) -> AuditResponse:
    entries, scanned, available = read_audit_entries(limit=limit, action=action, user_id=user_id)
    return AuditResponse(entries=entries, total_scanned=scanned, log_available=available)


def _provider_specs() -> list[dict[str, Any]]:
    return [
        {
            "provider": "groq",
            "purpose": "QA / DevOps / PO (fast)",
            "key": settings.groq_api_key,
            "model": GroqClient.default_model,
            "url": f"{GroqClient.default_base_url}/models",
            "auth": "bearer",
        },
        {
            "provider": "gemini",
            "purpose": "Architecture / specs",
            "key": settings.gemini_api_key,
            "model": GeminiClient.default_model,
            "url": f"{GeminiClient.default_base_url}/models",
            "auth": "goog",
        },
        {
            "provider": "mistral",
            "purpose": "Code generation (Codestral)",
            "key": settings.mistral_api_key,
            "model": MistralClient.default_model,
            "url": f"{MistralClient.default_base_url}/models",
            "auth": "bearer",
        },
        {
            "provider": "sambanova",
            "purpose": "Code generation",
            "key": settings.sambanova_api_key,
            "model": SambaNovaClient.default_model,
            "url": f"{SambaNovaClient.default_base_url}/models",
            "auth": "bearer",
        },
        {
            "provider": "cerebras",
            "purpose": "Privacy classifier (<150 ms)",
            "key": settings.cerebras_api_key,
            "model": CerebrasClient.default_model,
            "url": f"{CerebrasClient.default_base_url}/models",
            "auth": "bearer",
        },
        {
            "provider": "openrouter",
            "purpose": "Fallback on 404/429/5xx",
            "key": settings.openrouter_api_key,
            "model": "openrouter/auto",
            "url": "https://openrouter.ai/api/v1/models",
            "auth": "bearer",
        },
        {
            "provider": "cohere",
            "purpose": "RAG embeddings",
            "key": settings.cohere_api_key,
            "model": "embed-v4.0",
            "url": "https://api.cohere.com/v1/models",
            "auth": "bearer",
        },
    ]


async def _ping(client: httpx.AsyncClient, spec: dict[str, Any]) -> tuple[str, int | None, str | None]:
    """Auth-only GET /models — sends the provider its own key, never user data."""
    key = str(spec["key"]).strip()
    headers = (
        {"x-goog-api-key": key}
        if spec["auth"] == "goog"
        else {"Authorization": f"Bearer {key}"}
    )
    started = time.monotonic()
    try:
        response = await client.get(spec["url"], headers=headers)
    except httpx.HTTPError as exc:
        return "error", None, exc.__class__.__name__
    latency = int((time.monotonic() - started) * 1000)
    if response.status_code < 400:
        return "ok", latency, None
    return "error", latency, f"HTTP {response.status_code}"


@router.get("/providers", response_model=ProvidersResponse)
async def admin_providers(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    ping: bool = False,
) -> ProvidersResponse:
    specs = _provider_specs()
    statuses: list[ProviderStatus] = []
    ping_targets = [spec for spec in specs if str(spec["key"]).strip()] if ping else []
    results: dict[str, tuple[str, int | None, str | None]] = {}
    if ping_targets:
        async with httpx.AsyncClient(timeout=_PING_TIMEOUT) as client:
            outcomes = await asyncio.gather(*(_ping(client, spec) for spec in ping_targets))
        results = {spec["provider"]: outcome for spec, outcome in zip(ping_targets, outcomes)}
    for spec in specs:
        configured = bool(str(spec["key"]).strip())
        if not configured:
            status, latency, detail = "not_configured", None, None
        elif spec["provider"] in results:
            status, latency, detail = results[spec["provider"]]
        else:
            status, latency, detail = "unchecked", None, None
        statuses.append(
            ProviderStatus(
                provider=spec["provider"],
                purpose=spec["purpose"],
                default_model=spec["model"],
                configured=configured,
                status=status,
                latency_ms=latency,
                detail=detail,
            )
        )
    return ProvidersResponse(providers=statuses, force_local_mock=bool(settings.force_local_mock))


def _bucket(records: list[dict[str, Any]], key_fn: Any) -> list[MetricsBucket]:
    buckets: dict[str, MetricsBucket] = {}
    for record in records:
        key = str(key_fn(record))
        bucket = buckets.setdefault(key, MetricsBucket(key=key))
        bucket.requests += 1
        bucket.total_tokens += int(record.get("total_tokens") or 0)
        bucket.estimated_cost_usd += float(record.get("estimated_cost_usd") or 0.0)
    for bucket in buckets.values():
        bucket.estimated_cost_usd = round(bucket.estimated_cost_usd, 6)
    return sorted(buckets.values(), key=lambda b: b.requests, reverse=True)


def summarize_usage(records: list[dict[str, Any]], *, recent: int = 20) -> MetricsResponse:
    """Aggregate persisted usage records (pure; unit-tested)."""
    if not records:
        return MetricsResponse()
    latencies = sorted(int(r["latency_ms"]) for r in records if isinstance(r.get("latency_ms"), int))
    graded = [r for r in records if isinstance(r.get("quality_passed"), bool)]
    attempted = [r for r in records if isinstance(r.get("attempts"), int)]
    local = sum(1 for r in records if r.get("target_client") == "LOCAL_STUB")
    reasons = Counter(str(r.get("route_reason")) for r in records if r.get("route_reason"))
    total_tokens = sum(int(r.get("total_tokens") or 0) for r in records)
    cost = sum(float(r.get("estimated_cost_usd") or 0.0) for r in records)
    p95 = latencies[min(len(latencies) - 1, int(round(0.95 * (len(latencies) - 1))))] if latencies else None
    return MetricsResponse(
        requests=len(records),
        total_tokens=total_tokens,
        estimated_cost_usd=round(cost, 6),
        avg_latency_ms=round(sum(latencies) / len(latencies), 1) if latencies else None,
        p95_latency_ms=p95,
        local_share_pct=round(100.0 * local / len(records), 1),
        quality_pass_rate_pct=(
            round(100.0 * sum(1 for r in graded if r["quality_passed"]) / len(graded), 1)
            if graded
            else None
        ),
        retry_rate_pct=(
            round(100.0 * sum(1 for r in attempted if r["attempts"] > 1) / len(attempted), 1)
            if attempted
            else None
        ),
        by_provider=_bucket(records, lambda r: r.get("provider") or "unknown"),
        by_phase=_bucket(records, lambda r: r.get("sdlc_phase") or "—"),
        route_reasons=dict(reasons),
        recent=list(reversed(records[-recent:])),
    )


@router.get("/metrics", response_model=MetricsResponse)
async def admin_metrics(
    _admin: Annotated[CurrentUser, Depends(require_admin)],
    limit: int = Query(5000, ge=1, le=50_000),
) -> MetricsResponse:
    return summarize_usage(read_usage_records(limit))
