"""Supabase JWT verification via JWKS (RS256/ES256) with HS256 fallback."""

from __future__ import annotations

import jwt
from jwt import PyJWKClient
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError, PyJWKClientError

from backend.app.core.config import settings

_ASYMMETRIC_ALGS = frozenset({"RS256", "ES256"})
_jwks_client: PyJWKClient | None = None
_jwks_url_cached: str | None = None


class TokenRejectedError(ValueError):
    """Token is definitively invalid: malformed, unsigned, bad signature, expired, wrong aud."""


class LocalVerificationUnavailableError(ValueError):
    """Signature could not be checked locally (missing key material / unsupported alg).

    Callers may defer to Supabase Auth; the token must not be trusted as-is.
    """


def _get_jwks_client() -> PyJWKClient:
    """Return a module-cached PyJWKClient for the configured Supabase project."""
    global _jwks_client, _jwks_url_cached

    base = (settings.supabase_url or "").strip().rstrip("/")
    if not base:
        raise LocalVerificationUnavailableError("SUPABASE_URL is not configured")

    jwks_url = f"{base}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or _jwks_url_cached != jwks_url:
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        _jwks_url_cached = jwks_url
    return _jwks_client


def _unverified_header(token: str) -> dict:
    raw = (token or "").strip()
    if not raw or raw.count(".") < 2:
        raise TokenRejectedError(
            "Access token is not a JWT (expected three dot-separated segments). "
            "Sign out and sign in again. "
            "If VITE_E2E_AUTH_BYPASS is enabled, disable it for normal local use."
        )
    try:
        return jwt.get_unverified_header(raw)
    except Exception as exc:  # noqa: BLE001
        raise TokenRejectedError(f"Invalid token header: {exc}") from exc


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
        raise LocalVerificationUnavailableError("SUPABASE_JWT_SECRET is not configured")

    # Project ref from the URL is often pasted by mistake (short alphanumeric).
    if secret.isalnum() and 15 <= len(secret) <= 24 and secret.islower():
        raise LocalVerificationUnavailableError(
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

    Failure policy:
        * ``TokenRejectedError`` — malformed token, ``alg: none``, expired,
          bad signature / audience from a key we hold (JWKS key for an
          asymmetric token, configured secret for an HS256 token).
        * ``LocalVerificationUnavailableError`` — no usable key material
          (no secret, JWKS unreachable / kid unknown) or an algorithm we
          cannot verify locally.

    Raises:
        ValueError: both error types above subclass it.
    """
    header = _unverified_header(token)
    alg = str(header.get("alg") or "")
    if alg.lower() in {"", "none"}:
        raise TokenRejectedError("Unsigned tokens are not accepted")

    jwks_error: Exception | None = None
    jwks_rejected = False

    if _should_try_jwks(header):
        try:
            return _decode_via_jwks(token)
        except ExpiredSignatureError as exc:
            raise TokenRejectedError("Token expired") from exc
        except (PyJWKClientError, ValueError, OSError) as exc:
            jwks_error = exc
        except InvalidTokenError as exc:
            jwks_error = exc
            jwks_rejected = alg in _ASYMMETRIC_ALGS

    try:
        return _decode_via_hs256(token)
    except ExpiredSignatureError as exc:
        raise TokenRejectedError("Token expired") from exc
    except InvalidTokenError as exc:
        if jwks_error is not None:
            message = f"Invalid token (JWKS failed: {jwks_error}; HS256 failed: {exc})"
        else:
            message = f"Invalid token: {exc}"
        if jwks_rejected or alg == "HS256":
            raise TokenRejectedError(message) from exc
        raise LocalVerificationUnavailableError(message) from exc
    except LocalVerificationUnavailableError as exc:
        if jwks_rejected:
            raise TokenRejectedError(f"Invalid token: {jwks_error}") from exc
        # Missing/misconfigured HS256 secret — surface JWKS error if that was tried.
        if jwks_error is not None and not (settings.supabase_jwt_secret or "").strip():
            raise LocalVerificationUnavailableError(
                f"JWKS verification failed: {jwks_error}"
            ) from jwks_error
        raise
