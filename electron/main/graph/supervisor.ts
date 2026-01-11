import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { GraphStateType } from './state';
import { WORKER_NAMES, NODE_NAMES, MAX_ITERATIONS, MAX_TOOL_OUTPUT_LENGTH, MAX_MESSAGES_FOR_SUPERVISOR } from './state';
import { homedir } from 'os';
import { platform } from 'os';
import { GraphLogger } from './logger';

/**
 * Structured output schema for supervisor routing decisions
 */
const SupervisorDecisionSchema = z.object({
  reasoning: z.string().describe('Brief explanation of the routing decision'),
  next: z.enum([
    WORKER_NAMES.FILESYSTEM,
    WORKER_NAMES.SYSTEM,
    WORKER_NAMES.RESEARCHER,
    WORKER_NAMES.CODE,
    'FINISH',
  ]).describe('The next worker to route to, or FINISH if the task is complete'),
  finalResponse: z.string().optional().describe('Final response to the user (only if next is FINISH)'),
});

type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;

/**
 * Supervisor Node - Central orchestrator that routes tasks to specialized workers.
 * Uses structured output to ensure reliable routing decisions.
 */
export class Supervisor {
  private model: BaseChatModel;

  constructor(model?: BaseChatModel) {
    this.model = model || new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }

  private buildSystemPrompt(): string {
    return `You are the Supervisor of VerbOS, an AI assistant with deep OS integration.
Your role is to analyze user requests and route them to the appropriate specialized worker.

Available Workers:
1. ${WORKER_NAMES.FILESYSTEM} - Handles file operations: reading, writing, listing files/directories
2. ${WORKER_NAMES.SYSTEM} - Handles system info and shell commands (npm, git, ping, etc.)
3. ${WORKER_NAMES.RESEARCHER} - Handles summarization, information extraction, context analysis (privacy-focused, runs locally)
4. ${WORKER_NAMES.CODE} - Handles code analysis, generation, refactoring, and explanation

Environment:
- Platform: ${platform()}
- User Home: ${homedir()}

Routing Guidelines:
1. For file read/write/list operations -> ${WORKER_NAMES.FILESYSTEM}
2. For system info, npm/git commands, network diagnostics -> ${WORKER_NAMES.SYSTEM}
3. For summarizing content, extracting facts, analyzing context -> ${WORKER_NAMES.RESEARCHER}
4. For code analysis, generation, refactoring, explanation -> ${WORKER_NAMES.CODE}
5. For complex tasks, route to workers in sequence (e.g., read file -> analyze code)

Decision Rules:
- If a worker has just completed a task and the overall goal is achieved, choose FINISH
- If a worker's output needs to be processed by another worker, route accordingly
- If the user's request is a simple question that doesn't need tools, choose FINISH and provide the answer
- Always provide a finalResponse when choosing FINISH

Analyze the conversation history to understand:
1. What the user originally requested
2. What workers have already done
3. What still needs to be done`;
  }

  /**
   * Process the current state and decide the next routing action
   */
  async route(state: GraphStateType): Promise<{
    next: string;
    finalResponse: string | null;
    currentWorker: string | null;
  }> {
    // Check iteration limit
    if (state.iterationCount >= MAX_ITERATIONS) {
      return {
        next: NODE_NAMES.END,
        finalResponse: 'I apologize, but I reached the maximum number of steps for this task. Please try breaking down your request into smaller parts.',
        currentWorker: null,
      };
    }

    // Check for errors
    if (state.error) {
      return {
        next: NODE_NAMES.END,
        finalResponse: `An error occurred: ${state.error}`,
        currentWorker: null,
      };
    }

    // Filter and prune messages for supervisor context
    const filteredMessages = this.filterMessagesForSupervisor(state.messages);
    const prunedMessages = this.pruneMessages(filteredMessages, MAX_MESSAGES_FOR_SUPERVISOR);
    
    // Prepend task summary if available
    const contextMessages = state.taskSummary 
      ? [new HumanMessage(`[Previous Task Summary]: ${state.taskSummary}`), ...prunedMessages]
      : prunedMessages;

    const messages = [
      new SystemMessage(this.buildSystemPrompt()),
      ...contextMessages,
      new HumanMessage('Based on the conversation above, decide the next action. If the task is complete, provide a final response.'),
    ];

    try {
      const modelWithStructuredOutput = this.model.withStructuredOutput(SupervisorDecisionSchema, {
        name: 'supervisor_decision',
      });
      const decision = await modelWithStructuredOutput.invoke(messages) as SupervisorDecision;

      GraphLogger.info('GRAPH', `Decision: ${decision.next} - ${decision.reasoning}`);

      if (decision.next === 'FINISH') {
        return {
          next: NODE_NAMES.END,
          finalResponse: decision.finalResponse || 'Task completed.',
          currentWorker: null,
        };
      }

      return {
        next: decision.next,
        finalResponse: null,
        currentWorker: decision.next,
      };
    } catch (error) {
      GraphLogger.error('GRAPH', 'Error making decision', error);
      return {
        next: NODE_NAMES.END,
        finalResponse: 'I encountered an error while processing your request. Please try again.',
        currentWorker: null,
      };
    }
  }

  /**
   * Filter messages for supervisor context by truncating verbose tool outputs
   */
  private filterMessagesForSupervisor(messages: BaseMessage[]): BaseMessage[] {
    return messages.map(msg => {
      if (msg instanceof ToolMessage) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        // Truncate verbose tool outputs
        if (content.length > MAX_TOOL_OUTPUT_LENGTH) {
          return new ToolMessage({
            tool_call_id: msg.tool_call_id,
            content: content.substring(0, MAX_TOOL_OUTPUT_LENGTH) + '... [truncated]',
          });
        }
      }
      return msg;
    });
  }

  /**
   * Prune messages to prevent context overflow, keeping most recent messages
   */
  private pruneMessages(messages: BaseMessage[], maxCount: number): BaseMessage[] {
    if (messages.length <= maxCount) {
      return messages;
    }
    
    // Keep the most recent messages
    return messages.slice(-maxCount);
  }
}
