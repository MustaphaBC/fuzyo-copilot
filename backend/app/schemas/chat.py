from enum import Enum, IntEnum

from pydantic import BaseModel, ConfigDict, Field


class SdlcPhase(IntEnum):
    """Nine Fuzyo SDLC phases (SFD-03)."""

    EXPRESSION_DU_BESOIN = 1
    ANALYSE_FONCTIONNELLE = 2
    ARCHITECTURE = 3
    GESTION_DE_PROJET = 4
    DEVELOPPEMENT = 5
    TESTS_QA = 6
    RECETTE = 7
    DEVOPS = 8
    MISE_EN_PRODUCTION = 9


class TargetClient(str, Enum):
    LOCAL_STUB = "LOCAL_STUB"
    CLOUD_API = "CLOUD_API"


class SkillMode(str, Enum):
    """Slash-skill modes for the Fuzyo skills engine (SFD)."""

    NONE = "none"
    PLAN = "plan"
    ANALYZE = "analyze"
    REVIEW = "review"
    DEBUG = "debug"


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1)
    sdlc_phase: SdlcPhase
    force_confidential: bool = False
    skill: SkillMode = SkillMode.NONE
    workspace_id: str | None = None
    model_override: str | None = None
    provider_override: str | None = None
    thread_id: str | None = None
    history_window: int = Field(default=6, ge=0, le=10)


class RouterDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_client: TargetClient
    selected_provider: str
    selected_model: str
    sensitivity_score: float = Field(ge=0.0, le=1.0)
    detected_secrets: list[str] = Field(default_factory=list)
    requires_rag: bool = False


class QualityScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_valid: bool
    tier1_schema_pass: bool
    tier2_heuristic_pass: bool
    tier3_score: int = Field(ge=1, le=10)
    feedback: str = ""
