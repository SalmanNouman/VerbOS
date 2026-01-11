import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeWorker } from '../CodeWorker';
import { ToolMessage } from '@langchain/core/messages';
import type { GraphStateType } from '../../state';
import { mockModelResponse } from './test-utils';

describe('CodeWorker', () => {
  let worker: CodeWorker;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key';
    worker = new CodeWorker();
    
    // Mock the model invocation
    mockModelResponse(worker, { content: 'Thinking...' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct set of tools', () => {
    const toolNames = (worker as any).tools.map((t: any) => t.name);
    expect(toolNames).toContain('analyze_code');
    expect(toolNames).toContain('generate_code');
    expect(toolNames).toContain('refactor_code');
    expect(toolNames).toContain('explain_code');
    // CodeWorker needs to read files to analyze them
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('list_directory');
  });

  it('should use analyze_code tool correctly', async () => {
    // Mock model choosing to call analyze_code
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'analyze_code',
        args: { code: 'const a = 1;', focusAreas: ['bugs'] },
        id: 'call-1'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBeInstanceOf(ToolMessage);
    // The tool returns a prompt string
    expect(result.messages[1].content).toContain('Analyze the following code');
    expect(result.messages[1].content).toContain('focusing on bugs');
  });

  it('should use generate_code tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'generate_code',
        args: { requirements: 'A function to add numbers', language: 'typescript', style: 'minimal' },
        id: 'call-2'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('Generate minimal typescript code for: A function to add numbers');
  });

  it('should use refactor_code tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'refactor_code',
        args: { code: 'var x = 1;', goals: ['readability'] },
        id: 'call-3'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('Suggest refactoring for the following code');
    expect(result.messages[1].content).toContain('readability');
  });

  it('should use explain_code tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'explain_code',
        args: { code: 'console.log("hi")', detailLevel: 'brief' },
        id: 'call-4'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('Explain the following code (brief)');
  });
});
