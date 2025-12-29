export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  date: string;
}

export interface HistoryAPI {
  create(title?: string): Promise<ChatSession>;
  list(): Promise<ChatSummary[]>;
  load(id: string): Promise<ChatSession | null>;
  updateTitle(sessionId: string, title: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface PendingAction {
  id: string;
  workerName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  sensitivity: 'safe' | 'moderate' | 'sensitive';
  description: string;
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; message: string; tools: Array<{ name: string; args: any }> }
  | { type: 'tool_result'; message: string }
  | { type: 'response'; message: string }
  | { type: 'approval_required'; action: PendingAction }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface VerbOSAPI {
  ping(): Promise<string>;
  askAgent(sessionId: string, prompt: string): Promise<{ streaming: boolean }>;
  
  // New event-based API
  onAgentEvent(callback: (event: AgentEvent) => void): void;
  onStreamEnd(callback: () => void): void;
  removeAgentEventListener(): void;
  removeStreamEndListener(): void;

  // HITL approval handlers
  approveAction(sessionId: string): Promise<{ success: boolean }>;
  denyAction(sessionId: string, reason?: string): Promise<{ success: boolean }>;
  resumeAgent(sessionId: string): Promise<{ streaming: boolean }>;

  // Legacy token listener (backwards compatibility)
  onToken(callback: (token: string) => void): void;
  removeTokenListener(): void;

  history: HistoryAPI;
}

declare global {
  interface Window {
    verbos?: VerbOSAPI;
  }
}
