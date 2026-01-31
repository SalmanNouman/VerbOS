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
    
    path = path.resolve()
    
    if not path.exists():
        raise FileNotFoundError(f"File System Error: The path '{path}' does not exist.")
    
    real_path = path.resolve()
    
    for blocked in SECURITY_CONFIG["blocked_paths"]:
        if str(real_path).lower().startswith(blocked.lower()):
            raise PermissionError(
                f"Security Violation: Access to system directory '{real_path}' is strictly prohibited."
            )
    
    is_allowed = False
    for allowed_dir in SECURITY_CONFIG["allowed_directories"]:
        try:
            resolved_allowed = allowed_dir.resolve()
            if str(real_path).lower().startswith(str(resolved_allowed).lower()):
                is_allowed = True
                break
        except Exception:
            continue
    
    if not is_allowed:
        raise PermissionError(
            f"Security Violation: Access to '{real_path}' is denied. "
            "Operations are restricted to the User Home Directory and the Project Directory."
        )
    
    return real_path


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


def sanitize_path_component(component: str) -> str:
    """Sanitize a single path component to prevent injection."""
    dangerous_chars = ['..', '/', '\\', '\x00', '\n', '\r']
    sanitized = component
    for char in dangerous_chars:
        sanitized = sanitized.replace(char, '_')
    return sanitized


def validate_write_path(path: str) -> Path:
    """
    Validates and sanitizes a path for file writing operations.
    Returns a safe path constructed from validated components.
    """
    if not path:
        raise ValueError("Path cannot be empty")

    file_path = Path(path)
    
    if not file_path.is_absolute():
        file_path = Path.home() / path
    
    resolved_path = file_path.resolve()
    parent_dir = resolved_path.parent
    
    try:
        validate_directory_path(str(parent_dir))
    except FileNotFoundError:
        raise ValueError(f"Operation Failed: The parent directory '{parent_dir}' does not exist.")
    
    if resolved_path.exists():
        return validate_path(str(resolved_path))

    sanitized_filename = sanitize_path_component(resolved_path.name)
    if sanitized_filename != resolved_path.name:
        raise ValueError(
            "Operation Failed: The file name contains invalid characters."
        )

    for blocked in SECURITY_CONFIG["blocked_paths"]:
        if str(resolved_path).lower().startswith(blocked.lower()):
            raise PermissionError(
                f"Security Violation: Access to system directory '{resolved_path}' is strictly prohibited."
            )

    return resolved_path
