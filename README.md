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

- **Agentic Chat Interface:** Powered by Google Gemini for complex reasoning and Ollama for local tasks.
- **OS Integration:** Deep integration with the file system and system primitives.
- **Modular Tools:**
  - **FileTool:** Securely list, read, and write files.
  - **SystemTool:** Query system information and execute safe commands.
  - More Tools coming soon...
- **Privacy-First Brain:** Local summarization via Ollama ensures sensitive context stays on your device.
- **Persistent Memory:** SQLite-based storage for long-term conversation history and smart context window management.
- **Streaming Responses:** Real-time feedback as the Agent "thinks" and executes steps.

---

## Tech Stack

VerbOS adheres to a strict, modern tech stack for performance and security:

- **Runtime:** [Electron](https://www.electronjs.org/) (Cross-platform desktop container)
- **Frontend:** [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- **Backend:** Node.js (Electron Main Process)
- **AI Orchestration:** [LangChain.js](https://js.langchain.com/)
- **Model Layer:** 
  - **Cloud:** Google Gemini 2.0 Flash (via `@langchain/google-genai`)
  - **Local:** Ollama (via `@langchain/ollama`)
- **Database:** Better-SQLite3

---

## Architecture

### Secure IPC Bridge
VerbOS follows strict Electron security patterns:
- **No `remote` module:** Ensuring modern security standards.
- **Context Isolation:** The Renderer process has no direct access to Node.js.
- **Type-Safe IPC:** All communication happens through a secure `ContextBridge` in `preload.ts`, exposing only necessary methods like `window.electron.askAgent()`.

### The Agent Loop (ReAct)
The Agent runs in the Main Process and follows the **ReAct Pattern** (Reason -> Act -> Observe). It breaks down user requests into actionable tool calls, observes the results, and iterates until the goal is met.

### Mediator Architecture
A local LLM (Ollama) acts as a privacy mediator. It sanitizes context and summarizes history locally before any high-level intent is passed to cloud models.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (Latest LTS recommended)
- [Ollama](https://ollama.com/) (For local intelligence and privacy features)
- Google Gemini API Key

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/SalmanNouman/VerbOS.git
    cd VerbOS
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure environment variables:**
    Create a `.env` file in the root directory:
    ```env
    GOOGLE_API_KEY=your_gemini_api_key_here
    ```

### Running the App

- **Building Project:**
  ```bash
  npm run build
  npm run build:electron
  ```
  - **Run Ollama instance:**
  ```bash
  ollama run llama3.2
  ```
  
- **Development Mode:**
  ```bash
  npm run dev
  ```
  This starts the Vite development server and launches the Electron application simultaneously.
  
- **Packaging:**
  ```bash
  npm run dist
  ```

---

## Roadmap

- [x] **Phase 1: Foundation** - Secured Electron + Vite + React Boilerplate.
- [x] **Phase 2: The Brain** - LangChain & Gemini integration with streaming.
- [x] **Phase 3: The Hands** - Core OS tools (FileTool, SystemTool).
- [x] **Phase 4: Persistence** - SQLite session management and smart context.
- [x] **Phase 5: Polish for Alpha version** - UI Polish, session switching.
- [x] **Phase 6** - Quality improvements, enhanced error handling, and more tools.
- [x] **Phase 7** - Better agentic model orchestration.
- [ ] **Current Focus** - Parallel agents, Workspace Instances.
- [ ] **Future Focus** - Settings, Preferences, and other user facing switches.

---

## Security Principles

1.  **Least Privilege:** Every tool has restricted access to specific OS primitives.
2.  **Path Validation:** File operations are validated to prevent unauthorized access.
3.  **Sanitized Context:** Local models ensure sensitive data is summarized before leaving the device.
4.  **No `nodeIntegration`:** Renderer is strictly sandboxed.

---
This project is licensed under the [MIT License](LICENSE).

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=SalmanNouman_AugOS&metric=alert_status&token=6d301ab1cd42712a72a6ced60a1511de068664f8)](https://sonarcloud.io/summary/new_code?id=SalmanNouman_AugOS)
