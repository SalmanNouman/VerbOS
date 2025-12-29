import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * Pending action that requires user approval (HITL)
 */
export interface PendingAction {
  id: string;
  workerName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  sensitivity: 'safe' | 'moderate' | 'sensitive';
  description: string;
}

/**
 * Reducer for iteration count - increments by 1 if next is null/undefined,
 * otherwise sets to the provided value.
 */
export const iterationCountReducer = (current: number, next?: number | null) => 
  next ?? current + 1;

/**
 * Graph State Schema for the VerbOS multi-agent system.
 * Uses LangGraph's Annotation pattern for type-safe state management.
 */
export const GraphState = Annotation.Root({
  // Message history with automatic reducer for appending
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Current active worker (null when at supervisor)
  currentWorker: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Next node to route to (set by supervisor)
  next: Annotation<string>({
    reducer: (_, next) => next,
    default: () => 'supervisor',
  }),

  // Pending action awaiting user approval (HITL)
  pendingAction: Annotation<PendingAction | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Whether the graph is waiting for user approval
  awaitingApproval: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),

  // Final response to return to user (set when complete)
  finalResponse: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Error state for graceful error handling
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Iteration count to prevent infinite loops
  iterationCount: Annotation<number>({
    reducer: iterationCountReducer,
    default: () => 0,
  }),
});

export type GraphStateType = typeof GraphState.State;

/**
 * Worker names for routing
 */
export const WORKER_NAMES = {
  FILESYSTEM: 'filesystem_worker',
  SYSTEM: 'system_worker',
  RESEARCHER: 'researcher_worker',
  CODE: 'code_worker',
} as const;

export type WorkerName = typeof WORKER_NAMES[keyof typeof WORKER_NAMES];

/**
 * Node names in the graph
 */
export const NODE_NAMES = {
  SUPERVISOR: 'supervisor',
  ...WORKER_NAMES,
  HUMAN_APPROVAL: 'human_approval',
  END: '__end__',
} as const;

/**
 * Maximum iterations before forcing end
 */
export const MAX_ITERATIONS = 15;
