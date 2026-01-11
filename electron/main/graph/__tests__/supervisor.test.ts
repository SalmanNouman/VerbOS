import { describe, it, expect, vi } from 'vitest';
import { Supervisor } from '../supervisor';
import { WORKER_NAMES, NODE_NAMES } from '../state';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
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
      workerIterationCount: 0,
      taskComplete: false,
      taskSummary: null,
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
      workerIterationCount: 0,
      taskComplete: false,
      taskSummary: null,
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
      workerIterationCount: 0,
      taskComplete: false,
      taskSummary: null,
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
      workerIterationCount: 0,
      taskComplete: false,
      taskSummary: null,
    };

    const result = await supervisor.route(state);

    expect(result.next).toBe(NODE_NAMES.END);
    expect(result.finalResponse).toContain('Some catastrophic error');
    expect(mockModel.withStructuredOutput).not.toHaveBeenCalled();
  });

  it('should truncate verbose tool outputs in messages', async () => {
    const longContent = 'x'.repeat(1000); // Longer than MAX_TOOL_OUTPUT_LENGTH
    
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockImplementation((messages) => {
          // Check that the tool message was truncated
          const toolMsg = messages.find((m: any) => m instanceof ToolMessage);
          if (toolMsg) {
            expect(toolMsg.content.length).toBeLessThan(longContent.length);
            expect(toolMsg.content).toContain('[truncated]');
          }
          return Promise.resolve({
            next: 'FINISH',
            reasoning: 'Done',
            finalResponse: 'Completed',
          });
        }),
      }),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [
        new HumanMessage('Read a large file'),
        new ToolMessage({ content: longContent, tool_call_id: 'call-1' }),
      ],
      iterationCount: 0,
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
      taskSummary: null,
      taskComplete: false,
      workerIterationCount: 0,
    };

    await supervisor.route(state);
    expect(mockModel.withStructuredOutput).toHaveBeenCalled();
  });

  it('should include taskSummary in context when available', async () => {
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockImplementation((messages) => {
          // Check that task summary is included
          const summaryMsg = messages.find((m: any) => {
            const content = typeof m.content === 'string' ? m.content : '';
            return m instanceof HumanMessage && content.includes('[Previous Task Summary]');
          });
          expect(summaryMsg).toBeDefined();
          const summaryContent = typeof summaryMsg.content === 'string' ? summaryMsg.content : '';
          expect(summaryContent).toContain('Read file /test.txt');
          return Promise.resolve({
            next: 'FINISH',
            reasoning: 'Done',
            finalResponse: 'Completed with summary',
          });
        }),
      }),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: [new HumanMessage('Continue')],
      iterationCount: 1,
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
      taskSummary: '[filesystem_worker] Read file /test.txt',
      taskComplete: true,
      workerIterationCount: 0,
    };

    const result = await supervisor.route(state);
    expect(result.finalResponse).toBe('Completed with summary');
  });

  it('should prune messages when exceeding MAX_MESSAGES_FOR_SUPERVISOR', async () => {
    // Create 30 messages (more than MAX_MESSAGES_FOR_SUPERVISOR = 20)
    const manyMessages = Array.from({ length: 30 }, (_, i) => 
      new HumanMessage(`Message ${i}`)
    );
    
    const mockModel = {
      withStructuredOutput: vi.fn().mockReturnValue({
        invoke: vi.fn().mockImplementation((messages) => {
          // Should have: SystemMessage + pruned messages + final HumanMessage
          // Pruned messages should be <= 20
          const nonSystemMessages = messages.filter((m: any) => !(m.constructor.name === 'SystemMessage'));
          // -1 for the final "decide next action" message
          expect(nonSystemMessages.length - 1).toBeLessThanOrEqual(20);
          return Promise.resolve({
            next: 'FINISH',
            reasoning: 'Done',
            finalResponse: 'Pruned successfully',
          });
        }),
      }),
    } as unknown as BaseChatModel;

    const supervisor = new Supervisor(mockModel);
    const state = {
      messages: manyMessages,
      iterationCount: 0,
      currentWorker: null,
      next: 'supervisor',
      pendingAction: null,
      awaitingApproval: false,
      finalResponse: null,
      error: null,
      taskSummary: null,
      taskComplete: false,
      workerIterationCount: 0,
    };

    await supervisor.route(state);
    expect(mockModel.withStructuredOutput).toHaveBeenCalled();
  });
});
