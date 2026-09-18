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

    # Feature flags
    force_local_mock: bool = False

    # Local host directory for workspace projects (empty → <repo>/workspace_projects)
    local_workspace_storage_path: str = ""


settings = Settings()
