import logging
import os
from pathlib import Path
from typing import AsyncGenerator
from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langchain_core.messages import HumanMessage, ToolMessage
from agent.state import (
    GraphState,
    NODE_NAMES,
    WORKER_NAMES,
    MAX_WORKER_ITERATIONS,
    PendingAction,
)
from agent.supervisor import Supervisor
from agent.workers import (
    BaseWorker,
    FileSystemWorker,
    SystemWorker,
    ResearcherWorker,
    CodeWorker,
)

logger = logging.getLogger(__name__)


def get_default_db_path() -> str:
    """Get the default database path for checkpoints."""
    user_data = os.environ.get("VERBOS_USER_DATA")
    if user_data:
        db_dir = Path(user_data)
    else:
        db_dir = Path.home() / ".verbos"
    
    db_dir.mkdir(parents=True, exist_ok=True)
    return str(db_dir / "checkpoints.db")


class GraphEvent:
    """Event types emitted by the graph."""
    def __init__(self, event_type: str, data: dict):
        self.type = event_type
        self.data = data

    def to_dict(self) -> dict:
        return {"type": self.type, "data": self.data}


_checkpointer_instance: AsyncSqliteSaver | None = None


async def get_sqlite_checkpointer(db_path: str | None = None) -> AsyncSqliteSaver:
    """Get or create the async SQLite checkpointer singleton."""
    global _checkpointer_instance
    if _checkpointer_instance is None:
        import aiosqlite
        path = db_path or get_default_db_path()
        logger.info(f"Using SQLite checkpoint database: {path}")
        conn = await aiosqlite.connect(path)
        _checkpointer_instance = AsyncSqliteSaver(conn)
    return _checkpointer_instance


