import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VerbOSGraph } from '../VerbOSGraph';
import { WORKER_NAMES, NODE_NAMES } from '../state';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import Database from 'better-sqlite3';
import { createMockSupervisor } from './test-utils';

describe('VerbOSGraph Integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should route: Start -> Supervisor -> End', async () => {
    const mockSupervisor = {
      route: vi.fn().mockResolvedValue({
        next: NODE_NAMES.END,
        finalResponse: 'Hello from supervisor',
        currentWorker: null,
      }),
    };

    const graph = new VerbOSGraph(db, mockSupervisor as any, new Map());
    
    const events = [];
    for await (const event of graph.stream('thread-1', 'hi')) {
      events.push(event);
    }

    expect(mockSupervisor.route).toHaveBeenCalled();
    const completeEvent = events.find(e => e.type === 'complete');
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.response).toBe('Hello from supervisor');
  });

  it('should emit tool_call and tool_result events', async () => {
    const mockSupervisor = createMockSupervisor([
      {
        next: WORKER_NAMES.FILESYSTEM,
        finalResponse: null,
        currentWorker: WORKER_NAMES.FILESYSTEM,
      },
      {
        next: NODE_NAMES.END,
        finalResponse: 'Done',
        currentWorker: null,
      }
    ]);

    const mockWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [{ name: 'read_file', args: { path: 'test.txt' }, id: 'call_1' }]
          }),
          new ToolMessage({
            content: 'File content',
            tool_call_id: 'call_1'
          })
        ],
        pendingAction: null,
        awaitingApproval: false,
      }),
    };

    const workers = new Map([[WORKER_NAMES.FILESYSTEM, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const events = [];
    for await (const event of graph.stream('thread-tools', 'read test.txt')) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'tool_call')).toBe(true);
    expect(events.some(e => e.type === 'tool_result' && e.data.result === 'File content')).toBe(true);
  });

  it('should handle HITL: Worker -> Human Approval -> Resume -> Supervisor', async () => {
    const mockSupervisor = createMockSupervisor([
      {
        next: WORKER_NAMES.FILESYSTEM,
        finalResponse: null,
        currentWorker: WORKER_NAMES.FILESYSTEM,
      },
      {
        next: NODE_NAMES.END,
        finalResponse: 'Final response after approval',
        currentWorker: null,
      }
    ]);

    const mockWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [],
        pendingAction: { id: '1', toolName: 'test_tool', description: 'desc' },
        awaitingApproval: true,
      }),
      executePendingAction: vi.fn().mockResolvedValue([new HumanMessage('Tool result')]),
    };

    const workers = new Map([[WORKER_NAMES.FILESYSTEM, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const threadId = 'thread-hitl';
    
    // 1. Initial run
    const events1 = [];
    for await (const event of graph.stream(threadId, 'run sensitive task')) {
      events1.push(event);
    }

    expect(events1.some(e => e.type === 'approval_required')).toBe(true);
    
    // Check state - should be awaiting approval
    const state = await graph.getState(threadId);
    expect(state.values.awaitingApproval).toBe(true);
    expect(state.values.pendingAction).toBeDefined();

    // 2. Approve
    await graph.approveAction(threadId);
    expect(mockWorker.executePendingAction).toHaveBeenCalled();

    // 3. Resume
    const events2 = [];
    for await (const event of graph.stream(threadId, '')) {
      events2.push(event);
    }

    expect(mockSupervisor.route).toHaveBeenCalledTimes(2);
    expect(events2.some(e => e.type === 'complete')).toBe(true);
    
    const finalState = await graph.getState(threadId);
    expect(finalState.values.awaitingApproval).toBe(false);
  });

  it('should handle denyAction correctly', async () => {
    const mockSupervisor = createMockSupervisor([
      {
        next: WORKER_NAMES.FILESYSTEM,
        finalResponse: null,
        currentWorker: WORKER_NAMES.FILESYSTEM,
      },
      {
        next: NODE_NAMES.END,
        finalResponse: 'User denied the action',
        currentWorker: null,
      }
    ]);

    const mockWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [],
        pendingAction: { id: '1', toolName: 'test_tool', description: 'desc' },
        awaitingApproval: true,
      }),
    };

    const workers = new Map([[WORKER_NAMES.FILESYSTEM, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const threadId = 'thread-deny';
    
    // 1. Initial run
    for await (const _ of graph.stream(threadId, 'run sensitive task')) {}

    // 2. Deny
    await graph.denyAction(threadId, 'too risky');

    // 3. Resume
    const events = [];
    for await (const event of graph.stream(threadId, '')) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'complete')).toBe(true);
    
    const finalState = await graph.getState(threadId);
    expect(finalState.values.awaitingApproval).toBe(false);
    expect(finalState.values.pendingAction).toBeNull();
    
    // Check that a message was added about the denial
    const messages = finalState.values.messages;
    // In our mock routing, the last message might be from the user (denial) or assistant (final response)
    // LangGraph's stream includes the state updates.
    expect(messages.some((m: any) => m.content.includes('too risky'))).toBe(true);
  });
});
