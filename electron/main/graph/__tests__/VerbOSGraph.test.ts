import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VerbOSGraph } from '../VerbOSGraph';
import { WORKER_NAMES, NODE_NAMES, MAX_WORKER_ITERATIONS } from '../state';
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

  it('should support worker self-loop when taskComplete is false', async () => {
    let workerCallCount = 0;
    
    const mockSupervisor = createMockSupervisor([
      {
        next: WORKER_NAMES.CODE,
        finalResponse: null,
        currentWorker: WORKER_NAMES.CODE,
      },
      {
        next: NODE_NAMES.END,
        finalResponse: 'Code worker completed multi-step task',
        currentWorker: null,
      }
    ]);

    const mockWorker = {
      process: vi.fn().mockImplementation(() => {
        workerCallCount++;
        // First call: not complete (will self-loop)
        // Second call: complete (will return to supervisor)
        if (workerCallCount < 2) {
          return Promise.resolve({
            messages: [new AIMessage({ content: 'Step ' + workerCallCount })],
            pendingAction: null,
            awaitingApproval: false,
            taskComplete: false,
            taskSummary: 'Working on step ' + workerCallCount,
          });
        }
        return Promise.resolve({
          messages: [new AIMessage({ content: 'Done' })],
          pendingAction: null,
          awaitingApproval: false,
          taskComplete: true,
          taskSummary: 'Completed all steps',
        });
      }),
    };

    const workers = new Map([[WORKER_NAMES.CODE, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const events = [];
    for await (const event of graph.stream('thread-selfloop', 'multi-step task')) {
      events.push(event);
    }

    // Worker should be called twice (self-loop once, then complete)
    expect(mockWorker.process).toHaveBeenCalledTimes(2);
    // Supervisor should be called twice (initial routing, then final)
    expect(mockSupervisor.route).toHaveBeenCalledTimes(2);
  });

  it('should force return to supervisor after MAX_WORKER_ITERATIONS', async () => {
    const mockSupervisor = createMockSupervisor([
      {
        next: WORKER_NAMES.CODE,
        finalResponse: null,
        currentWorker: WORKER_NAMES.CODE,
      },
      {
        next: NODE_NAMES.END,
        finalResponse: 'Forced completion after iteration limit',
        currentWorker: null,
      }
    ]);

    // Worker never completes (always returns taskComplete: false)
    const mockWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [new AIMessage({ content: 'Still working...' })],
        pendingAction: null,
        awaitingApproval: false,
        taskComplete: false,
        taskSummary: 'Still processing',
      }),
    };

    const workers = new Map([[WORKER_NAMES.CODE, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const events = [];
    for await (const event of graph.stream('thread-maxiter', 'infinite task')) {
      events.push(event);
    }

    // Worker should be called MAX_WORKER_ITERATIONS times before forced return
    expect(mockWorker.process).toHaveBeenCalledTimes(MAX_WORKER_ITERATIONS);
    // Should still complete successfully
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });

  it('should pass taskSummary to supervisor state', async () => {
    const mockSupervisor = {
      route: vi.fn().mockImplementation((state) => {
        // On second call, check that taskSummary is present
        if (state.taskSummary) {
          return Promise.resolve({
            next: NODE_NAMES.END,
            finalResponse: 'Got summary: ' + state.taskSummary,
            currentWorker: null,
          });
        }
        return Promise.resolve({
          next: WORKER_NAMES.FILESYSTEM,
          finalResponse: null,
          currentWorker: WORKER_NAMES.FILESYSTEM,
        });
      }),
    };

    const mockWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [new AIMessage({ content: 'Done reading file' })],
        pendingAction: null,
        awaitingApproval: false,
        taskComplete: true,
        taskSummary: '[filesystem_worker] Read file /test.txt',
      }),
    };

    const workers = new Map([[WORKER_NAMES.FILESYSTEM, mockWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);

    const events = [];
    for await (const event of graph.stream('thread-summary', 'read a file')) {
      events.push(event);
    }

    expect(mockSupervisor.route).toHaveBeenCalledTimes(2);
    const completeEvent = events.find(e => e.type === 'complete');
    expect(completeEvent?.data.response).toContain('filesystem_worker');
  });
});
