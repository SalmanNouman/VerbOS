import argparse
import json
import logging
import sys
from typing import Literal, AsyncGenerator
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from dotenv import load_dotenv
import uvicorn

load_dotenv()

from agent import VerbOSGraph

logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger(__name__)

app = FastAPI(title="VerbOS Backend", version="1.0.0")

graph: VerbOSGraph | None = None


@app.on_event("startup")
async def startup_event():
    global graph
    logger.info("Initializing VerbOS graph...")
    graph = VerbOSGraph()
    logger.info("VerbOS graph initialized")


class HealthResponse(BaseModel):
    status: str
    version: str


class ChatRequest(BaseModel):
    message: str = Field(alias="message")
    thread_id: str = Field(alias="threadId")

    model_config = ConfigDict(populate_by_name=True)


class PendingActionResponse(BaseModel):
    id: str
    worker_name: str = Field(serialization_alias="workerName")
    tool_name: str = Field(serialization_alias="toolName")
    tool_args: dict = Field(serialization_alias="toolArgs")
    sensitivity: Literal["safe", "moderate", "sensitive"]
    description: str

    model_config = ConfigDict(populate_by_name=True)


class ApprovalRequest(BaseModel):
    thread_id: str = Field(alias="threadId")
    reason: str | None = None

    model_config = ConfigDict(populate_by_name=True)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version="1.0.0")


def format_sse(event_type: str, data: dict) -> str:
    """Format data as Server-Sent Event."""
    return f"data: {json.dumps({'type': event_type, **data})}\n\n"


def format_worker_name(name: str) -> str:
    """Format worker name for display."""
    name_map = {
        "filesystem_worker": "FileSystem Agent",
        "system_worker": "System Agent",
        "researcher_worker": "Researcher Agent",
        "code_worker": "Code Agent",
        "supervisor": "Supervisor",
        "__end__": "Complete",
    }
    return name_map.get(name, name)


async def stream_chat(thread_id: str, message: str) -> AsyncGenerator[str, None]:
    """Stream chat events as SSE."""
    yield format_sse("status", {"message": "Processing..."})

    try:
        async for event in graph.stream(thread_id, message):
            if event.type == "worker_started":
                yield format_sse("status", {
                    "message": f"Routing to {format_worker_name(event.data['worker'])}..."
                })

            elif event.type == "routing":
                yield format_sse("status", {
                    "message": f"Next: {format_worker_name(event.data['next'])}"
                })

            elif event.type == "tool_call":
                tool_names = ", ".join(t["name"] for t in event.data["tools"])
                yield format_sse("tool", {
                    "message": f"Using tools: {tool_names}",
                    "tools": event.data["tools"],
                })

            elif event.type == "tool_result":
                yield format_sse("tool_result", {
                    "message": event.data["result"],
                })

            elif event.type == "approval_required":
                action = event.data["action"]
                yield format_sse("approval_required", {
                    "action": {
                        "id": action.get("id"),
                        "workerName": action.get("worker_name"),
                        "toolName": action.get("tool_name"),
                        "toolArgs": action.get("tool_args"),
                        "sensitivity": action.get("sensitivity"),
                        "description": action.get("description"),
                    }
                })

            elif event.type == "complete":
                yield format_sse("response", {
                    "message": event.data["response"],
                })

            elif event.type == "error":
                yield format_sse("error", {
                    "message": event.data["message"],
                })

        yield format_sse("done", {})

    except Exception as e:
        logger.error(f"Stream error: {e}")
        yield format_sse("error", {"message": str(e)})
        yield format_sse("done", {})


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Stream chat responses using Server-Sent Events."""
    return StreamingResponse(
        stream_chat(request.thread_id, request.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/approve")
async def approve_action(request: ApprovalRequest):
    """Approve a pending action."""
    try:
        await graph.approve_action(request.thread_id)
        return {"success": True}
    except Exception as e:
        logger.error(f"Approve error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/deny")
async def deny_action(request: ApprovalRequest):
    """Deny a pending action."""
    try:
        await graph.deny_action(request.thread_id, request.reason)
        return {"success": True}
    except Exception as e:
        logger.error(f"Deny error: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/resume")
async def resume_chat(request: ApprovalRequest):
    """Resume chat after approval/denial."""
    return StreamingResponse(
        stream_chat(request.thread_id, ""),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VerbOS Backend Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to run the server on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind the server to")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port)
