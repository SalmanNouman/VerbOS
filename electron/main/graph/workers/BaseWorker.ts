import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { GraphStateType, PendingAction } from '../state';
import { getCommandSensitivity } from '../../tools/ShellTool';
import { GraphLogger } from '../logger';

export interface WorkerConfig {
  name: string;
  description: string;
  tools: StructuredToolInterface[];
  systemPrompt: string;
  useLocalModel?: boolean;
}

export interface WorkerResult {
  messages: BaseMessage[];
  pendingAction?: PendingAction | null;
  awaitingApproval?: boolean;
}

/**
 * Determines the sensitivity of a tool call for HITL purposes
 */
export function getToolSensitivity(
  toolName: string,
  toolArgs: Record<string, unknown>
): 'safe' | 'moderate' | 'sensitive' {
  // File operations
  if (toolName === 'read_file' || toolName === 'list_directory') {
    return 'safe';
  }
  if (toolName === 'write_file' || toolName === 'create_directory' || toolName === 'delete_file') {
    return 'sensitive';
  }

  // System operations
  if (toolName === 'get_system_info') {
    return 'safe';
  }

  // Shell commands
  if (toolName === 'execute_shell_command') {
    const command = toolArgs.command as string;
    return getCommandSensitivity(command);
  }

  // Code analysis tools (read-only/generative)
  const codeTools = ['analyze_code', 'generate_code', 'refactor_code', 'explain_code'];
  if (codeTools.includes(toolName)) {
    return 'safe';
  }

  // Research tools (read-only)
  const researchTools = ['summarize_context', 'extract_facts', 'analyze_code_context'];
  if (researchTools.includes(toolName)) {
    return 'safe';
  }

  // Default to sensitive for unknown tools (Strict Security)
  return 'sensitive';
}

/**
 * Base class for all worker nodes in the graph.
 * Workers are specialized agents that handle specific types of tasks.
 */
export abstract class BaseWorker {
  protected name: string;
  protected description: string;
  protected tools: StructuredToolInterface[];
  protected systemPrompt: string;
  protected model: ChatGoogleGenerativeAI | ChatOllama;
  protected modelWithTools: ReturnType<ChatGoogleGenerativeAI['bindTools']>;

  constructor(config: WorkerConfig) {
    this.name = config.name;
    this.description = config.description;
    this.tools = config.tools;
    this.systemPrompt = config.systemPrompt;

    // Use local Ollama model for privacy-sensitive workers (like Researcher)
    if (config.useLocalModel) {
      this.model = new ChatOllama({
        model: 'llama3.2',
        baseUrl: 'http://localhost:11434',
      });
    } else {
      this.model = new ChatGoogleGenerativeAI({
        model: 'gemini-2.0-flash',
        apiKey: process.env.GOOGLE_API_KEY,
      });
    }

    this.modelWithTools = this.model.bindTools(this.tools);
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  /**
   * Process the current state and return updated messages.
   * If a sensitive action is detected, returns a pending action for HITL.
   */
  async process(state: GraphStateType): Promise<WorkerResult> {
    const messages = [...state.messages];
    GraphLogger.debug('WORKER', `Worker ${this.name} processing ${messages.length} messages`);

    try {
      // Invoke the model with tools
      const response = await this.modelWithTools.invoke(messages);
      const resultMessages: BaseMessage[] = [response];

      // Check for tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        for (const toolCall of response.tool_calls) {
          GraphLogger.info('TOOL', `Worker ${this.name} calling tool: ${toolCall.name}`, toolCall.args);
          
          if (!toolCall.id) {
            GraphLogger.warn('TOOL', `Tool call ${toolCall.name} missing ID, generating one`);
            toolCall.id = crypto.randomUUID();
          }

          const tool = this.tools.find(t => t.name === toolCall.name);
          
          if (!tool) {
            const errorMsg = `Error: Tool ${toolCall.name} not found`;
            GraphLogger.error('TOOL', errorMsg);
            resultMessages.push(new ToolMessage({
              tool_call_id: toolCall.id,
              content: `Error: Tool ${toolCall.name} not found`,
            }));
            continue;
          }

          // Check sensitivity for HITL
          const sensitivity = getToolSensitivity(toolCall.name, toolCall.args as Record<string, unknown>);
          
          if (sensitivity === 'sensitive') {
            GraphLogger.info('WORKER', `Sensitive action detected for ${toolCall.name}, awaiting approval`);
            // Return pending action for user approval
            const pendingAction: PendingAction = {
              id: toolCall.id,
              workerName: this.name,
              toolName: toolCall.name,
              toolArgs: toolCall.args as Record<string, unknown>,
              sensitivity,
              description: this.describeAction(toolCall.name, toolCall.args as Record<string, unknown>),
            };

            return {
              messages: resultMessages,
              pendingAction,
              awaitingApproval: true,
            };
          }

          // Execute safe/moderate tools immediately
          try {
            const result = await tool.invoke(toolCall.args);
            GraphLogger.debug('TOOL', `Tool ${toolCall.name} returned result`);
            resultMessages.push(new ToolMessage({
              tool_call_id: toolCall.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            }));
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            GraphLogger.error('TOOL', `Tool ${toolCall.name} failed: ${errorMsg}`);
            resultMessages.push(new ToolMessage({
              tool_call_id: toolCall.id,
              content: `Error: ${errorMsg}`,
            }));
          }
        }
      }

      return {
        messages: resultMessages,
        pendingAction: null,
        awaitingApproval: false,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      GraphLogger.error('WORKER', `Worker ${this.name} error: ${errorMsg}`, { stack });
      return {
        messages: [new AIMessage(`Worker ${this.name} encountered an error: ${errorMsg}`)],
        pendingAction: null,
        awaitingApproval: false,
      };
    }
  }

  /**
   * Execute a pending action after user approval
   */
  async executePendingAction(action: PendingAction): Promise<BaseMessage[]> {
    GraphLogger.info('WORKER', `Executing pending action: ${action.toolName} for worker ${this.name}`);
    const tool = this.tools.find(t => t.name === action.toolName);
    
    if (!tool) {
      return [new ToolMessage({
        tool_call_id: action.id,
        content: `Error: Tool ${action.toolName} not found`,
      })];
    }

    try {
      const result = await tool.invoke(action.toolArgs);
      return [new ToolMessage({
        tool_call_id: action.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      })];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return [new ToolMessage({
        tool_call_id: action.id,
        content: `Error: ${errorMsg}`,
      })];
    }
  }

  /**
   * Generate a human-readable description of an action for HITL UI
   */
  protected describeAction(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'write_file':
        return `Write to file: ${args.path}`;
      case 'create_directory':
        return `Create directory: ${args.path}`;
      case 'delete_file':
        return `Delete file: ${args.path}`;
      case 'execute_shell_command':
        return `Execute shell command: ${args.command}`;
      default:
        return `Execute ${toolName} with args: ${JSON.stringify(args)}`;
    }
  }
}
