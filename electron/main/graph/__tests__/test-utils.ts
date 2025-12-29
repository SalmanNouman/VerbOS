import { vi } from 'vitest';

export const createMockSupervisor = (responses: any[]) => {
  const route = vi.fn();
  responses.forEach(response => {
    route.mockResolvedValueOnce(response);
  });
  return { route };
};
