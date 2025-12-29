import { VerbOSGraph, GraphEvent, PendingAction } from './graph';
import { StorageService } from './storage';
import type Database from 'better-sqlite3';
import { GraphLogger } from './graph/logger';

/**
 * AgentServiceGraph - New LangGraph-based agent service.
 * Replaces the old AgentService with multi-agent orchestration.
 */
export class AgentServiceGraph {
  private graph: VerbOSGraph;
  private storage: StorageService;

  constructor(storage: StorageService, db: Database.Database) {
    this.storage = storage;
    this.graph = new VerbOSGraph(db);
    GraphLogger.info('SYSTEM', 'Initialized AgentServiceGraph with LangGraph orchestration');
  }

  /**
   * Process a user message and stream events back.
   * @param sessionId - The session/thread ID
   * @param prompt - The user's message
   * @param onEvent - Callback for graph events
   */
  async ask(
    sessionId: string,
    prompt: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    try {
      // Save user message to storage
      this.storage.addMessage(sessionId, 'user', prompt);

      onEvent({ type: 'status', message: 'Processing...' });

      await this.processStream(sessionId, prompt, onEvent);
    } catch (error) {
      this.handleError(error, onEvent);
    }
  }

  /**
   * Approve a pending action
   */
  async approveAction(sessionId: string): Promise<void> {
    await this.graph.approveAction(sessionId);
  }

  /**
   * Deny a pending action
   */
  async denyAction(sessionId: string, reason?: string): Promise<void> {
    await this.graph.denyAction(sessionId, reason);
  }

  /**
   * Resume after approval/denial
   */
  async resume(
    sessionId: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    try {
      await this.processStream(sessionId, '', onEvent);
    } catch (error) {
      this.handleError(error, onEvent);
    }
  }

  /**
   * Common logic to stream events from the graph
   */
  private async processStream(
    sessionId: string,
    input: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    let finalResponse = '';

    for await (const event of this.graph.stream(sessionId, input)) {
      const agentEvent = this.mapGraphEvent(event);
      if (agentEvent) {
        onEvent(agentEvent);
      }

      // Capture final response
      if (event.type === 'complete') {
        finalResponse = event.data.response;
      }
    }

    // Save assistant response to storage
    if (finalResponse) {
      this.storage.addMessage(sessionId, 'assistant', finalResponse);
    }

    onEvent({ type: 'done' });
  }

  /**
   * Common error handling logic
   */
  private handleError(
    error: unknown,
    onEvent: (event: AgentEvent) => void
  ): void {
    GraphLogger.error('SYSTEM', 'AgentServiceGraph error', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onEvent({ type: 'error', message: errorMessage });
    onEvent({ type: 'done' });
  }

  /**
   * Get current state of a session
   */
  async getState(sessionId: string) {
    return this.graph.getState(sessionId);
  }

  /**
   * Map internal graph events to agent events for the UI
   */
  private mapGraphEvent(event: GraphEvent): AgentEvent | null {
    switch (event.type) {
      case 'worker_started':
        return {
          type: 'status',
          message: `Routing to ${this.formatWorkerName(event.data.worker)}...`,
        };

      case 'routing':
        return {
          type: 'status',
          message: `Next: ${this.formatWorkerName(event.data.next)}`,
        };

      case 'tool_call':
      {
        const toolNames = event.data.tools.map(t => t.name).join(', ');
        return {
          type: 'tool',
          message: `Using tools: ${toolNames}`,
          tools: event.data.tools,
        };
      }
      case 'tool_result':
        return {
          type: 'tool_result',
          message: event.data.result,
        };

      case 'approval_required':
        return {
          type: 'approval_required',
          action: event.data.action,
        };

      case 'complete':
        return {
          type: 'response',
          message: event.data.response,
        };

      case 'error':
        return {
          type: 'error',
          message: event.data.message,
        };

      default:
        return null;
    }
  }

  /**
   * Format worker name for display
   */
  private formatWorkerName(name: string): string {
    const nameMap: Record<string, string> = {
      'filesystem_worker': 'FileSystem Agent',
      'system_worker': 'System Agent',
      'researcher_worker': 'Researcher Agent',
      'code_worker': 'Code Agent',
      'supervisor': 'Supervisor',
      '__end__': 'Complete',
    };
    return nameMap[name] || name;
  }
}

/**
 * Agent events sent to the UI
 */
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; message: string; tools: Array<{ name: string; args: any }> }
  | { type: 'tool_result'; message: string }
  | { type: 'response'; message: string }
  | { type: 'approval_required'; action: PendingAction }
  | { type: 'error'; message: string }
  | { type: 'done' };
