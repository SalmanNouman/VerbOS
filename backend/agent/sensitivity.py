"""
Single source of truth for action sensitivity classification.

Callers ask "how risky is this tool call?" and get back one of three levels:

  - "safe":      auto-execute without any user friction
  - "moderate":  auto-execute but surface prominently in the UI; callers that
                 want a stricter posture can treat this as approval-required
  - "sensitive": always require explicit HITL approval

Historically this logic was split between `agent.workers.base_worker` and
`tools.shell_tool`, and the `"moderate"` level was dead code (both callers
only ever returned `"safe"` or `"sensitive"`, collapsing the taxonomy to
binary). This module centralizes it so the levels have real meaning and a
single place to evolve.
"""

from typing import Literal

SensitivityLevel = Literal["safe", "moderate", "sensitive"]


# Tools that only read from the filesystem / system.
_READ_ONLY_TOOLS: frozenset[str] = frozenset({
    "read_file",
    "list_directory",
    "get_system_info",
})

# Tools that mutate user state — always require approval.
_MUTATING_TOOLS: frozenset[str] = frozenset({
    "write_file",
    "create_directory",
    "delete_file",
})

# Tools whose side effects are local-only (reasoning over context).
_ANALYSIS_TOOLS: frozenset[str] = frozenset({
    "analyze_code",
    "generate_code",
    "refactor_code",
    "explain_code",
    "summarize_context",
    "extract_facts",
    "analyze_code_context",
})


# Shell commands classified by risk.
_SAFE_COMMAND_BASES: frozenset[str] = frozenset({
    "ls", "dir", "cat", "type", "echo", "pwd",
    "ps", "tasklist", "whoami", "ping",
})

# Base commands that are "moderate" by default, with subcommands that can be
# downgraded to "safe" (pure read-only operations).
_MODERATE_COMMAND_BASES: frozenset[str] = frozenset({
    "git", "npm", "npx", "yarn", "pnpm", "pip", "curl", "wget",
})

# Subcommands are only "safe" if they're strictly read-only. Mutating subcommands
# like `git config core.hooksPath <evil>` or `git reset --hard` must fall through
# to the "sensitive" default so HITL can gate them.
_SAFE_SUBCOMMANDS: dict[str, frozenset[str]] = {
    "git": frozenset({
        "status", "log", "diff", "branch", "remote", "show",
        "ls-files", "ls-tree",
    }),
    "npm": frozenset({"list", "ls", "view", "info", "search", "outdated", "audit"}),
    "yarn": frozenset({"list", "info", "audit", "outdated"}),
    "pnpm": frozenset({"list", "ls", "view", "info", "outdated", "audit"}),
    "pip": frozenset({"list", "show", "search"}),
}


def classify_command(command: str) -> SensitivityLevel:
    """
    Classify a shell command string by sensitivity.

    Returns:
        "safe":       pure read-only commands with no shell operators
                      (`ls`, `cat foo`, `git status`, `npm list`).
        "moderate":   network-egress commands that don't mutate local state
                      (`curl http://...`, `wget http://...`).
        "sensitive":  anything that mutates state, uses shell operators that
                      can escape the base command (`>`, `|`, `;`, backticks,
                      `$(...)`, etc.), has a mutating subcommand (`git push`,
                      `npm install`, `git config <write>`), or is unknown.
    """
    if not command or not isinstance(command, str):
        return "sensitive"

    trimmed = command.strip().lower()
    if not trimmed:
        return "sensitive"

    command_base = trimmed.split()[0]

    # Output redirection (>, >>), pipes, and command substitution can write to
    # disk or invoke an arbitrary second command, so they must always require
    # HITL approval — even when the base command looks read-only.
    if _has_unsafe_shell_operators(trimmed):
        return "sensitive"

    if command_base in _SAFE_COMMAND_BASES:
        return "safe"

    if command_base in _MODERATE_COMMAND_BASES:
        parts = trimmed.split()
        subcommand = parts[1] if len(parts) > 1 else None

        safe_subcommands = _SAFE_SUBCOMMANDS.get(command_base, frozenset())
        if subcommand in safe_subcommands:
            return "safe"

        # curl/wget are "moderate": they egress data and can be used to fetch
        # scripts, but by themselves don't execute arbitrary code locally.
        if command_base in {"curl", "wget"}:
            return "moderate"

        # Package-manager install / git mutate / etc. — always sensitive.
        return "sensitive"

    return "sensitive"


# Shell metacharacters that let a command escape its base operation (write to
# disk, pipe into another binary, or run a substituted command). Presence of
# any of these flips classification to "sensitive" regardless of command_base.
_UNSAFE_SHELL_OPERATORS: tuple[str, ...] = (
    ">", "<", "|", ";", "&", "`", "$(",
)


def _has_unsafe_shell_operators(command: str) -> bool:
    return any(op in command for op in _UNSAFE_SHELL_OPERATORS)


def classify_tool(tool_name: str, tool_args: dict | None = None) -> SensitivityLevel:
    """
    Classify a tool call by sensitivity.

    This is the single function that HITL logic should consult. All callers
    (worker nodes, shell tool, tests) go through here so the taxonomy has
    one owner.
    """
    if tool_name in _READ_ONLY_TOOLS:
        return "safe"

    if tool_name in _ANALYSIS_TOOLS:
        return "safe"

    if tool_name in _MUTATING_TOOLS:
        return "sensitive"

    if tool_name == "execute_shell_command":
        command = (tool_args or {}).get("command", "")
        if not isinstance(command, str) or not command:
            return "sensitive"
        return classify_command(command)

    # Unknown tool: conservative default.
    return "sensitive"
