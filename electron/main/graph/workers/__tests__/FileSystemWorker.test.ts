import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileSystemWorker } from '../FileSystemWorker';
import type { GraphStateType } from '../../state';
import { mockModelResponse } from './test-utils';

// Mock the dependencies
vi.mock('fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(), // For delete
    stat: vi.fn(),
  }
}));

// Mock path validation to always pass for tests
vi.mock('../../tools/pathValidation', () => ({
  validateReadPath: vi.fn((p) => Promise.resolve(p)),
  validateWritePath: vi.fn((p) => Promise.resolve(p)),
  validateDirectoryPath: vi.fn((p) => Promise.resolve(p)),
}));

describe('FileSystemWorker', () => {
  let worker: FileSystemWorker;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key';
    worker = new FileSystemWorker();
    
    // Mock the model invocation
    mockModelResponse(worker, { content: 'Thinking...' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct set of tools', () => {
    const toolNames = (worker as any).tools.map((t: any) => t.name);
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('list_directory');
    // Expect delete_file to be present as per spec
    expect(toolNames).toContain('delete_file');
  });

  it('should trigger HITL for write_file', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'write_file',
        args: { path: '/test/file.txt', content: 'test' },
        id: 'call-1'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.awaitingApproval).toBe(true);
    expect(result.pendingAction?.toolName).toBe('write_file');
  });

  it('should trigger HITL for delete_file', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'delete_file',
        args: { path: '/test/file.txt' },
        id: 'call-2'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.awaitingApproval).toBe(true);
    expect(result.pendingAction?.toolName).toBe('delete_file');
  });
});
