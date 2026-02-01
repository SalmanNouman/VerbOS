import os
import uuid
import logging
from abc import ABC
from typing import Literal
from langchain_core.messages import AIMessage, ToolMessage, SystemMessage, BaseMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_ollama import ChatOllama
from langchain_core.tools import BaseTool
from agent.state import GraphState, PendingAction
from tools.shell_tool import get_command_sensitivity

logger = logging.getLogger(__name__)


def get_tool_sensitivity(
    tool_name: str,
    tool_args: dict
) -> Literal["safe", "moderate", "sensitive"]:
    """Determines the sensitivity of a tool call for HITL purposes."""
    if tool_name in ("read_file", "list_directory"):
        return "safe"
    if tool_name in ("write_file", "create_directory", "delete_file"):
        return "sensitive"
    if tool_name == "get_system_info":
        return "safe"
    if tool_name == "execute_shell_command":
        command = tool_args.get("command", "")
        if not isinstance(command, str) or not command:
            return "sensitive"
        return get_command_sensitivity(command)
    
    code_tools = ["analyze_code", "generate_code", "refactor_code", "explain_code"]
    if tool_name in code_tools:
        return "safe"
    
    research_tools = ["summarize_context", "extract_facts", "analyze_code_context"]
    if tool_name in research_tools:
        return "safe"
    
    return "sensitive"


class WorkerResult:
    """Result from a worker's process method."""
    def __init__(
        self,
        messages: list[BaseMessage],
        pending_action: PendingAction | None = None,
        awaiting_approval: bool = False,
        task_complete: bool = False,
        task_summary: str | None = None,
    ):
        self.messages = messages
        self.pending_action = pending_action
        self.awaiting_approval = awaiting_approval
        self.task_complete = task_complete
        self.task_summary = task_summary


