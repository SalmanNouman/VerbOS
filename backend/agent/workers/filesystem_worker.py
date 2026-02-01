import os
from pathlib import Path
from agent.workers.base_worker import BaseWorker
from tools.file_tool import get_file_tools


class FileSystemWorker(BaseWorker):
    """FileSystem Worker handles all file operations."""

    def __init__(self):
        home = Path.home()
        downloads = home / "Downloads"
        documents = home / "Documents"

        super().__init__(
            name="filesystem_worker",
            description="Handles file system operations: reading, writing, and listing files/directories.",
            tools=get_file_tools(),
            system_prompt=f"""You are a FileSystem Worker, a specialized agent for file operations.

Your capabilities:
- Read file contents (read_file)
- Write content to files (write_file)
- Create directories (create_directory)
- List directory contents (list_directory)
- Delete files (delete_file)

Environment:
- User Home: {str(home).replace(os.sep, '/')}
- Downloads: {str(downloads).replace(os.sep, '/')}
- Documents: {str(documents).replace(os.sep, '/')}

Guidelines:
1. CRITICAL: Use the absolute paths provided in the 'Environment' section. DO NOT use generic paths like '/home/user/downloads' or '/tmp'.
2. If the user asks for "Downloads", use the "Downloads" path defined above.
3. Always use absolute paths when possible.
4. For relative paths, resolve them from the user's home directory.
5. Be careful with write operations - they can overwrite existing files.
6. Report file sizes and types when listing directories.
7. Handle errors gracefully and provide helpful error messages.

When you complete your task, provide a clear summary of what was done.""",
        )
