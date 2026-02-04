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

export class PythonAPIClient {
  private baseUrl: string;

  constructor(port: number = 8000) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async *streamChat(
    threadId: string,
    message: string
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        threadId,
        message,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
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
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr) as AgentEvent;
              yield event;
            } catch (e) {
              GraphLogger.error('PYTHON', `Failed to parse SSE event: ${jsonStr}`);
            }
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        const jsonStr = buffer.slice(6);
        try {
          const event = JSON.parse(jsonStr) as AgentEvent;
          yield event;
        } catch (e) {
          GraphLogger.error('PYTHON', `Failed to parse final SSE event: ${jsonStr}`);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async approveAction(threadId: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ threadId }),
    });

    return response.json() as Promise<{ success: boolean; error?: string }>;
  }

  async denyAction(threadId: string, reason?: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/deny`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ threadId, reason }),
    });

    return response.json() as Promise<{ success: boolean; error?: string }>;
  }

  async *resumeChat(threadId: string): AsyncGenerator<AgentEvent, void, unknown> {
    const response = await fetch(`${this.baseUrl}/api/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ threadId }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
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
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const event = JSON.parse(jsonStr) as AgentEvent;
              yield event;
            } catch (e) {
              GraphLogger.error('PYTHON', `Failed to parse SSE event: ${jsonStr}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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
  if (!pythonAPIClientInstance) {
    pythonAPIClientInstance = new PythonAPIClient(port);
  }
  return pythonAPIClientInstance;
}
