import os
import platform
import logging
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage, BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from agent.state import (
    GraphState,
    WORKER_NAMES,
    NODE_NAMES,
    MAX_ITERATIONS,
    MAX_TOOL_OUTPUT_LENGTH,
    MAX_MESSAGES_FOR_SUPERVISOR,
)

logger = logging.getLogger(__name__)


class SupervisorDecision(BaseModel):
    """Structured output schema for supervisor routing decisions."""
    reasoning: str = Field(description="Brief explanation of the routing decision")
    next: Literal[
        "filesystem_worker",
        "system_worker",
        "researcher_worker",
        "code_worker",
        "FINISH",
    ] = Field(description="The next worker to route to, or FINISH if the task is complete")
    final_response: str | None = Field(
        default=None,
        description="Final response to the user (only if next is FINISH)"
    )


class Supervisor:
    """Supervisor Node - Central orchestrator that routes tasks to specialized workers."""

    def __init__(self, model=None):
        if model:
            self.model = model
        else:
            api_key = os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY environment variable is not set")
            self.model = ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                api_key=api_key,
            )

    def _build_system_prompt(self) -> str:
        home = str(Path.home())
        return f"""You are the Supervisor of VerbOS, an AI assistant with deep OS integration.
Your role is to analyze user requests and route them to the appropriate specialized worker.

Available Workers:
1. {WORKER_NAMES['FILESYSTEM']} - Handles file operations: reading, writing, listing files/directories
2. {WORKER_NAMES['SYSTEM']} - Handles system info and shell commands (npm, git, ping, etc.)
3. {WORKER_NAMES['RESEARCHER']} - Handles summarization, information extraction, context analysis (privacy-focused, runs locally)
4. {WORKER_NAMES['CODE']} - Handles code analysis, generation, refactoring, and explanation

Environment:
- Platform: {platform.system()}
- User Home: {home}

Routing Guidelines:
1. For file read/write/list operations -> {WORKER_NAMES['FILESYSTEM']}
2. For system info, npm/git commands, network diagnostics -> {WORKER_NAMES['SYSTEM']}
3. For summarizing content, extracting facts, analyzing context -> {WORKER_NAMES['RESEARCHER']}
4. For code analysis, generation, refactoring, explanation -> {WORKER_NAMES['CODE']}
5. For complex tasks, route to workers in sequence (e.g., read file -> analyze code)

Decision Rules:
- If a worker has just completed a task and the overall goal is achieved, choose FINISH
- If a worker's output needs to be processed by another worker, route accordingly
- If the user's request is a simple question that doesn't need tools, choose FINISH and provide the answer
- Always provide a finalResponse when choosing FINISH
- IMPORTANT: When finishing, include the relevant data/results from tool outputs in your finalResponse. Do not just say "I listed the files" - actually include the file list or summary of results.

Analyze the conversation history to understand:
1. What the user originally requested
2. What workers have already done
3. What still needs to be done"""

    async def route(self, state: GraphState) -> dict:
        """Process the current state and decide the next routing action."""
        if state["iteration_count"] >= MAX_ITERATIONS:
            return {
                "next": NODE_NAMES["END"],
                "final_response": "I apologize, but I reached the maximum number of steps for this task. Please try breaking down your request into smaller parts.",
                "current_worker": None,
            }

        if state.get("error"):
            return {
                "next": NODE_NAMES["END"],
                "final_response": f"An error occurred: {state['error']}",
                "current_worker": None,
            }

        filtered_messages = self._filter_messages_for_supervisor(state["messages"])
        pruned_messages = self._prune_messages(filtered_messages, MAX_MESSAGES_FOR_SUPERVISOR)

        context_messages = pruned_messages
        if state.get("task_summary"):
            context_messages = [
                HumanMessage(content=f"[Previous Task Summary]: {state['task_summary']}"),
                *pruned_messages,
            ]

        messages = [
            SystemMessage(content=self._build_system_prompt()),
            *context_messages,
            HumanMessage(content="Based on the conversation above, decide the next action. If the task is complete, provide a final response."),
        ]

        try:
            model_with_structured_output = self.model.with_structured_output(SupervisorDecision)
            decision: SupervisorDecision = await model_with_structured_output.ainvoke(messages)

            logger.info(f"Decision: {decision.next} - {decision.reasoning}")

            if decision.next == "FINISH":
                return {
                    "next": NODE_NAMES["END"],
                    "final_response": decision.final_response or "Task completed.",
                    "current_worker": None,
                }

            return {
                "next": decision.next,
                "final_response": None,
                "current_worker": decision.next,
            }

        except Exception as e:
            logger.error(f"Error making decision: {e}")
            return {
                "next": NODE_NAMES["END"],
                "final_response": "I encountered an error while processing your request. Please try again.",
                "current_worker": None,
            }

    def _filter_messages_for_supervisor(self, messages: list[BaseMessage]) -> list[BaseMessage]:
        """Filter messages for supervisor context by truncating verbose tool outputs."""
        filtered = []
        for msg in messages:
            if isinstance(msg, ToolMessage):
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                if len(content) > MAX_TOOL_OUTPUT_LENGTH:
                    filtered.append(ToolMessage(
                        tool_call_id=msg.tool_call_id,
                        content=content[:MAX_TOOL_OUTPUT_LENGTH] + "... [truncated]",
                    ))
                else:
                    filtered.append(msg)
            else:
                filtered.append(msg)
        return filtered

    def _prune_messages(self, messages: list[BaseMessage], max_count: int) -> list[BaseMessage]:
        """Prune messages to prevent context overflow, keeping most recent messages."""
        if len(messages) <= max_count:
            return messages
        return messages[-max_count:]
