from pathlib import Path

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


def validate_path(requested_path: str) -> Path:
    """
    Validates if a path is safe to access.
    Returns the validated absolute path.
    Raises ValueError if path is not allowed.
    """
    if not requested_path:
        raise ValueError("Path cannot be empty")

    path = Path(requested_path)

    if not path.is_absolute():
        path = Path.home() / requested_path

    real_path = path.resolve()

    if not real_path.exists():
        raise FileNotFoundError(f"File System Error: The path '{real_path}' does not exist.")

    if _is_blocked(real_path):
        raise PermissionError(
            f"Security Violation: Access to system directory '{real_path}' is strictly prohibited."
        )

    for allowed_dir in _resolved_allowed_directories():
        if _is_within(real_path, allowed_dir):
            return real_path

    raise PermissionError(
        f"Security Violation: Access to '{real_path}' is denied. "
        "Operations are restricted to the User Home Directory and the Project Directory."
    )


def validate_read_path(path: str) -> Path:
    """Validates a path for file reading operations."""
    validated_path = validate_path(path)

    if validated_path.is_dir():
        raise ValueError(f"Operation Failed: The path '{validated_path}' is a directory, not a file.")

    return validated_path


def validate_directory_path(path: str) -> Path:
    """Validates a path for directory listing operations."""
    validated_path = validate_path(path)

    if not validated_path.is_dir():
        raise ValueError(f"Operation Failed: The path '{validated_path}' is not a directory.")

    return validated_path


def validate_write_path(path: str) -> Path:
    """
    Validates a path for file writing operations.

    For existing targets, delegates to `validate_path` which enforces both
    the block-list and the allow-list. For new targets, validates the parent
    directory (which enforces allow-list transitively) and then re-checks
    the resolved path against both lists so the allow-list is never skipped.
    """
    if not path:
        raise ValueError("Path cannot be empty")

    file_path = Path(path)

    if not file_path.is_absolute():
        file_path = Path.home() / path

    resolved_path = file_path.resolve()

    if resolved_path.exists():
        return validate_path(str(resolved_path))

    parent_dir = resolved_path.parent
    try:
        validate_directory_path(str(parent_dir))
    except FileNotFoundError:
        raise ValueError(f"Operation Failed: The parent directory '{parent_dir}' does not exist.")

    if _is_blocked(resolved_path):
        raise PermissionError(
            f"Security Violation: Access to system directory '{resolved_path}' is strictly prohibited."
        )

    for allowed_dir in _resolved_allowed_directories():
        if _is_within(resolved_path, allowed_dir):
            return resolved_path

    raise PermissionError(
        f"Security Violation: Access to '{resolved_path}' is denied. "
        "Operations are restricted to the User Home Directory and the Project Directory."
    )
