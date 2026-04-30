import subprocess
import platform
import re
from langchain_core.tools import tool
from agent.sensitivity import SensitivityLevel, classify_command
from tools.path_validation import validate_directory_path

SHELL_SECURITY_CONFIG = {
    "allowed_commands": [
        "npm", "npx", "yarn", "pnpm",
        "git",
        "ping", "curl", "wget",
        "ls", "dir", "cat", "type", "echo", "pwd",
        "ps", "tasklist", "whoami",
    ],
    "blocked_patterns": [
        r"\$\(",           # $(...) command substitution
        r"`[^`]*`",        # backtick command substitution
        r";",              # command separator
        r"&&",             # AND chaining
        r"\|\|",           # OR chaining
        r"\|",             # pipe
        r"\n",             # newline command separator
        r"rm\s+-rf",
        r"del\s+\/[sfq]",
        r"format\s+",
        r"mkfs",
        r"dd\s+if=",
        r">\s*\/dev\/",
        r"shutdown",
        r"reboot",
        r"halt",
        r"poweroff",
        r"init\s+0",
        r"kill\s+-9\s+-1",
        r"pkill\s+-9",
        r"chmod\s+777",
        r"chown\s+root",
        r"sudo",
        r"su\s+-",
        r"passwd",
        r"useradd",
        r"userdel",
        r"groupadd",
        r"visudo",
        r"crontab",
        r"systemctl",
        r"service\s+",
        r"registry",
        r"regedit",
        r"reg\s+(add|delete|import|export)",
    ],
    "timeout": 30,
    "max_output_size": 1024 * 100,  # 100KB
}


def validate_command(command: str) -> None:
    """Validates if a command is safe to execute."""
    if not command or not isinstance(command, str):
        raise ValueError("Validation Error: Command cannot be empty")

    trimmed_command = command.strip().lower()
    command_base = trimmed_command.split()[0]

    is_allowed = any(
        command_base == allowed.lower()
        for allowed in SHELL_SECURITY_CONFIG["allowed_commands"]
    )

    if not is_allowed:
        raise PermissionError(
            f"Security Violation: Command '{command_base}' is not in the whitelist. "
            f"Allowed commands: {', '.join(SHELL_SECURITY_CONFIG['allowed_commands'])}"
        )

    for pattern in SHELL_SECURITY_CONFIG["blocked_patterns"]:
        if re.search(pattern, command, re.IGNORECASE):
            raise PermissionError(
                "Security Violation: Command contains a blocked pattern. "
                "This operation is not permitted for security reasons."
            )


def get_command_sensitivity(command: str) -> SensitivityLevel:
    """
    Determines the sensitivity level of a command for HITL purposes.

    Thin wrapper around `agent.sensitivity.classify_command`. New code should
    import `classify_command` from `agent.sensitivity` directly; this alias
    is kept for backwards compatibility.
    """
    return classify_command(command)


@tool
def execute_shell_command(command: str, cwd: str | None = None) -> str:
    """
    Execute a shell command on the system. Only whitelisted commands are allowed.
    Returns the command output (stdout) or error message.
    """
    validate_command(command)

    shell_args = {
        "shell": True,
        "capture_output": True,
        "text": True,
        "timeout": SHELL_SECURITY_CONFIG["timeout"],
    }

    if cwd:
        validate_directory_path(cwd)
        shell_args["cwd"] = cwd

    if platform.system() == "Windows":
        shell_args["executable"] = "powershell.exe"

    try:
        result = subprocess.run(command, **shell_args)
        
        output = ""
        if result.stdout:
            output += result.stdout
        if result.stderr:
            output += ("\n\nStderr:\n" if output else "Stderr:\n") + result.stderr

        if len(output) > SHELL_SECURITY_CONFIG["max_output_size"]:
            output = output[:SHELL_SECURITY_CONFIG["max_output_size"]] + "\n... [truncated]"

        return output or "Command executed successfully (no output)"

    except subprocess.TimeoutExpired:
        raise TimeoutError(
            f"Execution Error: Command timed out after {SHELL_SECURITY_CONFIG['timeout']} seconds"
        )
    except FileNotFoundError:
        raise FileNotFoundError(f"Execution Error: Command not found: {command.split()[0]}")
    except Exception as e:
        raise RuntimeError(f"Execution Error: Command failed: {str(e)}")


def get_shell_tools():
    """Get all shell tools as a list."""
    return [execute_shell_command]