class VerbOSGraph:
    """The main LangGraph implementation for VerbOS."""

    def __init__(
        self,
        checkpointer=None,
        supervisor: Supervisor | None = None,
        workers: dict[str, BaseWorker] | None = None,
        use_sqlite: bool = True,
        db_path: str | None = None,
    ):
        self.supervisor = supervisor or Supervisor()
        self._use_sqlite = use_sqlite
        self._db_path = db_path
        self._checkpointer = checkpointer
        self._graph = None

        if workers:
            self.workers = workers
        else:
            self.workers = {
                WORKER_NAMES["FILESYSTEM"]: FileSystemWorker(),
                WORKER_NAMES["SYSTEM"]: SystemWorker(),
                WORKER_NAMES["RESEARCHER"]: ResearcherWorker(),
                WORKER_NAMES["CODE"]: CodeWorker(),
            }

    async def _ensure_graph(self):
        """Lazily initialize the graph with async checkpointer."""
        if self._graph is not None:
            return
        
        if self._checkpointer:
            checkpointer = self._checkpointer
        elif self._use_sqlite:
            checkpointer = await get_sqlite_checkpointer(self._db_path)
        else:
            checkpointer = MemorySaver()
        
        self._graph = self._build_graph(checkpointer)

    def _build_graph(self, checkpointer):
        workflow = StateGraph(GraphState)

        async def supervisor_node(state: GraphState) -> dict:
            result = await self.supervisor.route(state)
            return {
                "next": result["next"],
                "final_response": result["final_response"],
                "current_worker": result["current_worker"],
                "iteration_count": state["iteration_count"] + 1,
                "worker_iteration_count": 0,
                "task_complete": False,
            }

        def create_worker_node(worker_name: str):
            async def worker_node(state: GraphState) -> dict:
                worker = self.workers[worker_name]
                result = await worker.process(state)

                current_worker = None
                if result.awaiting_approval:
                    current_worker = worker_name
                elif not result.task_complete:
                    current_worker = worker_name

                return {
                    "messages": result.messages,
                    "pending_action": result.pending_action,
                    "awaiting_approval": result.awaiting_approval,
                    "current_worker": current_worker,
                    "task_complete": result.task_complete,
                    "task_summary": result.task_summary,
                    "worker_iteration_count": state["worker_iteration_count"] + 1,
                }
            return worker_node

        async def human_approval_node(state: GraphState) -> dict:
            return {"awaiting_approval": False}

        workflow.add_node("supervisor", supervisor_node)
        workflow.add_node("filesystem_worker", create_worker_node(WORKER_NAMES["FILESYSTEM"]))
        workflow.add_node("system_worker", create_worker_node(WORKER_NAMES["SYSTEM"]))
        workflow.add_node("researcher_worker", create_worker_node(WORKER_NAMES["RESEARCHER"]))
        workflow.add_node("code_worker", create_worker_node(WORKER_NAMES["CODE"]))
        workflow.add_node("human_approval", human_approval_node)

        workflow.add_edge(START, "supervisor")

        def supervisor_router(state: GraphState) -> str:
            next_node = state.get("next", "supervisor")
            if next_node == "__end__" or next_node == END:
                return "__end__"
            return next_node

        workflow.add_conditional_edges(
            "supervisor",
            supervisor_router,
            {
                "filesystem_worker": "filesystem_worker",
                "system_worker": "system_worker",
                "researcher_worker": "researcher_worker",
                "code_worker": "code_worker",
                "__end__": END,
            }
        )

        def worker_router(worker_name: str):
            def router(state: GraphState) -> str:
                if state.get("awaiting_approval"):
                    return "human_approval"
                if state.get("task_complete"):
                    return "supervisor"
                if state.get("worker_iteration_count", 0) >= MAX_WORKER_ITERATIONS:
                    return "supervisor"
                return worker_name
            return router

        for worker_name in WORKER_NAMES.values():
            workflow.add_conditional_edges(
                worker_name,
                worker_router(worker_name),
                {
                    "human_approval": "human_approval",
                    "supervisor": "supervisor",
                    worker_name: worker_name,
                }
            )

        workflow.add_edge("human_approval", "supervisor")

        return workflow.compile(
            checkpointer=checkpointer,
            interrupt_before=["human_approval"],
        )

    async def stream(
        self,
        thread_id: str,
        user_input: str,
    ) -> AsyncGenerator[GraphEvent, None]:
        """Stream events from the graph for a given input."""
        await self._ensure_graph()
        config = {"configurable": {"thread_id": thread_id}}

        current_state = await self._graph.aget_state(config)

        if current_state.next and current_state.values.get("awaiting_approval"):
            input_state = {
                "awaiting_approval": False,
                "pending_action": None,
            }
        else:
            input_state = {
                "messages": [HumanMessage(content=user_input)],
                "iteration_count": 0,
                "worker_iteration_count": 0,
                "task_complete": False,
                "task_summary": None,
                "error": None,
                "final_response": None,
                "current_worker": None,
                "next": "supervisor",
                "pending_action": None,
                "awaiting_approval": False,
            }

        try:
            async for event in self._graph.astream(input_state, config, stream_mode="updates"):
                for graph_event in self._process_event(event):
                    yield graph_event

            final_state = await self._graph.aget_state(config)

            if final_state.values.get("awaiting_approval") and final_state.values.get("pending_action"):
                yield GraphEvent("approval_required", {
                    "action": final_state.values["pending_action"].model_dump()
                    if hasattr(final_state.values["pending_action"], "model_dump")
                    else final_state.values["pending_action"],
                })
            elif final_state.values.get("final_response"):
                yield GraphEvent("complete", {
                    "response": final_state.values["final_response"],
                })

        except Exception as e:
            logger.error(f"Graph stream error: {e}")
            yield GraphEvent("error", {"message": str(e)})

    async def approve_action(self, thread_id: str) -> None:
        """Approve a pending action and resume the graph."""
        await self._ensure_graph()
        config = {"configurable": {"thread_id": thread_id}}
        state = await self._graph.aget_state(config)

        pending_action = state.values.get("pending_action")
        current_worker = state.values.get("current_worker")

        if not pending_action or not current_worker:
            raise ValueError("No pending action to approve")

        worker = self.workers.get(current_worker)
        if not worker:
            raise ValueError(f"Worker {current_worker} not found")

        if isinstance(pending_action, dict):
            pending_action = PendingAction(**pending_action)

        result_messages = await worker.execute_pending_action(pending_action)

        await self._graph.aupdate_state(config, {
            "messages": result_messages,
            "pending_action": None,
            "awaiting_approval": False,
        })

    async def deny_action(self, thread_id: str, reason: str | None = None) -> None:
        """Deny a pending action and resume the graph."""
        await self._ensure_graph()
        config = {"configurable": {"thread_id": thread_id}}
        state = await self._graph.aget_state(config)

        if not state.values.get("pending_action"):
            raise ValueError("No pending action to deny")

        deny_message = f"Action denied by user: {reason}" if reason else "Action denied by user"

        await self._graph.aupdate_state(config, {
            "messages": [HumanMessage(content=deny_message)],
            "pending_action": None,
            "awaiting_approval": False,
        })

    async def get_state(self, thread_id: str):
        """Get the current state of a thread."""
        await self._ensure_graph()
        config = {"configurable": {"thread_id": thread_id}}
        return await self._graph.aget_state(config)

    def _process_event(self, event: dict) -> list[GraphEvent]:
        """Process raw graph events into typed GraphEvents."""
        events = []

        node_name = list(event.keys())[0] if event else None
        updates = event.get(node_name, {}) if node_name else {}

        if not node_name or not updates:
            return events

        if node_name in WORKER_NAMES.values():
            events.append(GraphEvent("worker_started", {"worker": node_name}))

        if node_name == NODE_NAMES["SUPERVISOR"]:
            next_node = updates.get("next")
            if next_node and next_node != END:
                events.append(GraphEvent("routing", {"next": next_node}))

        messages = updates.get("messages", [])
        if messages:
            for msg in messages:
                if hasattr(msg, "tool_calls") and msg.tool_calls:
                    events.append(GraphEvent("tool_call", {
                        "tools": [
                            {"name": tc.get("name"), "args": tc.get("args")}
                            for tc in msg.tool_calls
                        ]
                    }))

                if isinstance(msg, ToolMessage):
                    events.append(GraphEvent("tool_result", {
                        "result": str(msg.content),
                    }))

        return events
