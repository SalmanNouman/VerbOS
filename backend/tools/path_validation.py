import re
from pathlib import Path, PureWindowsPath
from urllib.parse import unquote

SECURITY_CONFIG = {
    "allowed_directories": [
        Path.home(),
        Path.cwd(),
    ],
    "blocked_paths": [
        "C:\\Windows",
        "C:\\Program Files",
        "C:\\Program Files (x86)",
        "C:\\ProgramData",
        "/etc",
        "/usr/bin",
        "/usr/sbin",
        "/bin",
        "/sbin",
        "/system",
    ],
}


def _is_within(path: Path, parent: Path) -> bool:
    """
    True if `path` is `parent` or a descendant of `parent`.
    Uses `Path.is_relative_to` to avoid string-prefix bypasses
    (e.g. `/home/snattack` "startswith" `/home/sn`).
    """
    try:
        return path == parent or path.is_relative_to(parent)
    except (ValueError, OSError):
        return False


def _resolved_allowed_directories() -> list[Path]:
    resolved: list[Path] = []
    for allowed in SECURITY_CONFIG["allowed_directories"]:
        try:
            resolved.append(allowed.resolve())
        except (OSError, RuntimeError):
            continue
    return resolved


def _is_blocked(path: Path) -> bool:
    """
    True if `path` falls under any configured blocked root.
    Blocked entries include Windows paths that are meaningless on Unix
    (and vice-versa); those simply won't match anything on the running platform,
    which is the intended behavior.
    """
    for blocked_str in SECURITY_CONFIG["blocked_paths"]:
        blocked = Path(blocked_str)
        if _is_within(path, blocked):
            return True
    return False


def _decode_requested_path(requested_path: str) -> str:
    if not isinstance(requested_path, str) or requested_path == "":
        raise ValueError("Path cannot be empty")
    if "\x00" in requested_path:
        raise ValueError("Path contains invalid characters")
    if re.search(r"%(?![0-9a-fA-F]{2})", requested_path):
        raise ValueError("Path contains invalid URL encoding")
    decoded_path = unquote(requested_path)
    if "\x00" in decoded_path:
        raise ValueError("Path contains invalid characters")
    return decoded_path


def _has_windows_anchor(path: str) -> bool:
    windows_path = PureWindowsPath(path)
    return bool(windows_path.drive or path.startswith("\\\\"))


def _reject_escape_components(path: Path) -> None:
    if any(part == ".." for part in path.parts):
        raise PermissionError("Security Violation: Path traversal is not permitted.")


def _resolve_requested_path(requested_path: str) -> Path:
    decoded_path = _decode_requested_path(requested_path)

    path = Path(decoded_path)
    _reject_escape_components(path)

    if not path.is_absolute():
        path = Path.home() / path

    resolved_path = path.resolve()

    # Reject Windows absolute/UNC paths only if they're not in allowed directories
    if _has_windows_anchor(str(resolved_path)):
        for allowed_dir in _resolved_allowed_directories():
            if _is_within(resolved_path, allowed_dir):
                return resolved_path
        raise PermissionError("Security Violation: Windows absolute paths are not permitted.")

    return resolved_path


def _ensure_allowed_path(real_path: Path) -> Path:
    if _is_blocked(real_path):
        raise PermissionError("Security Violation: Access to system directories is prohibited.")

    for allowed_dir in _resolved_allowed_directories():
        if _is_within(real_path, allowed_dir):
            return real_path

    raise PermissionError(
        "Security Violation: Access is restricted to the configured workspace."
    )


def validate_path(requested_path: str) -> Path:
    """Validate a readable existing path and return its resolved absolute path."""
    real_path = _resolve_requested_path(requested_path)
    real_path = _ensure_allowed_path(real_path)

    if not real_path.exists():
        raise FileNotFoundError("File System Error: The requested path does not exist.")

    return real_path


def validate_read_path(path: str) -> Path:
    """Validates a path for file reading operations."""
    validated_path = validate_path(path)

    if validated_path.is_dir():
        raise ValueError("Operation Failed: The requested path is a directory, not a file.")

    return validated_path


def validate_directory_path(path: str) -> Path:
    """Validates a path for directory listing operations."""
    validated_path = validate_path(path)

    if not validated_path.is_dir():
        raise ValueError("Operation Failed: The requested path is not a directory.")

    return validated_path


def validate_write_path(path: str) -> Path:
    """
    Validates a path for file writing operations.

    For existing targets, checks existence and enforces both the block-list
    and the allow-list directly. For new targets, validates
    the parent directory (which enforces allow-list transitively) and then
    re-checks the resolved path against both lists so the allow-list is never skipped.
    """
    resolved_path = _resolve_requested_path(path)

    if resolved_path.exists():
        _ensure_allowed_path(resolved_path)
        if resolved_path.is_dir():
            raise ValueError("Operation Failed: The requested path is a directory, not a file.")
        return resolved_path

    parent_dir = resolved_path.parent
    _ensure_allowed_path(parent_dir)
    if not parent_dir.is_dir():
        raise ValueError("Operation Failed: The parent directory does not exist.")

    return _ensure_allowed_path(resolved_path)
