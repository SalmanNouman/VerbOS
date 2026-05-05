import { GraphLogger } from './logger';


export interface AgentEvent {
  type: 'status' | 'tool' | 'tool_result' | 'response' | 'approval_required' | 'error' | 'done';
  message?: string;
  tools?: Array<{ name: string; args: any }>;
  action?: {
    id: string;
    workerName: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    sensitivity: 'safe' | 'moderate' | 'sensitive';
    description: string;
  };
}

interface ApiResult {
  success: boolean;
  error?: string;
}

export class PythonAPIClient {
  private readonly baseUrl: string;

  constructor(port: number = 8000) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  private ensureStreamResponse(response: Response): ReadableStream<Uint8Array> {
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body;
  }

  private parseSseLine(line: string): AgentEvent | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const jsonStr = line.slice(6);
    try {
      return JSON.parse(jsonStr) as AgentEvent;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      GraphLogger.error('PYTHON', `Failed to parse SSE event: ${message}; payload: ${jsonStr}`);
      return null;
    }
  }

  private async *streamResponse(response: Response): AsyncGenerator<AgentEvent, void, unknown> {
    const body = this.ensureStreamResponse(response);
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const event = this.parseSseLine(line);
          if (event) {
            yield event;
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        const event = this.parseSseLine(buffer);
        if (event) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async *streamChat(
    threadId: string,
    message: string
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await this.postJson('/api/chat', { threadId, message });
    yield* this.streamResponse(response);
  }

  async approveAction(threadId: string): Promise<ApiResult> {
    const response = await this.postJson('/api/approve', { threadId });
    return response.json() as Promise<ApiResult>;
  }

  async denyAction(threadId: string, reason?: string): Promise<ApiResult> {
    const response = await this.postJson('/api/deny', { threadId, reason });
    return response.json() as Promise<ApiResult>;
  }

  async *resumeChat(threadId: string): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await this.postJson('/api/resume', { threadId });
    yield* this.streamResponse(response);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

let pythonAPIClientInstance: PythonAPIClient | null = null;

export function getPythonAPIClient(port: number = 8000): PythonAPIClient {
  pythonAPIClientInstance ??= new PythonAPIClient(port);
  return pythonAPIClientInstance;
}
