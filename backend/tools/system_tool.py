import json
import platform
import os
import psutil
from langchain_core.tools import tool


@tool
def get_system_info() -> str:
    """Get information about the current operating system and environment."""
    info = {
        "platform": platform.system(),
        "arch": platform.machine(),
        "os_release": platform.release(),
        "hostname": platform.node(),
        "home_directory": str(os.path.expanduser("~")),
        "temp_directory": os.environ.get("TEMP", os.environ.get("TMPDIR", "/tmp")),
        "memory": {
            "total": f"{psutil.virtual_memory().total // (1024 * 1024)} MB",
            "free": f"{psutil.virtual_memory().available // (1024 * 1024)} MB",
        },
        "cpu": {
            "model": platform.processor() or "Unknown",
            "cores": psutil.cpu_count(),
        },
    }
    
    if platform.system() == "Windows":
        info["windows_info"] = {
            "version": platform.version(),
            "edition": platform.win32_edition() if hasattr(platform, "win32_edition") else "Unknown",
        }
    
    return json.dumps(info, indent=2)


def get_system_tools():
    """Get all system tools as a list."""
    return [get_system_info]
