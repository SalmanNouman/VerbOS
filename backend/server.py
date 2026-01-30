import argparse
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="VerbOS Backend", version="1.0.0")


class HealthResponse(BaseModel):
    status: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version="1.0.0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VerbOS Backend Server")
    parser.add_argument("--port", type=int, default=8000, help="Port to run the server on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind the server to")
    args = parser.parse_args()

    uvicorn.run(app, host=args.host, port=args.port)
