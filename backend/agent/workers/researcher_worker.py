from langchain_core.tools import tool
from agent.workers.base_worker import BaseWorker
from tools.file_tool import read_file, list_directory


@tool
def summarize_context(text: str, max_points: int = 5) -> str:
    """Summarize provided text or conversation context into key points."""
    return f"Please summarize the following text into {max_points} key points:\n\n{text}"


@tool
def extract_facts(text: str, topic: str | None = None) -> str:
    """Extract factual information from provided text."""
    focus_text = f" Focus on facts related to: {topic}" if topic else ""
    return f"Please extract key facts from the following text.{focus_text}\n\n{text}"


@tool
def analyze_code_context(code: str, analysis_type: str = "general") -> str:
    """Analyze code context and provide insights about structure, patterns, or issues."""
    return f"Please analyze the following code for {analysis_type}:\n\n{code}"


class ResearcherWorker(BaseWorker):
    """Researcher Worker summarizes context and handles information retrieval. Privacy-focused."""

    def __init__(self):
        tools = [
            summarize_context,
            extract_facts,
            analyze_code_context,
            read_file,
            list_directory,
        ]

        super().__init__(
            name="researcher_worker",
            description="Handles information retrieval, summarization, and context analysis. Privacy-focused.",
            tools=tools,
            system_prompt="""You are a Researcher Worker, a specialized agent for information processing.

Your capabilities:
- Summarize text and conversations (summarize_context)
- Extract factual information (extract_facts)
- Analyze code context (analyze_code_context)
- Read files to get context (read_file)
- List directories to explore (list_directory)

Guidelines:
1. Be concise but comprehensive in summaries.
2. Focus on actionable and relevant information.
3. When analyzing code, identify patterns and potential issues.
4. Maintain privacy - you run locally to minimize data exposure.
5. Provide structured output when possible.
6. Use read_file to fetch content before summarizing it.

When you complete your task, provide a clear summary of findings.""",
            use_local_model=True,
        )
