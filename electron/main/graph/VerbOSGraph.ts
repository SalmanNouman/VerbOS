import { StateGraph, END, START, CompiledStateGraph } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { GraphState, GraphStateType, NODE_NAMES, WORKER_NAMES } from './state';
import { Supervisor } from './supervisor';
import {
  FileSystemWorker,
  SystemWorker,
  ResearcherWorker,
  CodeWorker,
  BaseWorker,
} from './workers';
import { SQLiteCheckpointer } from './SQLiteCheckpointer';
import type Database from 'better-sqlite3';

/**
 * VerbOSGraph - The main LangGraph implementation for VerbOS.
 * Implements a Supervisor-Worker pattern with HITL support.
 */
export class VerbOSGraph {
  private graph: CompiledStateGraph<any, any, any, any, any, any>;
  private supervisor: Supervisor;
  private workers: Map<string, BaseWorker>;
  private checkpointer: SQLiteCheckpointer;

  constructor(
    db: Database.Database,
    supervisor?: Supervisor,
    workers?: Map<string, BaseWorker>
  ) {
    this.supervisor = supervisor || new Supervisor();
    this.checkpointer = new SQLiteCheckpointer(db);

    // Initialize workers (use provided or default)
    if (workers) {
      this.workers = workers;
    } else {
      this.workers = new Map([
        [WORKER_NAMES.FILESYSTEM, new FileSystemWorker()],
        [WORKER_NAMES.SYSTEM, new SystemWorker()],
        [WORKER_NAMES.RESEARCHER, new ResearcherWorker()],
        [WORKER_NAMES.CODE, new CodeWorker()],
      ]);
    }

    this.graph = this.buildGraph();
  }

  private buildGraph(): CompiledStateGraph<any, any, any, any, any, any> {
    // Use 'as any' to bypass strict type checking on node names
    // LangGraph's TypeScript types are overly strict for dynamic node names
    const workflow = new StateGraph(GraphState) as any;

    // Add supervisor node
    workflow.addNode('supervisor', async (state: GraphStateType) => {
      const result = await this.supervisor.route(state);
      return {
        next: result.next,
        finalResponse: result.finalResponse,
        currentWorker: result.currentWorker,
        iterationCount: state.iterationCount + 1,
      };
    });

    // Add worker nodes
    workflow.addNode('filesystem_worker', async (state: GraphStateType) => {
      const worker = this.workers.get(WORKER_NAMES.FILESYSTEM)!;
      const result = await worker.process(state);
      return {
        messages: result.messages,
        pendingAction: result.pendingAction,
        awaitingApproval: result.awaitingApproval,
        currentWorker: result.awaitingApproval ? WORKER_NAMES.FILESYSTEM : null,
      };
    });

    workflow.addNode('system_worker', async (state: GraphStateType) => {
      const worker = this.workers.get(WORKER_NAMES.SYSTEM)!;
      const result = await worker.process(state);
      return {
        messages: result.messages,
        pendingAction: result.pendingAction,
        awaitingApproval: result.awaitingApproval,
        currentWorker: result.awaitingApproval ? WORKER_NAMES.SYSTEM : null,
      };
    });

    workflow.addNode('researcher_worker', async (state: GraphStateType) => {
      const worker = this.workers.get(WORKER_NAMES.RESEARCHER)!;
      const result = await worker.process(state);
      return {
        messages: result.messages,
        pendingAction: result.pendingAction,
        awaitingApproval: result.awaitingApproval,
        currentWorker: result.awaitingApproval ? WORKER_NAMES.RESEARCHER : null,
      };
    });

    workflow.addNode('code_worker', async (state: GraphStateType) => {
      const worker = this.workers.get(WORKER_NAMES.CODE)!;
      const result = await worker.process(state);
      return {
        messages: result.messages,
        pendingAction: result.pendingAction,
        awaitingApproval: result.awaitingApproval,
        currentWorker: result.awaitingApproval ? WORKER_NAMES.CODE : null,
      };
    });

    // Add human approval node (interrupt point)
    workflow.addNode('human_approval', async () => {
      return {
        awaitingApproval: false,
      };
    });

    // Define edges - Start -> Supervisor
    workflow.addEdge(START, 'supervisor');

    // Supervisor -> Workers or END (conditional)
    workflow.addConditionalEdges(
      'supervisor',
      (state: GraphStateType): string => {
        if (state.next === '__end__' || state.next === END) {
          return '__end__';
        }
        return state.next;
      }
    );

    // Workers -> Human Approval or Supervisor (conditional)
    const workerToNext = (state: GraphStateType): string => {
      if (state.awaitingApproval) {
        return 'human_approval';
      }
      return 'supervisor';
    };

    workflow.addConditionalEdges('filesystem_worker', workerToNext);
    workflow.addConditionalEdges('system_worker', workerToNext);
    workflow.addConditionalEdges('researcher_worker', workerToNext);
    workflow.addConditionalEdges('code_worker', workerToNext);

    // Human Approval -> Supervisor (after approval)
    workflow.addEdge('human_approval', 'supervisor');

    // Compile with checkpointer and interrupt configuration
    return workflow.compile({
      checkpointer: this.checkpointer,
      interruptBefore: ['human_approval'],
      recursionLimit: 50,
    });
  }

