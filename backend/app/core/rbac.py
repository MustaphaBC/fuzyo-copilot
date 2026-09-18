"""Role-based access helpers for Fuzyo Copilot."""

from __future__ import annotations

import re
from typing import Final

ROLES: Final[frozenset[str]] = frozenset(
    {"developer", "tech_lead", "product_owner", "admin"}
)

ADMIN_ONLY_TOOLS: Final[dict[str, dict[str, object]]] = {
    "deploy_to_production": {
        "admin_only": True,
        "patterns": (
            r"\bdeploy(?:\s+to)?\s+production\b",
            r"\bproduction\s+deploy(?:ment)?\b",
            r"\bship\s+to\s+prod(?:uction)?\b",
        ),
    },
    "purge_workspace_rag": {
        "admin_only": True,
        "patterns": (
            r"\bpurge\s+(?:workspace\s+)?rag\b",
            r"\bdelete\s+all\s+(?:rag\s+)?(?:chunks|embeddings|vectors)\b",
            r"\bclear\s+(?:the\s+)?vector\s+store\b",
        ),
    },
}


def normalize_role(role: str | None) -> str:
    value = (role or "developer").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "techlead": "tech_lead",
        "productowner": "product_owner",
        "po": "product_owner",
        "tl": "tech_lead",
    }
    value = aliases.get(value, value)
    return value if value in ROLES else "developer"


def is_admin(role: str | None) -> bool:
    return normalize_role(role) == "admin"


def match_admin_tool(prompt: str) -> str | None:
    """Return admin-only tool name if prompt matches a restricted intent."""
    text = prompt or ""
    for tool_name, meta in ADMIN_ONLY_TOOLS.items():
        if not meta.get("admin_only"):
            continue
        patterns = meta.get("patterns") or ()
        for pattern in patterns:
            if re.search(str(pattern), text, re.IGNORECASE):
                return tool_name
    return None
