import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { StructuredToolInterface } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage } from "@langchain/core/messages";
import { FileTool } from "./tools/FileTool";
import { SystemTool } from "./tools/SystemTool";
import { homedir } from 'os';
import { join } from 'path';
import type { Message } from '../../src/types/verbos';

interface SessionMemory {
  summary: string;
  recentMessages: Message[];
}

interface SmartContextConfig {
  maxRecentMessages: number;
  localModelName: string;
  ollamaBaseUrl: string;
}

const DEFAULT_CONFIG: SmartContextConfig = {
  maxRecentMessages: 10,
  localModelName: "llama3.2",
  ollamaBaseUrl: "http://localhost:11434",
};

export class AgentService {
  private chatModel: ChatGoogleGenerativeAI;
  private summaryModel: ChatOllama;
  private tools: StructuredToolInterface[];
  private modelWithTools: ReturnType<typeof this.chatModel.bindTools>;
  private sessions: Map<string, SessionMemory> = new Map();
  private config: SmartContextConfig;

  constructor(config: Partial<SmartContextConfig> = {}) {
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

  private getMemory(sessionId: string): SessionMemory {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        summary: '',
        recentMessages: []
      });
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Summarizes history locally using Ollama to maintain privacy before context reaches the cloud.
   */
  private async updateMemory(sessionId: string, userMessage: string, assistantMessage: string): Promise<void> {
    const memory = this.getMemory(sessionId);

    memory.recentMessages.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage }
    );

    if (memory.recentMessages.length > this.config.maxRecentMessages) {
      const messagesToSummarize = memory.recentMessages.slice(0, memory.recentMessages.length - this.config.maxRecentMessages);
      memory.recentMessages = memory.recentMessages.slice(-this.config.maxRecentMessages);

      const summaryPrompt = `Summarize the following conversation history concisely, preserving key facts and user state. 
Be factual. Do not repeat the history verbatim.

Previous summary: ${memory.summary || 'None'}

New messages:
${messagesToSummarize.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}

Concise summary:`;

      try {
        const summaryResponse = await this.summaryModel.invoke([new HumanMessage(summaryPrompt)]);
        memory.summary = typeof summaryResponse.content === 'string'
          ? summaryResponse.content
          : JSON.stringify(summaryResponse.content);
      } catch (error) {
        console.error('[AgentService] Local summarization failed. Using aggressive truncation for privacy.');
        // Fallback: Aggressive truncation to avoid leaking raw text to the cloud in the next request
        const fallbackSummary = messagesToSummarize
          .map(m => `[${m.role.toUpperCase()}: ${m.content.substring(0, 30)}...]`)
          .join(' ');
        memory.summary = memory.summary
          ? `${memory.summary} (Partially summarized: ${fallbackSummary})`
          : fallbackSummary;
      }
    }
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[AgentService] Session ${sessionId} cleared.`);
  }

  private buildSystemInstructions(memory: SessionMemory): string {
    let historySection = '';
    if (memory.summary) {
      historySection += `CONVERSATION SUMMARY (Local Context):\n${memory.summary}\n\n`;
    }
    if (memory.recentMessages.length > 0) {
      historySection += 'RECENT MESSAGES:\n';
      historySection += memory.recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
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
      const memory = this.getMemory(sessionId);
      const messages: BaseMessage[] = [
        new SystemMessage(this.buildSystemInstructions(memory)),
        new HumanMessage(prompt),
      ];

      onToken("Thinking...\n");

      let iterations = 0;
      const maxIterations = 8;

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
                onToken(" Done\n");
                messages.push(new ToolMessage({
                  tool_call_id: toolCall.id || "",
                  content: result,
                }));
              } catch (error) {
                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                onToken(` Error: ${errorMsg}\n`);
                messages.push(new ToolMessage({
                  tool_call_id: toolCall.id || "",
                  content: `Error: ${errorMsg}`,
                }));
              }
            } else {
              const errorMsg = `Tool ${toolCall.name} not found`;
              onToken(` Error: ${errorMsg}\n`);
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

          await this.updateMemory(sessionId, prompt, finalResponse);
          break;
        }
      }

      if (iterations >= maxIterations) {
        onToken("\n\nAgent logic reached session threshold. Please refine your request.");
      }
    } catch (error) {
      console.error("AgentService.ask Error:", error);
      onToken("\n\nCommunication failure. Ensure your API keys and local Ollama instance are active.");
    }
  }
}
