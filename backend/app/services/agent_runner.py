"""Intent interceptor for admin-only tool prompts (no full ReAct loop)."""

from __future__ import annotations

from backend.app.core.rbac import is_admin, match_admin_tool


def intercept_admin_tools(prompt: str, role: str | None) -> str | None:
    """
    Return the matched admin-only tool name when the user is not an admin.

    Admins pass through (returns None) so normal chat can proceed.
    Non-admins matching a restricted intent get the tool name for SSE lockout.
    """
    tool = match_admin_tool(prompt or "")
    if tool is None:
        return None
    if is_admin(role):
        return None
    return tool