  /**
   * Stream events from the graph for a given input
   */
  async *stream(
    threadId: string,
    input: string,
    onEvent?: (event: GraphEvent) => void
  ): AsyncGenerator<GraphEvent> {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    // Check if we're resuming from an interrupt
    const currentState = await this.graph.getState(config);
    
    let inputState: Partial<GraphStateType>;
    
    if (currentState.next.length > 0 && currentState.values.awaitingApproval) {
      // Resuming from interrupt - input is the approval decision
      inputState = {
        awaitingApproval: false,
        pendingAction: null,
      };
    } else {
      // New conversation turn
      inputState = {
        messages: [new HumanMessage(input)],
        iterationCount: 0,
        error: null,
        finalResponse: null,
      };
    }

    try {
      const stream = await this.graph.stream(inputState, {
        ...config,
        streamMode: 'updates',
      });
      
      for await (const event of stream) {
        const graphEvents = this.processEvent(event);
        for (const graphEvent of graphEvents) {
          if (onEvent) onEvent(graphEvent);
          yield graphEvent;
        }
      }

      // Check final state
      const finalState = await this.graph.getState(config);
      
      if (finalState.values.awaitingApproval && finalState.values.pendingAction) {
        const approvalEvent: GraphEvent = {
          type: 'approval_required',
          data: {
            action: finalState.values.pendingAction,
          },
        };
        if (onEvent) onEvent(approvalEvent);
        yield approvalEvent;
      } else if (finalState.values.finalResponse) {
        const completeEvent: GraphEvent = {
          type: 'complete',
          data: {
            response: finalState.values.finalResponse,
          },
        };
        if (onEvent) onEvent(completeEvent);
        yield completeEvent;
      }
    } catch (error) {
      const errorEvent: GraphEvent = {
        type: 'error',
        data: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
      if (onEvent) onEvent(errorEvent);
      yield errorEvent;
    }
  }

  /**
   * Approve a pending action and resume the graph
   */
  async approveAction(threadId: string): Promise<void> {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const state = await this.graph.getState(config);
    
    if (!state.values.pendingAction || !state.values.currentWorker) {
      throw new Error('No pending action to approve');
    }

    const worker = this.workers.get(state.values.currentWorker);
    if (!worker) {
      throw new Error(`Worker ${state.values.currentWorker} not found`);
    }

    // Execute the pending action
    const resultMessages = await worker.executePendingAction(state.values.pendingAction);

    // Update state with the result and resume
    await this.graph.updateState(config, {
      messages: resultMessages,
      pendingAction: null,
      awaitingApproval: false,
    });
  }

  /**
   * Deny a pending action and resume the graph
   */
  async denyAction(threadId: string, reason?: string): Promise<void> {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const state = await this.graph.getState(config);
    
    if (!state.values.pendingAction) {
      throw new Error('No pending action to deny');
    }

    const denyMessage = reason 
      ? `Action denied by user: ${reason}`
      : 'Action denied by user';

    // Update state with denial and resume
    await this.graph.updateState(config, {
      messages: [new HumanMessage(denyMessage)],
      pendingAction: null,
      awaitingApproval: false,
    });
  }

  /**
   * Get the current state of a thread
   */
  async getState(threadId: string) {
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };
    return this.graph.getState(config);
  }

  /**
   * Process raw graph events into typed GraphEvents
   */
  private processEvent(event: Record<string, any>): GraphEvent[] {
    const events: GraphEvent[] = [];
    
    // Event structure: { nodeName: { ...stateUpdates } }
    const nodeName = Object.keys(event)[0];
    const updates = event[nodeName];

    if (!nodeName || !updates) return events;

    // Worker started
    if (Object.values(WORKER_NAMES).includes(nodeName as any)) {
      events.push({
        type: 'worker_started',
        data: {
          worker: nodeName,
        },
      });
    }

    // Supervisor routing
    if (nodeName === NODE_NAMES.SUPERVISOR) {
      if (updates.next && updates.next !== END) {
        events.push({
          type: 'routing',
          data: {
            next: updates.next,
          },
        });
      }
    }

    // Tool execution and results (from messages)
    if (updates.messages && Array.isArray(updates.messages)) {
      for (const msg of updates.messages) {
        // Tool calls (from AI)
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          events.push({
            type: 'tool_call',
            data: {
              tools: msg.tool_calls.map((tc: any) => ({
                name: tc.name,
                args: tc.args,
              })),
            },
          });
        }
        
        // Tool results (from ToolMessage)
        if (msg._getType() === 'tool' || (msg.constructor && msg.constructor.name === 'ToolMessage')) {
          events.push({
            type: 'tool_result',
            data: {
              result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            },
          });
        }
      }
    }

    return events;
  }
}

/**
 * Event types emitted by the graph
 */
export type GraphEvent = 
  | { type: 'worker_started'; data: { worker: string } }
  | { type: 'routing'; data: { next: string } }
  | { type: 'tool_call'; data: { tools: Array<{ name: string; args: any }> } }
  | { type: 'tool_result'; data: { result: string } }
  | { type: 'approval_required'; data: { action: any } }
  | { type: 'complete'; data: { response: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'token'; data: { token: string } };
