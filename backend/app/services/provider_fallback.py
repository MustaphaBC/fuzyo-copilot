"""Cloud provider failover chain with a per-provider circuit breaker."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Final

from backend.app.core.config import settings
from backend.app.services.model_registry import PROVIDER_CATALOG

# Account-level failures (bad key, billing, forbidden, retired model) will not
# heal within a request; transient ones (rate limit, overload) usually do.
_ACCOUNT_ERROR_CODES: Final[frozenset[int]] = frozenset({401, 402, 403, 404})
_TRANSIENT_ERROR_CODES: Final[frozenset[int]] = frozenset({408, 429, 500, 502, 503, 504})

_open_until: dict[str, float] = {}


@dataclass(frozen=True)
class ProviderCandidate:
    provider: str
    model: str


def reset_provider_circuits() -> None:
    _open_until.clear()


def is_provider_open(provider: str) -> bool:
    """True while the provider is being skipped after a recent failure."""
    until = _open_until.get(provider)
    if until is None:
        return False
    if time.monotonic() >= until:
        _open_until.pop(provider, None)
        return False
    return True


def record_provider_failure(provider: str, status_code: int | None) -> None:
    """Skip ``provider`` for a while; longer for account-level errors."""
    if status_code in _ACCOUNT_ERROR_CODES:
        cooldown = settings.llm_provider_account_cooldown_s
    elif status_code in _TRANSIENT_ERROR_CODES or status_code is None:
        cooldown = settings.llm_provider_transient_cooldown_s
    else:
        return
    if cooldown > 0:
        _open_until[provider] = time.monotonic() + cooldown


def failure_reason(status_code: int | None) -> str:
    if status_code is None:
        return "provider_error"
    if status_code == 402:
        return "billing_402"
    return f"http_{status_code}"


def _has_key(key_attr: str) -> bool:
    return bool(str(getattr(settings, key_attr, "") or "").strip())


def fallback_candidates(*, exclude: set[str]) -> list[ProviderCandidate]:
    """Keyed, currently healthy providers in the configured failover order."""
    catalog = {item["provider"]: item for item in PROVIDER_CATALOG}
    order = [p.strip().lower() for p in settings.llm_fallback_order.split(",") if p.strip()]
    candidates: list[ProviderCandidate] = []
    for provider in order:
        item = catalog.get(provider)
        if item is None or provider in exclude:
            continue
        if not _has_key(item["key_attr"]) or is_provider_open(provider):
            continue
        candidates.append(ProviderCandidate(provider=provider, model=item["id"]))
    return candidates
