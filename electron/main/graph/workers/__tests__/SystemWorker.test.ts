import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemWorker } from '../SystemWorker';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { GraphStateType } from '../../state';
import { mockModelResponse } from './test-utils';

// Mock path validation to always pass for tests
vi.mock('../../tools/pathValidation', () => ({
  validateReadPath: vi.fn((p) => Promise.resolve(p)),
  validateWritePath: vi.fn((p) => Promise.resolve(p)),
  validateDirectoryPath: vi.fn((p) => Promise.resolve(p)),
}));

// Mock child_process for ShellTool
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, opts, callback) => {
    // If only two args (cmd, callback)
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    // Default success for tests
    callback(null, 'mock output', '');
    return { kill: vi.fn() }; // return mock child process
  })
}));

describe('SystemWorker', () => {
  let worker: SystemWorker;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key';
    worker = new SystemWorker();
    
    // Mock the model invocation
    mockModelResponse(worker, { content: 'Thinking...' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct set of tools', () => {
    const toolNames = (worker as any).tools.map((t: any) => t.name);
    expect(toolNames).toContain('get_system_info');
    expect(toolNames).toContain('execute_shell_command');
  });

  it('should allow safe commands immediately', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'execute_shell_command',
        args: { command: 'echo hello' },
        id: 'call-1'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.awaitingApproval).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBeInstanceOf(ToolMessage);
  });

  it('should trigger HITL for sensitive commands', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'execute_shell_command',
        args: { command: 'npm install' },
        id: 'call-2'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    // Based on current logic, this might be false. I expect it to be true for safety.
    expect(result.awaitingApproval).toBe(true); 
  });
});
