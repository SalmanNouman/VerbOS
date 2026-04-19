# VerbOS
<img width="1182" height="736" alt="Screenshot 2025-12-18 190912" src="https://github.com/user-attachments/assets/77bab5d2-b5fc-489e-970c-dcc3184e8a57" />

> **A Universal Agent for your Computer.**

**VerbOS** (formerly AugOS) is an OS-agnostic, agentic desktop application designed to bridge the gap between users and complex operating system tasks. Built with a "Slack for your OS" metaphor, it provides a powerful chat interface where you can ask for tasks in natural language, and an intelligent Agent executes them.

---

## Vision & Identity

VerbOS aims to be the **Interface** for modern computer interaction:
- **Core Metaphor:** A command center for your computer.
- **Goal:** Handle file operations, web browsing, and system commands via natural language.
- **Vibe:** Agentic, clean, functional, and secure.

---

## Key Features

- **Multi-Agent Orchestration:** Powered by **LangGraph**, utilizing a Supervisor-Worker architecture for specialized task handling.
- **Specialized Workers:**
  - **FileSystem Worker:** Handle complex file operations (read, write, list, delete) with path validation.
  - **System Worker:** Execute shell commands and query OS information.
  - **Code Worker:** Generate and analyze code.
  - **Researcher Worker:** Utilize local LLMs for deep thinking and planning.
- **Human-In-The-Loop (HITL):** Sensitive actions (like writing files or running commands) require explicit user approval via the UI.
- **OS Integration:** Deep integration with the file system and system primitives.
- **Persistent Memory:** SQLite-based storage for long-term conversation history, with LangGraph checkpoints for in-progress graph state.
- **Server-Sent Events:** Real-time status, tool-call, and response events from the backend to the UI with Markdown + syntax highlighting.

---

## Tech Stack

VerbOS is a two-process desktop app: an **Electron + React** renderer that talks to a **local FastAPI / LangGraph** backend over HTTP (SSE).

**Renderer (Electron main + preload + React)**
- [Electron](https://www.electronjs.org/) 39 (cross-platform desktop container, strict context isolation)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — local chat-history store (not the agent checkpoint store; see below)

**Agent backend (spawned as a child process by Electron's main process)**
- [Python 3.13+](https://www.python.org/) managed by [uv](https://docs.astral.sh/uv/)
- [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) on `127.0.0.1:8000`
- [LangGraph (Python)](https://langchain-ai.github.io/langgraph/) for the supervisor-worker graph
- [langgraph-checkpoint-sqlite](https://pypi.org/project/langgraph-checkpoint-sqlite/) (`aiosqlite`) for per-thread checkpointed graph state
- [LangChain](https://python.langchain.com/) + `langchain-google-genai` (Gemini) and `langchain-ollama` (local models)

---

## Architecture

### Process topology

```
┌──────────────────────────┐        ┌────────────────────────────┐
│  Electron Renderer       │        │  Electron Main             │
│  (React + Vite)          │◀──IPC──▶  - PythonManager           │
│  window.verbos.askAgent()│        │  - spawns `uv run server.py│
└──────────────────────────┘        │    --port 8000`            │
                                    └────────────────┬───────────┘
                                                     │ HTTP / SSE
                                                     ▼
                                    ┌────────────────────────────┐
                                    │  Python FastAPI backend    │
                                    │  agent/graph.py (LangGraph)│
                                    │  /api/chat, /api/approve…  │
                                    └────────────────────────────┘
```

### Secure IPC bridge

`electron/preload/index.ts` exposes a narrow surface via `contextBridge.exposeInMainWorld('verbos', {...})`, so renderer code talks to the main process through `window.verbos.*` (e.g. `window.verbos.askAgent(sessionId, prompt)`, `window.verbos.onAgentEvent(cb)`, `window.verbos.approveAction(sessionId)`). The main process then relays to the Python backend over HTTP.

### Supervisor-Worker pattern

1.  **Supervisor** — central router that analyzes user intent and picks a worker.
2.  **Workers** — FileSystem, System, Code, Researcher: each has a scoped tool set and prompt.
3.  **Graph state** — shared `GraphState` (messages, current worker, pending action, etc.) checkpointed per `thread_id` via `AsyncSqliteSaver`.

### Human-In-The-Loop (HITL)

When a worker proposes a sensitive tool call (e.g. `write_file`, destructive shell commands), the graph stops and emits an `approval_required` event over SSE. The UI shows an approval card; the user clicks Approve or Deny, which POSTs to `/api/approve` or `/api/deny` and resumes the graph.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (LTS) + `npm`
- [Python](https://www.python.org/) ≥ 3.13
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (Python package manager — installs + runs the backend)
- [Ollama](https://ollama.com/) (optional, for local-model workers)
- A Google Gemini API key

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/SalmanNouman/VerbOS.git
    cd VerbOS
    ```

2.  **Install renderer dependencies**
    ```bash
    npm install
    ```

3.  **Install backend dependencies**
    ```bash
    cd backend
    uv sync
    cd ..
    ```
    `uv sync` creates a `.venv` in `backend/` from `pyproject.toml` + `uv.lock`.

4.  **Configure environment variables**
    Create a `.env` file in the repo root:
    ```env
    GOOGLE_API_KEY=your_gemini_api_key_here
    ```

### Running the App

- **Development mode** (Vite + Electron + auto-spawned Python backend):
  ```bash
  npm run dev
  ```
  Electron's main process (`electron/main/PythonManager.ts`) will `uv run backend/server.py --port 8000` for you — you don't need to start the backend manually.

- **Optional: local models via Ollama**
  ```bash
  ollama run llama3.2
  ```

- **Running the backend on its own** (useful for iterating on the agent without Electron):
  ```bash
  cd backend
  uv run server.py --port 8000
  # then hit http://127.0.0.1:8000/health
  ```

- **Tests (backend):**
  ```bash
  cd backend
  uv run pytest
  ```

- **Packaging a distributable:**
  ```bash
  npm run dist
  ```

### Calling the agent from renderer code

The preload exposes a `window.verbos` API.

```ts
// Send a prompt and subscribe to streamed events.
window.verbos.onAgentEvent((event) => {
  // event.type is one of: 'status' | 'tool' | 'tool_result'
  //                     | 'response' | 'approval_required' | 'error' | 'done'
  console.log(event);
});
await window.verbos.askAgent(currentSessionId, 'List files in my home directory');
```

The full typed surface lives in <a href="./src/types/verbos.d.ts"><code>src/types/verbos.d.ts</code></a>.

---

## Roadmap

- [x] **Phase 1: Foundation** — Secured Electron + Vite + React boilerplate.
- [x] **Phase 2: The Brain** — LangChain + Gemini integration with streaming.
- [x] **Phase 3: The Hands** — Core OS tools (FileTool, SystemTool).
- [x] **Phase 4: Persistence** — SQLite session management and smart context.
- [x] **Phase 5: Polish for Alpha version** — UI polish, session switching.
- [x] **Phase 6** — Quality improvements, enhanced error handling, and more tools.
- [x] **Phase 7** — Better agentic model orchestration.
