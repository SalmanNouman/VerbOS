import { describe, it, expect } from 'vitest';
import { WORKER_NAMES, NODE_NAMES, MAX_ITERATIONS } from '../state';

describe('Shared Graph Types and Constants', () => {
  it('should have correct worker names', () => {
    expect(WORKER_NAMES.FILESYSTEM).toBe('filesystem_worker');
    expect(WORKER_NAMES.SYSTEM).toBe('system_worker');
    expect(WORKER_NAMES.RESEARCHER).toBe('researcher_worker');
    expect(WORKER_NAMES.CODE).toBe('code_worker');
  });

  it('should have correct node names', () => {
    expect(NODE_NAMES.SUPERVISOR).toBe('supervisor');
    expect(NODE_NAMES.HUMAN_APPROVAL).toBe('human_approval');
    expect(NODE_NAMES.END).toBe('__end__');
    expect(NODE_NAMES.FILESYSTEM).toBe('filesystem_worker');
  });

  it('should have correct max iterations', () => {
    expect(MAX_ITERATIONS).toBe(15);
  });
});