class BaseWorker(ABC):
    """Base class for all worker nodes in the graph."""

    def __init__(
        self,
        name: str,
        description: str,
        tools: list[BaseTool],
        system_prompt: str,
        use_local_model: bool = False,
    ):
        self.name = name
        self.description = description
        self.tools = tools
        self.system_prompt = system_prompt

        if use_local_model:
            self.model = ChatOllama(
                model="llama3.2",
                base_url="http://localhost:11434",
            )
        else:
            api_key = os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                raise ValueError("GOOGLE_API_KEY environment variable is not set")
            self.model = ChatGoogleGenerativeAI(
                model="gemini-2.0-flash",
                api_key=api_key,
            )

        self.model_with_tools = self.model.bind_tools(self.tools)

    def get_name(self) -> str:
        return self.name

    def get_description(self) -> str:
        return self.description

    async def process(self, state: GraphState) -> WorkerResult:
        """Process the current state and return updated messages."""
        messages = [
            SystemMessage(content=self.system_prompt),
            *state["messages"],
        ]
        logger.debug(f"Worker {self.name} processing {len(messages)} messages")

        try:
            response = await self.model_with_tools.ainvoke(messages)
            result_messages: list[BaseMessage] = [response]

            if hasattr(response, "tool_calls") and response.tool_calls:
                pending_action: PendingAction | None = None

                for tool_call in response.tool_calls:
                    logger.info(f"Worker {self.name} calling tool: {tool_call['name']}")

                    tool_id = tool_call.get("id") or str(uuid.uuid4())
                    tool_name = tool_call["name"]
                    tool_args = tool_call.get("args", {})

                    tool = next((t for t in self.tools if t.name == tool_name), None)

                    if not tool:
                        error_msg = f"Error: Tool {tool_name} not found"
                        logger.error(error_msg)
                        result_messages.append(ToolMessage(
                            tool_call_id=tool_id,
                            content=error_msg,
                        ))
                        continue

                    sensitivity = get_tool_sensitivity(tool_name, tool_args)

                    if sensitivity == "sensitive":
                        logger.info(f"Sensitive action detected for {tool_name}, awaiting approval")
                        pending_action = PendingAction(
                            id=tool_id,
                            worker_name=self.name,
                            tool_name=tool_name,
                            tool_args=tool_args,
                            sensitivity=sensitivity,
                            description=self._describe_action(tool_name, tool_args),
                        )
                        result_messages.append(ToolMessage(
                            tool_call_id=tool_id,
                            content="[Awaiting user approval]",
                        ))
                        # Stop processing more tools - handle one sensitive action at a time
                        # After approval, the worker will be called again to continue
                        break

                    try:
                        result = await tool.ainvoke(tool_args)
                        logger.debug(f"Tool {tool_name} returned result")
                        result_messages.append(ToolMessage(
                            tool_call_id=tool_id,
                            content=str(result) if not isinstance(result, str) else result,
                        ))
                    except Exception as e:
                        error_msg = str(e)
                        logger.error(f"Tool {tool_name} failed: {error_msg}")
                        result_messages.append(ToolMessage(
                            tool_call_id=tool_id,
                            content=f"Error: {error_msg}",
                        ))

                if pending_action:
                    return WorkerResult(
                        messages=result_messages,
                        pending_action=pending_action,
                        awaiting_approval=True,
                    )

            has_tool_calls = hasattr(response, "tool_calls") and response.tool_calls
            task_complete = not has_tool_calls
            task_summary = self._generate_task_summary(result_messages)

            return WorkerResult(
                messages=result_messages,
                pending_action=None,
                awaiting_approval=False,
                task_complete=task_complete,
                task_summary=task_summary,
            )

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Worker {self.name} error: {error_msg}")
            return WorkerResult(
                messages=[AIMessage(content=f"Worker {self.name} encountered an error: {error_msg}")],
                pending_action=None,
                awaiting_approval=False,
            )

    async def execute_pending_action(self, action: PendingAction) -> list[BaseMessage]:
        """Execute a pending action after user approval."""
        logger.info(f"Executing pending action: {action.tool_name} for worker {self.name}")
        tool = next((t for t in self.tools if t.name == action.tool_name), None)

        if not tool:
            return [ToolMessage(
                tool_call_id=action.id,
                content=f"Error: Tool {action.tool_name} not found",
            )]

        try:
            result = await tool.ainvoke(action.tool_args)
            return [ToolMessage(
                tool_call_id=action.id,
                content=str(result) if not isinstance(result, str) else result,
            )]
        except Exception as e:
            return [ToolMessage(
                tool_call_id=action.id,
                content=f"Error: {str(e)}",
            )]

    def _generate_task_summary(self, messages: list[BaseMessage]) -> str:
        """Generate a concise summary of tool executions for supervisor context."""
        summary_parts = []

        for msg in messages:
            if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls") and msg.tool_calls:
                for tc in msg.tool_calls:
                    args_preview = ", ".join(
                        f"{k}={str(v)[:30]}"
                        for k, v in list(tc.get("args", {}).items())[:2]
                    )
                    summary_parts.append(f"Called {tc['name']}({args_preview})")

            if isinstance(msg, ToolMessage):
                content = str(msg.content)
                preview = content[:100] + "..." if len(content) > 100 else content
                summary_parts.append(f"Result: {preview}")

        if summary_parts:
            return f"[{self.name}] {' | '.join(summary_parts)}"
        return f"[{self.name}] Processed request"

    def _describe_action(self, tool_name: str, args: dict) -> str:
        """Generate a human-readable description of an action for HITL UI."""
        if tool_name == "write_file":
            return f"Write to file: {args.get('path')}"
        if tool_name == "create_directory":
            return f"Create directory: {args.get('path')}"
        if tool_name == "delete_file":
            return f"Delete file: {args.get('path')}"
        if tool_name == "execute_shell_command":
            return f"Execute shell command: {args.get('command')}"
        return f"Execute {tool_name} with args: {args}"
