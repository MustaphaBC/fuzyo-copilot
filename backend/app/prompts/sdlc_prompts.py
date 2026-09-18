"""FUZYO elite system prompts (5-component model) for the 9 SDLC phases."""

from __future__ import annotations

from types import MappingProxyType
from typing import Mapping, Sequence

from backend.app.prompts.sdlc_catalog import SDLC_CATALOG, get_phase

ELITE_PROMPT_MARKERS: tuple[str, ...] = (
    "[RÔLE]",
    "[CONTEXTE]",
    "[OBJECTIF]",
    "[CONTRAINTES]",
    "[FORMAT DE SORTIE]",
)

_BASE_CONSTRAINTS = (
    "Respecter Clean Architecture, DDD et SOLID lorsque du design ou du code est produit.",
    "Appliquer les standards de sécurité OWASP; ne jamais inventer de secrets ou credentials.",
    "Honorer RGPD / RGAA lorsque données personnelles ou interfaces utilisateur sont concernées.",
    "Typage strict et gestion explicite des erreurs asynchrones / modes offline quand applicable.",
    "Zéro placeholder (TODO, TBD vides, stubs incomplets); livrables complets et actionnables.",
    "Pas de filler conversationnel (pas de « Sure », « Voici mon code », salutations).",
)


def _format_stack(stack: Sequence[str] | str | None) -> str:
    if stack is None:
        return "non spécifiée"
    if isinstance(stack, str):
        text = stack.strip()
        return text or "non spécifiée"
    items = [str(item).strip() for item in stack if str(item).strip()]
    return ", ".join(items) if items else "non spécifiée"


def _format_deliverables(items: Sequence[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def build_elite_system_prompt(
    phase: int,
    *,
    project_name: str | None = None,
    stack: Sequence[str] | str | None = None,
    domain: str | None = None,
) -> str:
    """Compose a 5-component elite system prompt for the given SDLC phase."""
    entry = get_phase(phase)
    if entry is None:
        constraints = "\n".join(
            f"{i}. {c}" for i, c in enumerate(_BASE_CONSTRAINTS, start=1)
        )
        return (
            f"{ELITE_PROMPT_MARKERS[0]}\n"
            "Tu es l'assistant SDLC Fuzyo.\n\n"
            f"{ELITE_PROMPT_MARKERS[1]}\n"
            f"Phase SDLC inconnue: {phase}.\n\n"
            f"{ELITE_PROMPT_MARKERS[2]}\n"
            "Répondre de façon structurée et utile sans inventer de secrets.\n\n"
            f"{ELITE_PROMPT_MARKERS[3]}\n"
            f"{constraints}\n\n"
            f"{ELITE_PROMPT_MARKERS[4]}\n"
            "Markdown clair et actionnable."
        )

    project = (project_name or "").strip() or "Projet Fuzyo"
    domain_label = (domain or "").strip() or entry.domain_expertise
    stack_label = _format_stack(stack)
    deliverables = _format_deliverables(entry.expected_deliverables)
    constraints = "\n".join(
        f"{i}. {c}" for i, c in enumerate(_BASE_CONSTRAINTS, start=1)
    )
    extra = (
        f"{len(_BASE_CONSTRAINTS) + 1}. Prioriser les livrables catalogue de cette phase "
        "lorsqu'ils sont pertinents pour la requête."
    )

    return f"""{ELITE_PROMPT_MARKERS[0]}
Tu es un {entry.default_role}, expert dans {entry.domain_expertise}.

{ELITE_PROMPT_MARKERS[1]}
Projet : {project} ({domain_label}).
Phase SDLC : Phase {entry.id:02d} {entry.name}.
Question clé : {entry.key_question}
Stack & Environnement : {stack_label}.
Livrables attendus de la phase :
{deliverables}

{ELITE_PROMPT_MARKERS[2]}
{entry.objective}
Produit le livrable demandé par l'utilisateur en restant strictement dans le périmètre de la Phase {entry.id:02d}.

{ELITE_PROMPT_MARKERS[3]}
{constraints}
{extra}

{ELITE_PROMPT_MARKERS[4]}
{entry.output_format}
""".strip()


# Backward-compatible static map (default elite prompts without workspace context).
SDLC_PROMPTS: Mapping[int, str] = MappingProxyType(
    {phase: build_elite_system_prompt(phase) for phase in SDLC_CATALOG}
)
