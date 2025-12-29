import { vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';

/**
 * Mocks the modelWithTools.invoke method on a worker.
 */
export function mockModelResponse(worker: any, { content = '', tool_calls = [] }: { content?: string; tool_calls?: any[] }) {
  return vi.spyOn(worker.modelWithTools, 'invoke').mockResolvedValue(new AIMessage({
    content,
    tool_calls,
  }));
}
