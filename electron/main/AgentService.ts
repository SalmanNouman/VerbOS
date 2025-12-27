import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { StructuredToolInterface } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { FileTool } from "./tools/FileTool";
import { SystemTool } from "./tools/SystemTool";
import { StorageService } from "./storage";
import { homedir } from 'os';
import { join } from 'path';
import type { Message } from '../../src/types/verbos';

interface SmartContextConfig {
  maxRecentMessages: number;
  summarizationThreshold: number;
  localModelName: string;
  ollamaBaseUrl: string;
}

const DEFAULT_CONFIG: SmartContextConfig = {
  maxRecentMessages: 10,
  summarizationThreshold: 20, // Trigger summarization when total message count exceeds this
  localModelName: "llama3.2",
  ollamaBaseUrl: "http://localhost:11434",
};

export class AgentService {
  private chatModel: ChatGoogleGenerativeAI;
  private summaryModel: ChatOllama;
  private tools: StructuredToolInterface[];
  private modelWithTools: ReturnType<typeof this.chatModel.bindTools>;
  private storage: StorageService;
  private config: SmartContextConfig;

  constructor(storage: StorageService, config: Partial<SmartContextConfig> = {}) {
    this.storage = storage;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.chatModel = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    });

    this.summaryModel = new ChatOllama({
      model: this.config.localModelName,
      baseUrl: this.config.ollamaBaseUrl,
    });

    this.tools = [...FileTool.getTools(), ...SystemTool.getTools()];
    this.modelWithTools = this.chatModel.bindTools(this.tools);

    console.log(`[AgentService] Initialized (Chat: Gemini, Summary: Ollama ${this.config.localModelName})`);
  }

  /**
   * Summarizes history locally using Ollama to maintain privacy.
   * This now updates persistent storage instead of in-memory state.
   */
  private async updateMemory(sessionId: string): Promise<void> {
    try {
      // Get current summary and all messages
      const summary = this.storage.getSummary(sessionId);
      const session = this.storage.getSession(sessionId);

      if (!session || session.messages.length < this.config.summarizationThreshold) {
        return; // Not enough messages to warrant summarization
      }

      const allMessages = session.messages;
      const messagesToSummarize = allMessages.slice(0, allMessages.length - this.config.maxRecentMessages);

      if (messagesToSummarize.length === 0) {
        return; // Nothing new to summarize
      }

      const summaryPrompt = `Summarize the following conversation history concisely, preserving key facts and user state. 
Be factual. Do not repeat the history verbatim.

Previous summary: ${summary || 'None'}

New messages:
${messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

Concise summary:`;

      const summaryResponse = await this.summaryModel.invoke([new HumanMessage(summaryPrompt)]);
      const newSummary = typeof summaryResponse.content === 'string'
        ? summaryResponse.content
        : JSON.stringify(summaryResponse.content);

      this.storage.updateSummary(sessionId, newSummary);
      console.log(`[AgentService] Updated summary for session ${sessionId}`);
    } catch (error) {
      console.error('[AgentService] Local summarization failed (non-fatal):', error);
      // Summarization failure is non-fatal; we continue with raw message history
    }
  }

  clearSession(sessionId: string): void {
    // With persistent storage, "clearing" just means we don't need to do anything here
    // The session remains in the database. If we wanted to clear memory, we'd delete from storage.
    console.log(`[AgentService] Session ${sessionId} cleared from memory (persisted in DB)`);
  }

  private buildSystemInstructions(sessionId: string): string {
    const summary = this.storage.getSummary(sessionId);
    const recentMessages = this.storage.getRecentMessages(sessionId, this.config.maxRecentMessages);

    let historySection = '';
    if (summary) {
      historySection += `CONVERSATION SUMMARY (Local Context):\n${summary}\n\n`;
    }
    if (recentMessages.length > 0) {
      historySection += 'RECENT MESSAGES:\n';
      historySection += recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
      historySection += '\n\n';
    }

    return (
      "You are VerbOS, a secure AI assistant with deep OS integration via provided tools.\n" +
      "Use tools for any file system or system information requests.\n" +
      "Always provide precise, professional, and actionable responses.\n\n" +
      `ENVIRONMENT:\n` +
      `- OS: ${process.platform === 'win32' ? 'Windows' : process.platform}\n` +
      `- User Home: ${homedir()}\n` +
      `- Important Paths: Downloads at ${join(homedir(), 'Downloads')}, Documents at ${join(homedir(), 'Documents')}\n\n` +
      historySection
    );
  }

  async ask(sessionId: string, prompt: string, onToken: (token: string) => void): Promise<void> {
    try {
      // Save user message to storage immediately
      this.storage.addMessage(sessionId, 'user', prompt);

      const messages: BaseMessage[] = [
        new SystemMessage(this.buildSystemInstructions(sessionId)),
        new HumanMessage(prompt),
      ];

      onToken("Thinking...\n");

      let iterations = 0;
      const maxIterations = 8;
      let assistantResponse = '';

      while (iterations < maxIterations) {
        iterations++;

        const response = await this.modelWithTools.invoke(messages);
        messages.push(response);

        if (response.tool_calls && response.tool_calls.length > 0) {
          for (const toolCall of response.tool_calls) {
            onToken(`\nUsing tool: ${toolCall.name}...`);

            const tool = this.tools.find(t => t.name === toolCall.name);
            if (tool) {
              try {
                const result = await tool.invoke(toolCall.args);
                onToken(" ✅ Done\n");
                messages.push(new ToolMessage({
                  tool_call_id: toolCall.id || "",
                  content: result,
                }));
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                onToken(` ❌ Failed: ${errorMsg}\n`);
                messages.push(new ToolMessage({
                  tool_call_id: toolCall.id || "",
                  content: `Error: ${errorMsg}`,
                }));
              }
            } else {
              const errorMsg = `Tool ${toolCall.name} not found`;
              onToken(` ❌ Failed: ${errorMsg}\n`);
              messages.push(new ToolMessage({
                tool_call_id: toolCall.id || "",
                content: `Error: ${errorMsg}`,
              }));
            }
          }
        } else {
          onToken("\n");
          const finalResponse = typeof response.content === "string" ? response.content : "";
          onToken(finalResponse);
          assistantResponse = finalResponse;

          // Save assistant message to storage
          this.storage.addMessage(sessionId, 'assistant', assistantResponse);

          // Trigger summarization if needed (async, non-blocking)
          this.updateMemory(sessionId).catch(err =>
            console.error('[AgentService] Background summarization failed:', err)
          );

          break;
        }
      }

      if (iterations >= maxIterations) {
        const fallbackMsg = "\n\nAgent logic reached session threshold. Please refine your request.";
        onToken(fallbackMsg);
        assistantResponse = fallbackMsg;
      }
    } catch (error) {
      console.error("AgentService.ask Error:", error);
      const errorMsg = "\n\nCommunication failure. Ensure your API keys and local Ollama instance are active.";
      onToken(errorMsg);
    }
  }
}
