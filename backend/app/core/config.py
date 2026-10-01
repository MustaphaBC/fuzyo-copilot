from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """Application settings loaded from environment variables / backend/.env."""

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Cloud LLM provider API keys
    groq_api_key: str = ""
    gemini_api_key: str = ""
    cerebras_api_key: str = ""
    sambanova_api_key: str = ""
    mistral_api_key: str = ""
    cohere_api_key: str = ""
    openrouter_api_key: str = ""

    # Supabase (2026: secret key replaces legacy service_role)
    supabase_url: str = ""
    supabase_secret_key: str = ""
    # JWT secret from Supabase Project Settings → API (backend only; HS256)
    supabase_jwt_secret: str = ""

    # In-process auth caches (token → user, user+workspace → ownership).
    # Seconds; 0 disables caching. Entries never outlive the token's exp.
    auth_cache_ttl_seconds: float = 20.0
    auth_cache_max_entries: int = 4096

    # Feature flags
    force_local_mock: bool = False

    # Hard ceiling on the whole privacy classification (primary + fallback);
    # exceeding it fails closed (LOCAL).
    privacy_classifier_timeout_s: float = 2.5
    privacy_classifier_cerebras_model: str = "qwen-3.8-27b"
    # Used when Cerebras is unavailable (no key, billing/auth error, timeout).
    # Empty disables the fallback.
    privacy_classifier_fallback_provider: str = "groq"
    privacy_classifier_groq_model: str = "openai/gpt-oss-20b"
    # Seconds a provider is skipped after a 401/402/403/404 answer.
    privacy_classifier_circuit_s: float = 300.0

    # Cloud chat failover: tried in order after the routed provider fails.
    llm_fallback_order: str = "groq,gemini,mistral,sambanova,cerebras,openrouter"
    # Seconds a failing provider is skipped (401/402/403/404 vs 429/5xx/network).
    llm_provider_account_cooldown_s: float = 300.0
    llm_provider_transient_cooldown_s: float = 30.0

    # Local host directory for workspace projects (empty → <repo>/workspace_projects)
    local_workspace_storage_path: str = ""

    # Observability
    sentry_dsn: str = ""
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.0


settings = Settings()
