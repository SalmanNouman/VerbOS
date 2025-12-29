import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResearcherWorker } from '../ResearcherWorker';
import { AIMessage } from '@langchain/core/messages';
import type { GraphStateType } from '../../state';
import { mockModelResponse } from './test-utils';

describe('ResearcherWorker', () => {
  let worker: ResearcherWorker;

  beforeEach(() => {
    // Mock local model usage
    worker = new ResearcherWorker();
    
    // Mock the model invocation
    mockModelResponse(worker, { content: 'Thinking...' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct set of tools', () => {
    const toolNames = (worker as any).tools.map((t: any) => t.name);
    expect(toolNames).toContain('summarize_context');
    expect(toolNames).toContain('extract_facts');
    expect(toolNames).toContain('analyze_code_context');
    // ResearcherWorker needs to read files to summarize them
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('list_directory');
  });

  it('should use summarize_context tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'summarize_context',
        args: { text: 'Long text...', maxPoints: 3 },
        id: 'call-1'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('summarize the following text into 3 key points');
  });

  it('should use extract_facts tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'extract_facts',
        args: { text: 'Facts...', topic: 'science' },
        id: 'call-2'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('Focus on facts related to: science');
  });

  it('should use analyze_code_context tool correctly', async () => {
    mockModelResponse(worker, {
      tool_calls: [{
        name: 'analyze_code_context',
        args: { code: 'const x = 1;', analysisType: 'issues' },
        id: 'call-3'
      }]
    });

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.messages[1].content).toContain('analyze the following code for issues');
  });
});
