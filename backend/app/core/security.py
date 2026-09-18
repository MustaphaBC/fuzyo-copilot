"""Supabase JWT verification via JWKS (RS256/ES256) with HS256 fallback."""

from __future__ import annotations

import jwt
from jwt import PyJWKClient
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError, PyJWKClientError

from backend.app.core.config import settings

_ASYMMETRIC_ALGS = frozenset({"RS256", "ES256"})
_jwks_client: PyJWKClient | None = None
_jwks_url_cached: str | None = None


def _get_jwks_client() -> PyJWKClient:
    """Return a module-cached PyJWKClient for the configured Supabase project."""
    global _jwks_client, _jwks_url_cached

    base = (settings.supabase_url or "").strip().rstrip("/")
    if not base:
        raise ValueError("SUPABASE_URL is not configured")

    jwks_url = f"{base}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or _jwks_url_cached != jwks_url:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        _jwks_url_cached = jwks_url
    return _jwks_client


def _unverified_header(token: str) -> dict:
    raw = (token or "").strip()
    if not raw or raw.count(".") < 2:
        raise ValueError(
            "Access token is not a JWT (expected three dot-separated segments). "
            "Sign out and sign in again. "
            "If VITE_E2E_AUTH_BYPASS is enabled, disable it for normal local use."
        )
    try:
        return jwt.get_unverified_header(raw)
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid token header: {exc}") from exc


def _decode_via_jwks(token: str) -> dict:
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience="authenticated",
    )


def _decode_via_hs256(token: str) -> dict:
    secret = (settings.supabase_jwt_secret or "").strip()
    if not secret:
        raise ValueError("SUPABASE_JWT_SECRET is not configured")

    # Project ref from the URL is often pasted by mistake (short alphanumeric).
    if secret.isalnum() and 15 <= len(secret) <= 24 and secret.islower():
        raise ValueError(
            "SUPABASE_JWT_SECRET looks like a project ref, not the JWT Secret "
            "(Supabase → Project Settings → API → JWT Secret)"
        )

    return jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience="authenticated",
    )


def _should_try_jwks(header: dict) -> bool:
    if not (settings.supabase_url or "").strip():
        return False
    kid = header.get("kid")
    alg = str(header.get("alg") or "")
    return bool(kid) or alg in _ASYMMETRIC_ALGS


def decode_supabase_jwt(token: str) -> dict:
    """Decode and validate a Supabase Auth access token.

    Prefers JWKS (RS256/ES256) when the token has a kid / asymmetric alg.
    Falls back to legacy HS256 + SUPABASE_JWT_SECRET when JWKS is unavailable
    or the token is symmetric.

    Raises:
        ValueError: missing config or invalid/expired token.
    """
    header = _unverified_header(token)
    jwks_error: Exception | None = None

    if _should_try_jwks(header):
        try:
            return _decode_via_jwks(token)
        except ExpiredSignatureError as exc:
            raise ValueError("Token expired") from exc
        except (PyJWKClientError, InvalidTokenError, ValueError, OSError) as exc:
            jwks_error = exc

    try:
        return _decode_via_hs256(token)
    except ExpiredSignatureError as exc:
        raise ValueError("Token expired") from exc
    except InvalidTokenError as exc:
        if jwks_error is not None:
            raise ValueError(
                f"Invalid token (JWKS failed: {jwks_error}; HS256 failed: {exc})"
            ) from exc
        raise ValueError(f"Invalid token: {exc}") from exc
    except ValueError:
        # Missing/misconfigured HS256 secret — surface JWKS error if that was tried.
        if jwks_error is not None and not (settings.supabase_jwt_secret or "").strip():
            raise ValueError(f"JWKS verification failed: {jwks_error}") from jwks_error
        raise
