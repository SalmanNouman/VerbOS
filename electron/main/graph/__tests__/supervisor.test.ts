import { describe, it, expect, vi } from 'vitest';
import { Supervisor } from '../supervisor';
import { WORKER_NAMES, NODE_NAMES } from '../state';
import { HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

describe('Supervisor', () => {
  it('should route to the correct worker based on model decision', async () => {
    // Mock model
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          next: WORKER_NAMES.FILESYSTEM,
          reasoning: 'User wants to list files',
        }),
      }),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [new HumanMessage('List files in the current directory')],
      iterationCount: 0,
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
    };

    const result = await supervisor.route(state);

    expect(result.next).toBe(WORKER_NAMES.FILESYSTEM);
    expect(result.currentWorker).toBe(WORKER_NAMES.FILESYSTEM);
    expect(result.finalResponse).toBeNull();
  });

  it('should return FINISH and finalResponse when task is complete', async () => {
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({
          next: 'FINISH',
          reasoning: 'Task is complete',
          finalResponse: 'Here are the files you requested.',
        }),
      }),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [new HumanMessage('List files')],
      iterationCount: 1,
      currentWorker: WORKER_NAMES.FILESYSTEM,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
    };

    const result = await supervisor.route(state);

    expect(result.next).toBe(NODE_NAMES.END);
    expect(result.currentWorker).toBeNull();
    expect(result.finalResponse).toBe('Here are the files you requested.');
  });

  it('should handle iteration limits', async () => {
    // Model shouldn't even be called
    const mockModel = {
      withStructuredOutput: vi.fn(),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [],
      iterationCount: 15, // MAX_ITERATIONS
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
    };

    const result = await supervisor.route(state);

    expect(result.next).toBe(NODE_NAMES.END);
    expect(result.finalResponse).toContain('maximum number of steps');
    expect(mockModel.withStructuredOutput).not.toHaveBeenCalled();
  });

  it('should handle error states', async () => {
    const mockModel = {
      withStructuredOutput: vi.fn(),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [],
      iterationCount: 0,
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: 'Some catastrophic error',
    };

    const result = await supervisor.route(state);

    expect(result.next).toBe(NODE_NAMES.END);
    expect(result.finalResponse).toContain('Some catastrophic error');
    expect(mockModel.withStructuredOutput).not.toHaveBeenCalled();
  });
});
