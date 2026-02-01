from langchain_core.tools import tool
from agent.workers.base_worker import BaseWorker
from tools.file_tool import read_file, write_file, list_directory


@tool
def analyze_code(code: str, language: str | None = None, focus_areas: list[str] | None = None) -> str:
    """Analyze code for structure, quality, potential bugs, and improvements."""
    if focus_areas is None:
        focus_areas = ["all"]
    lang_info = f" ({language})" if language else ""
    focus = "all aspects" if "all" in focus_areas else ", ".join(focus_areas)
    return f"Analyze the following code{lang_info} focusing on {focus}:\n\n{code}"


@tool
def generate_code(requirements: str, language: str, style: str = "documented") -> str:
    """Generate code based on requirements or specifications."""
    return f"Generate {style} {language} code for: {requirements}"


@tool
def refactor_code(code: str, goals: list[str] | None = None) -> str:
    """Suggest refactoring improvements for existing code."""
    if goals is None:
        goals = ["readability"]
    return f"Suggest refactoring for the following code to improve {', '.join(goals)}:\n\n{code}"


@tool
def explain_code(code: str, detail_level: str = "detailed") -> str:
    """Explain what a piece of code does in plain language."""
    return f"Explain the following code ({detail_level}):\n\n{code}"


class CodeWorker(BaseWorker):
    """Code Worker is specialized in code analysis and generation."""

    def __init__(self):
        tools = [
            analyze_code,
            generate_code,
            refactor_code,
            explain_code,
            read_file,
            write_file,
            list_directory,
        ]

        super().__init__(
            name="code_worker",
            description="Handles code analysis, generation, refactoring, and explanation.",
            tools=tools,
            system_prompt="""You are a Code Worker, a specialized agent for code-related tasks.

Your capabilities:
- Analyze code for bugs, performance, security, and style (analyze_code)
- Generate code from requirements (generate_code)
- Suggest refactoring improvements (refactor_code)
- Explain code in plain language (explain_code)
- Read files to get code context (read_file)
- Write code to files (write_file)
- List directories to explore project structure (list_directory)

Guidelines:
1. Always consider best practices for the target language.
2. Provide actionable suggestions, not just observations.
3. When generating code, include necessary imports and error handling.
4. Consider edge cases and potential issues.
5. Format code properly with appropriate indentation.
6. Use read_file to fetch code content before analyzing it.

When you complete your task, provide the code or analysis with clear explanations.""",
        )
