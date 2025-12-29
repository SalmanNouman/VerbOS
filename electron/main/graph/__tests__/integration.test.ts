import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VerbOSGraph } from '../VerbOSGraph';
import { WORKER_NAMES, NODE_NAMES } from '../state';
import { HumanMessage } from '@langchain/core/messages';
import Database from 'better-sqlite3';

describe('VerbOSGraph End-to-End Integration (Mocks)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should execute a multi-step worker flow (Worker A -> Supervisor -> Worker B -> End)', async () => {
    const mockSupervisor = {
      route: vi.fn()
        // 1. First call: Route to Code Worker
        .mockResolvedValueOnce({
          next: WORKER_NAMES.CODE,
          finalResponse: null,
          currentWorker: WORKER_NAMES.CODE,
        })
        // 2. Second call: Route to FileSystem Worker
        .mockResolvedValueOnce({
          next: WORKER_NAMES.FILESYSTEM,
          finalResponse: null,
          currentWorker: WORKER_NAMES.FILESYSTEM,
        })
        // 3. Third call: Finish
        .mockResolvedValueOnce({
          next: NODE_NAMES.END,
          finalResponse: 'Code analyzed and saved.',
          currentWorker: null,
        }),
    };

    const mockCodeWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [new HumanMessage('Code analysis result')],
        pendingAction: null,
        awaitingApproval: false,
      }),
    };

    const mockFSWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [new HumanMessage('File saved result')],
        pendingAction: null,
        awaitingApproval: false,
      }),
    };

    const workers = new Map([
      [WORKER_NAMES.CODE, mockCodeWorker as any],
      [WORKER_NAMES.FILESYSTEM, mockFSWorker as any],
    ]);

    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);
    const threadId = 'thread-multi-step';

    const events = [];
    for await (const event of graph.stream(threadId, 'analyze code and save it')) {
      events.push(event);
    }

    // Verify transitions
    expect(mockSupervisor.route).toHaveBeenCalledTimes(3);
    expect(mockCodeWorker.process).toHaveBeenCalledTimes(1);
    expect(mockFSWorker.process).toHaveBeenCalledTimes(1);

    // Verify events sequence
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain('worker_started');
    expect(eventTypes).toContain('routing');
    expect(eventTypes).toContain('complete');

    // Verify final state
    const state = await graph.getState(threadId);
    expect(state.values.finalResponse).toBe('Code analyzed and saved.');
    expect(state.values.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('should execute a full HITL cycle (Worker -> Approval Required -> Resume -> Complete)', async () => {
    const mockSupervisor = {
      route: vi.fn()
        .mockResolvedValueOnce({
          next: WORKER_NAMES.SYSTEM,
          finalResponse: null,
          currentWorker: WORKER_NAMES.SYSTEM,
        })
        .mockResolvedValueOnce({
          next: NODE_NAMES.END,
          finalResponse: 'System task executed after approval.',
          currentWorker: null,
        }),
    };

    const mockSystemWorker = {
      process: vi.fn().mockResolvedValue({
        messages: [],
        pendingAction: { 
          id: 'action_123', 
          workerName: WORKER_NAMES.SYSTEM,
          toolName: 'shell_exec', 
          toolArgs: { command: 'rm -rf /' },
          sensitivity: 'sensitive',
          description: 'Dangerous command' 
        },
        awaitingApproval: true,
      }),
      executePendingAction: vi.fn().mockResolvedValue([new HumanMessage('Command output: success')]),
    };

    const workers = new Map([[WORKER_NAMES.SYSTEM, mockSystemWorker as any]]);
    const graph = new VerbOSGraph(db, mockSupervisor as any, workers);
    const threadId = 'thread-hitl-full';

    // 1. Initial request
    const events1 = [];
    for await (const event of graph.stream(threadId, 'run dangerous command')) {
      events1.push(event);
    }

    expect(events1.some(e => e.type === 'approval_required')).toBe(true);
    const approvalEvent = events1.find(e => e.type === 'approval_required');
    expect(approvalEvent?.data.action.id).toBe('action_123');

    // 2. User approves
    await graph.approveAction(threadId);
    expect(mockSystemWorker.executePendingAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'action_123' }));

    // 3. Resume
    const events2 = [];
    for await (const event of graph.stream(threadId, '')) {
      events2.push(event);
    }

    expect(events2.some(e => e.type === 'complete')).toBe(true);
    const completeEvent = events2.find(e => e.type === 'complete');
    expect(completeEvent?.data.response).toBe('System task executed after approval.');

    // Verify messages contains the tool output
    const state = await graph.getState(threadId);
    expect(state.values.messages.some((m: any) => m.content.includes('Command output: success'))).toBe(true);
  });
});
