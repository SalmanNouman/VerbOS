import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseWorker } from '../BaseWorker';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { GraphStateType } from '../../state';
import { mockModelResponse } from './test-utils';

// Concrete implementation for testing
class MockWorker extends BaseWorker {
  constructor() {
    super({
      name: 'mock_worker',
      description: 'Test worker',
      tools: [
        new DynamicStructuredTool({
          name: 'read_file',
          description: 'A safe tool',
          schema: z.object({ path: z.string() }),
          func: async ({ path }) => `Success: ${path}`,
        }),
        new DynamicStructuredTool({
          name: 'write_file', // Considered sensitive by getToolSensitivity
          description: 'A sensitive tool',
          schema: z.object({ path: z.string(), content: z.string() }),
          func: async ({ path }) => `Wrote to ${path}`,
        }),
      ],
      systemPrompt: 'You are a test worker.',
    });
  }
}

describe('BaseWorker', () => {
  let worker: MockWorker;

  beforeEach(() => {
    // Mock GOOGLE_API_KEY for ChatGoogleGenerativeAI
    process.env.GOOGLE_API_KEY = 'test-key';
    worker = new MockWorker();
    
    // Mock the modelWithTools.invoke
    mockModelResponse(worker, { content: 'Thinking...' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should process messages and return model response', async () => {
    const state: GraphStateType = { messages: [new HumanMessage('hello')] } as any;
    const result = await worker.process(state);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Thinking...');
    expect(result.awaitingApproval).toBe(false);
  });

  it('should execute safe tools immediately', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'read_file',
        args: { path: 'data' },
        id: 'call-1'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBeInstanceOf(ToolMessage);
    expect(result.messages[1].content).toBe('Success: data');
    expect(result.awaitingApproval).toBe(false);
  });

  it('should return pendingAction for sensitive tools', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'write_file',
        args: { path: 'test.txt', content: 'hello' },
        id: 'call-2'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.awaitingApproval).toBe(true);
    expect(result.pendingAction).toBeDefined();
    expect(result.pendingAction?.toolName).toBe('write_file');
    expect(result.pendingAction?.sensitivity).toBe('sensitive');
    // AI message + placeholder ToolMessage (required by Google API)
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('[Awaiting user approval]');
  });

  it('should execute pending action after approval', async () => {
    const action = {
      id: 'call-3',
      toolName: 'write_file',
      toolArgs: { path: 'approved.txt', content: 'data' },
      workerName: 'mock_worker',
      sensitivity: 'sensitive' as const,
      description: 'test'
    };

    const resultMessages = await worker.executePendingAction(action);
    expect(resultMessages).toHaveLength(1);
    expect(resultMessages[0]).toBeInstanceOf(ToolMessage);
    expect(resultMessages[0].content).toBe('Wrote to approved.txt');
  });

  it('should handle tool errors gracefully', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'non_existent_tool',
        args: {},
        id: 'call-4'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toContain('Error: Tool non_existent_tool not found');
  });

  it('should set taskComplete=true when no tool calls are made', async () => {
    mockModelResponse(worker, { content: 'Task is done, here is the result.' });

    const state: GraphStateType = { messages: [new HumanMessage('do something')] } as any;
    const result = await worker.process(state);
    
    expect(result.taskComplete).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it('should set taskComplete=false when tool calls are made', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'read_file',
        args: { path: 'test.txt' },
        id: 'call-5'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.taskComplete).toBe(false);
  });

  it('should generate taskSummary from tool executions', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'read_file',
        args: { path: '/some/file.txt' },
        id: 'call-6'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.taskSummary).toBeDefined();
    expect(result.taskSummary).toContain('mock_worker');
    expect(result.taskSummary).toContain('read_file');
  });
});
