"""Auth caching: local JWT fast path, remote fallback, TTL/exp bounds, invalidation."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from backend.app.api import deps, workspaces
from backend.app.api.deps import (
    ensure_owned_workspace,
    get_current_user,
    invalidate_user,
    invalidate_workspace,
)
from backend.app.core.config import settings
from backend.app.core.ttl_cache import TTLCache
from backend.app.schemas.workspace import WorkspaceUpdate

SECRET = "test-jwt-secret-with-enough-entropy-0123456789"


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _token(
    sub: UUID,
    *,
    secret: str = SECRET,
    exp_in: float = 3600,
    app_meta: dict[str, Any] | None = None,
    user_meta: dict[str, Any] | None = None,
) -> str:
    claims = {
        "sub": str(sub),
        "aud": "authenticated",
        "email": "dev@example.com",
        "exp": int(time.time() + exp_in),
        "app_metadata": app_meta or {},
        "user_metadata": user_meta or {},
    }
    return jwt.encode(claims, secret, algorithm="HS256")


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeRemoteAuth:
    """Stands in for ``client.auth`` on the Supabase client."""

    def __init__(self, user: Any = None, errors: list[Exception] | None = None) -> None:
        self.user = user
        self.errors = list(errors or [])
        self.calls: list[str] = []

    def get_user(self, token: str) -> Any:
        self.calls.append(token)
        if self.errors:
            raise self.errors.pop(0)
        return SimpleNamespace(user=self.user)


def _remote_user(
    sub: UUID,
    *,
    app_meta: dict[str, Any] | None = None,
    user_meta: dict[str, Any] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(sub),
        email="remote@example.com",
        app_metadata=app_meta or {},
        user_metadata=user_meta or {},
    )


class FakeQuery:
    def __init__(self, db: FakeDb, table: str) -> None:
        self._db = db
        self._table = table
        self._op = "select"
        self._payload: dict[str, Any] = {}
        self._filters: dict[str, str] = {}

    def select(self, *_args: Any, **_kwargs: Any) -> FakeQuery:
        self._op = "select"
        return self

    def update(self, payload: dict[str, Any]) -> FakeQuery:
        self._op = "update"
        self._payload = payload
        return self

    def delete(self) -> FakeQuery:
        self._op = "delete"
        return self

    def eq(self, column: str, value: Any) -> FakeQuery:
        self._filters[column] = str(value)
        return self

    def limit(self, _count: int) -> FakeQuery:
        return self

    def execute(self) -> SimpleNamespace:
        self._db.calls.append((self._table, self._op))
        table = self._db.tables.setdefault(self._table, [])
        matched = [
            row
            for row in table
            if all(str(row.get(col)) == val for col, val in self._filters.items())
        ]
        if self._op == "update":
            for row in matched:
                row.update(self._payload)
        elif self._op == "delete":
            self._db.tables[self._table] = [row for row in table if row not in matched]
        return SimpleNamespace(data=[dict(row) for row in matched])


class FakeDb:
    def __init__(self) -> None:
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.calls: list[tuple[str, str]] = []

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def workspace_selects(self) -> int:
        return self.calls.count(("workspaces", "select"))


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    fake = FakeClock()
    monkeypatch.setattr(deps._token_cache, "clock", fake)
    monkeypatch.setattr(deps._ownership_cache, "clock", fake)
    return fake


@pytest.fixture
def auth_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_secret_key", "")
    monkeypatch.setattr(settings, "auth_cache_ttl_seconds", 20.0)


@pytest.fixture
def remote(monkeypatch: pytest.MonkeyPatch, auth_settings: None) -> FakeRemoteAuth:
    fake = FakeRemoteAuth()
    monkeypatch.setattr(deps, "_supabase", lambda: SimpleNamespace(auth=fake))
    return fake


@pytest.fixture
def no_secret(monkeypatch: pytest.MonkeyPatch, auth_settings: None) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", "")


def _workspace_db(owner: UUID, workspace_id: UUID, name: str = "Alpha") -> FakeDb:
    db = FakeDb()
    db.tables["workspaces"] = [
        {
            "id": str(workspace_id),
            "owner_id": str(owner),
            "name": name,
            "created_at": "2026-09-30T10:00:00+00:00",
        }
    ]
    db.tables["document_chunks"] = []
    return db


# --- Token verification --------------------------------------------------------


def test_local_jwt_fast_path_makes_no_supabase_call(remote: FakeRemoteAuth) -> None:
    sub = uuid4()
    user = _run(get_current_user(_creds(_token(sub))))
    assert user.id == sub
    assert user.email == "dev@example.com"
    assert remote.calls == []


def test_falls_back_to_remote_when_no_secret(remote: FakeRemoteAuth, no_secret: None) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub, secret="unknown-to-the-backend-secret-value-xyz")
    user = _run(get_current_user(_creds(token)))
    assert user.id == sub
    assert user.email == "remote@example.com"
    assert remote.calls == [token]


def test_no_secret_and_no_remote_is_401(monkeypatch: pytest.MonkeyPatch, no_secret: None) -> None:
    monkeypatch.setattr(deps, "_supabase", lambda: None)
    with pytest.raises(HTTPException) as exc:
        _run(get_current_user(_creds(_token(uuid4()))))
    assert exc.value.status_code == 401


def test_expired_token_rejected_without_remote(remote: FakeRemoteAuth) -> None:
    with pytest.raises(HTTPException) as exc:
        _run(get_current_user(_creds(_token(uuid4(), exp_in=-60))))
    assert exc.value.status_code == 401
    assert "expired" in str(exc.value.detail).lower()
    assert remote.calls == []


def test_invalid_signature_rejected_without_remote(remote: FakeRemoteAuth) -> None:
    forged = _token(uuid4(), secret="attacker-controlled-secret-value-000000")
    with pytest.raises(HTTPException) as exc:
        _run(get_current_user(_creds(forged)))
    assert exc.value.status_code == 401
    assert remote.calls == []


def test_unsigned_token_rejected(remote: FakeRemoteAuth) -> None:
    def b64(data: dict[str, Any]) -> str:
        raw = json.dumps(data).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    claims = {"sub": str(uuid4()), "aud": "authenticated", "exp": int(time.time()) + 600}
    token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}."
    with pytest.raises(HTTPException) as exc:
        _run(get_current_user(_creds(token)))
    assert exc.value.status_code == 401
    assert remote.calls == []


@pytest.mark.parametrize(
    ("app_meta", "user_meta", "expected_admin"),
    [
        ({}, {"role": "admin"}, False),
        ({"role": "admin"}, {}, True),
        ({"role": "developer"}, {"role": "admin"}, False),
    ],
)
def test_admin_only_from_app_metadata_local(
    remote: FakeRemoteAuth,
    app_meta: dict[str, Any],
    user_meta: dict[str, Any],
    expected_admin: bool,
) -> None:
    token = _token(uuid4(), app_meta=app_meta, user_meta=user_meta)
    user = _run(get_current_user(_creds(token)))
    assert user.is_platform_admin is expected_admin


@pytest.mark.parametrize(
    ("app_meta", "user_meta", "expected_admin"),
    [
        ({}, {"role": "admin"}, False),
        ({"role": "admin"}, {}, True),
    ],
)
def test_admin_only_from_app_metadata_remote(
    remote: FakeRemoteAuth,
    no_secret: None,
    app_meta: dict[str, Any],
    user_meta: dict[str, Any],
    expected_admin: bool,
) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub, app_meta=app_meta, user_meta=user_meta)
    user = _run(get_current_user(_creds(_token(sub))))
    assert user.is_platform_admin is expected_admin


def test_cache_hit_avoids_second_remote_call(
    remote: FakeRemoteAuth, no_secret: None, clock: FakeClock
) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub)
    first = _run(get_current_user(_creds(token)))
    second = _run(get_current_user(_creds(token)))
    assert first == second
    assert len(remote.calls) == 1


def test_token_cache_expires_after_ttl(
    remote: FakeRemoteAuth, no_secret: None, clock: FakeClock
) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub)
    _run(get_current_user(_creds(token)))
    clock.advance(19)
    _run(get_current_user(_creds(token)))
    assert len(remote.calls) == 1
    clock.advance(2)
    _run(get_current_user(_creds(token)))
    assert len(remote.calls) == 2


def test_token_cache_never_outlives_exp(
    remote: FakeRemoteAuth, no_secret: None, clock: FakeClock
) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub, exp_in=5)
    _run(get_current_user(_creds(token)))
    clock.advance(6)
    _run(get_current_user(_creds(token)))
    assert len(remote.calls) == 2


def test_cache_disabled_when_ttl_zero(
    monkeypatch: pytest.MonkeyPatch, remote: FakeRemoteAuth, no_secret: None
) -> None:
    monkeypatch.setattr(settings, "auth_cache_ttl_seconds", 0)
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub)
    _run(get_current_user(_creds(token)))
    _run(get_current_user(_creds(token)))
    assert len(remote.calls) == 2


def test_remote_failure_not_cached(remote: FakeRemoteAuth, no_secret: None) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    remote.errors = [RuntimeError("supabase down")]
    token = _token(sub)
    with pytest.raises(HTTPException) as exc:
        _run(get_current_user(_creds(token)))
    assert exc.value.status_code == 401
    user = _run(get_current_user(_creds(token)))
    assert user.id == sub
    assert len(remote.calls) == 2


def test_local_failure_not_cached(monkeypatch: pytest.MonkeyPatch, remote: FakeRemoteAuth) -> None:
    sub = uuid4()
    token = _token(sub)
    monkeypatch.setattr(settings, "supabase_jwt_secret", "a-different-secret-rotated-in-000000")
    with pytest.raises(HTTPException):
        _run(get_current_user(_creds(token)))
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    assert _run(get_current_user(_creds(token))).id == sub


def test_token_cache_keys_are_hashed(remote: FakeRemoteAuth) -> None:
    token = _token(uuid4())
    _run(get_current_user(_creds(token)))
    keys = list(deps._token_cache._data.keys())
    assert len(keys) == 1
    assert token not in keys[0]
    assert len(keys[0]) == 64


def test_invalidate_user_drops_cached_identity(
    remote: FakeRemoteAuth, no_secret: None
) -> None:
    sub = uuid4()
    remote.user = _remote_user(sub)
    token = _token(sub)
    _run(get_current_user(_creds(token)))
    invalidate_user(sub)
    _run(get_current_user(_creds(token)))
    assert len(remote.calls) == 2


# --- Workspace ownership -------------------------------------------------------


def test_ownership_read_is_cached_and_fresh_bypasses(auth_settings: None) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    first = ensure_owned_workspace(db, workspace_id, owner)
    second = ensure_owned_workspace(db, workspace_id, owner)
    assert first == second
    assert db.workspace_selects() == 1
    ensure_owned_workspace(db, workspace_id, owner, fresh=True)
    assert db.workspace_selects() == 2


def test_cached_row_is_isolated_from_caller_mutation(auth_settings: None) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    ensure_owned_workspace(db, workspace_id, owner)["name"] = "mutated"
    assert ensure_owned_workspace(db, workspace_id, owner)["name"] == "Alpha"


def test_ownership_cache_expires(auth_settings: None, clock: FakeClock) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    ensure_owned_workspace(db, workspace_id, owner)
    clock.advance(21)
    ensure_owned_workspace(db, workspace_id, owner)
    assert db.workspace_selects() == 2


def test_ownership_not_found_not_cached(auth_settings: None) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(uuid4(), workspace_id)
    with pytest.raises(HTTPException) as exc:
        ensure_owned_workspace(db, workspace_id, owner)
    assert exc.value.status_code == 404
    db.tables["workspaces"][0]["owner_id"] = str(owner)
    assert ensure_owned_workspace(db, workspace_id, owner)["id"] == str(workspace_id)


def test_other_user_never_served_from_cache(auth_settings: None) -> None:
    owner, intruder, workspace_id = uuid4(), uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    ensure_owned_workspace(db, workspace_id, owner)
    with pytest.raises(HTTPException) as exc:
        ensure_owned_workspace(db, workspace_id, intruder)
    assert exc.value.status_code == 404


def test_invalidate_workspace_forces_requery(auth_settings: None) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    ensure_owned_workspace(db, workspace_id, owner)
    invalidate_workspace(workspace_id)
    ensure_owned_workspace(db, workspace_id, owner)
    assert db.workspace_selects() == 2


def _user(owner: UUID) -> deps.CurrentUser:
    return deps.CurrentUser(id=owner)


def test_delete_workspace_invalidates_ownership_cache(
    monkeypatch: pytest.MonkeyPatch, auth_settings: None
) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    monkeypatch.setattr(workspaces, "_supabase", lambda: db)
    ensure_owned_workspace(db, workspace_id, owner)

    _run(workspaces.delete_workspace(workspace_id, _user(owner)))

    with pytest.raises(HTTPException) as exc:
        ensure_owned_workspace(db, workspace_id, owner)
    assert exc.value.status_code == 404


def test_update_workspace_invalidates_ownership_cache(
    monkeypatch: pytest.MonkeyPatch, auth_settings: None
) -> None:
    owner, workspace_id = uuid4(), uuid4()
    db = _workspace_db(owner, workspace_id)
    monkeypatch.setattr(workspaces, "_supabase", lambda: db)
    assert ensure_owned_workspace(db, workspace_id, owner)["name"] == "Alpha"

    out = _run(
        workspaces.update_workspace(workspace_id, WorkspaceUpdate(name="Beta"), _user(owner))
    )

    assert out.name == "Beta"
    assert ensure_owned_workspace(db, workspace_id, owner)["name"] == "Beta"


# --- TTLCache ------------------------------------------------------------------


def test_ttl_cache_evicts_least_recently_used() -> None:
    clock = FakeClock()
    cache: TTLCache[str, int] = TTLCache(maxsize=2, clock=clock)
    cache.set("a", 1, ttl=10)
    cache.set("b", 2, ttl=10)
    assert cache.get("a") == 1
    cache.set("c", 3, ttl=10)
    assert cache.get("b") is None
    assert cache.get("a") == 1
    assert cache.get("c") == 3


def test_ttl_cache_purges_expired_before_evicting_live() -> None:
    clock = FakeClock()
    cache: TTLCache[str, int] = TTLCache(maxsize=2, clock=clock)
    cache.set("live", 1, ttl=100)
    cache.set("short", 2, ttl=1)
    clock.advance(2)
    cache.set("new", 3, ttl=100)
    assert cache.get("live") == 1
    assert cache.get("new") == 3
    assert len(cache) == 2
