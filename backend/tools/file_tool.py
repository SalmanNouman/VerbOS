import json
from pathlib import Path
from langchain_core.tools import tool
from tools.path_validation import (
    validate_read_path,
    validate_write_path,
    validate_directory_path,
)

MAX_FILE_SIZE = 1024 * 1024  # 1MB limit
MAX_WRITE_SIZE = 1024 * 1024  # 1MB limit


@tool
def list_directory(path: str) -> str:
    """List the contents of a directory. Returns an array of file and directory names."""
    validated_path = validate_directory_path(path)
    items = []
    
    for item in validated_path.iterdir():
        entry = {
            "name": item.name,
            "type": "directory" if item.is_dir() else "file",
        }
        if item.is_file():
            entry["size"] = item.stat().st_size
        items.append(entry)
    
    return json.dumps(items, indent=2)


@tool
def read_file(path: str, encoding: str = "utf-8") -> str:
    """Read the contents of a text file. Returns the file content as a string."""
    validated_path = validate_read_path(path)
    file_size = validated_path.stat().st_size
    
    if file_size > MAX_FILE_SIZE:
        raise ValueError(
            f"Validation Error: File too large ({file_size // 1024}KB). "
            f"Maximum allowed size is {MAX_FILE_SIZE // 1024}KB."
        )
    
    return validated_path.read_text(encoding=encoding)


@tool
def write_file(path: str, content: str, encoding: str = "utf-8") -> str:
    """Write content to a file. Creates the file if it doesn't exist, overwrites if it does."""
    content_size = len(content.encode(encoding))
    
    if content_size > MAX_WRITE_SIZE:
        raise ValueError(
            f"Validation Error: Content too large ({content_size // 1024}KB). "
            f"Maximum allowed size is {MAX_WRITE_SIZE // 1024}KB."
        )
    
    sanitized_path = validate_write_path(path)
    Path(sanitized_path).write_text(content, encoding=encoding)
    return f"Successfully wrote to file: {sanitized_path}"


@tool
def create_directory(path: str) -> str:
    """Create a new directory."""
    validated_path = validate_write_path(path)
    validated_path.mkdir(parents=True, exist_ok=True)
    return f"Successfully created directory: {validated_path}"


@tool
def delete_file(path: str) -> str:
    """Delete a file from the file system. Use with caution."""
    validated_path = validate_read_path(path)
    validated_path.unlink()
    return f"Successfully deleted file: {validated_path}"


def get_file_tools():
    """Get all file tools as a list."""
    return [list_directory, read_file, write_file, create_directory, delete_file]
