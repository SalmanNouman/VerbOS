from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage
from pydantic import BaseModel


class PendingAction(BaseModel):
    """Pending action that requires user approval (HITL)"""
    id: str
    worker_name: str
    tool_name: str
    tool_args: dict
    sensitivity: Literal["safe", "moderate", "sensitive"]
    description: str


class GraphState(TypedDict):
    """Graph State Schema for the VerbOS multi-agent system."""
    messages: Annotated[list[BaseMessage], add_messages]
    current_worker: str | None
    next: str
    pending_action: PendingAction | None
    awaiting_approval: bool
    final_response: str | None
    error: str | None
    iteration_count: int
    worker_iteration_count: int
    task_complete: bool
    task_summary: str | None


WORKER_NAMES = {
    "FILESYSTEM": "filesystem_worker",
    "SYSTEM": "system_worker",
    "RESEARCHER": "researcher_worker",
    "CODE": "code_worker",
}

NODE_NAMES = {
    "SUPERVISOR": "supervisor",
    **WORKER_NAMES,
    "HUMAN_APPROVAL": "human_approval",
    "END": "__end__",
}

MAX_ITERATIONS = 15
MAX_WORKER_ITERATIONS = 5
MAX_TOOL_OUTPUT_LENGTH = 500
MAX_MESSAGES_FOR_SUPERVISOR = 20
