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

export interface VerbOSAPI {
  ping(): Promise<string>;
  askAgent(sessionId: string, prompt: string): Promise<{ streaming: boolean }>;
  onToken(callback: (token: string) => void): void;
  onStreamEnd(callback: () => void): void;
  removeTokenListener(): void;
  removeStreamEndListener(): void;
  history: HistoryAPI;
}

declare global {
  interface Window {
    verbos?: VerbOSAPI;
  }
}
