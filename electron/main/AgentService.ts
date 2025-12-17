import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StructuredToolInterface } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { FileTool } from "./tools/FileTool";
import { SystemTool } from "./tools/SystemTool";
import { homedir } from 'os';
import { join } from 'path';
import type { ChatSession, Message } from '../../src/types/verbos';

interface SessionMemory {
  summary: string;
  recentMessages: Message[];
}

export class AgentService {
  private model: ChatGoogleGenerativeAI;
  private tools: StructuredToolInterface[];
  private modelWithTools: ReturnType<typeof this.model.bindTools>;
  private sessions: Map<string, SessionMemory>;

  constructor() {
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // Initialize tools
    this.tools = [...FileTool.getTools(), ...SystemTool.getTools()];
    this.modelWithTools = this.model.bindTools(this.tools);
    
    // Initialize sessions map
    this.sessions = new Map();
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

  private async updateMemory(sessionId: string, userMessage: string, assistantMessage: string): Promise<void> {
    const memory = this.getMemory(sessionId);
    
    // Add new messages to recent messages
    memory.recentMessages.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage }
    );
    
    // Keep only the last 10 messages (5 exchanges) in recent memory
    if (memory.recentMessages.length > 10) {
      const messagesToSummarize = memory.recentMessages.slice(-10);
      memory.recentMessages = memory.recentMessages.slice(-10);
      
      // Generate a summary when we exceed the limit
      const summaryPrompt = `Summarize this conversation history in a concise paragraph:

Previous summary: ${memory.summary || 'No previous summary'}

Recent messages:
${messagesToSummarize.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      
      try {
        const summaryResponse = await this.model.invoke([new HumanMessage(summaryPrompt)]);
        memory.summary = summaryResponse.content as string;
      } catch (error) {
        console.error('Failed to generate summary:', error);
      }
    }
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async ask(sessionId: string, prompt: string, onToken: (token: string) => void): Promise<void> {
    try {
      const memory = this.getMemory(sessionId);
      
      // Build conversation history
      let conversationHistory = '';
      if (memory.summary) {
        conversationHistory += `Previous conversation summary: ${memory.summary}\n\n`;
      }
      if (memory.recentMessages.length > 0) {
        conversationHistory += 'Recent messages:\n';
        conversationHistory += memory.recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
        conversationHistory += '\n\n';
      }
      
      const messages: any[] = [
        new SystemMessage(
          "You are VerbOS, a helpful AI assistant with access to file system and system information tools. " +
          "Use tools when necessary to answer questions about files, directories, or system information. " +
          "Always provide clear and concise responses.\n\n" +
          `IMPORTANT: You are running on ${process.platform === 'win32' ? 'Windows' : process.platform}. ` +
          `The user's home directory is: ${homedir()}. ` +
          `When accessing user folders like Downloads, Documents, Desktop, use the correct path format for this OS. ` +
          `For example, Downloads folder is at: ${join(homedir(), 'Downloads')}\n\n` +
          `Conversation History:\n${conversationHistory}`
        ),
        new HumanMessage(prompt),
      ];

      // Send initial status
      onToken("Thinking...\n");

      // Agentic loop - keep calling until no more tool calls
      let iterations = 0;
      const maxIterations = 10;

      while (iterations < maxIterations) {
        iterations++;

        // Call the model
        const response = await this.modelWithTools.invoke(messages);
        messages.push(response);

        // Check if there are tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          for (const toolCall of response.tool_calls) {
            onToken(`\nUsing tool: ${toolCall.name}...`);

            // Find and execute the tool
            const tool = this.tools.find(t => t.name === toolCall.name);
            if (tool) {
              try {
                const result = await tool.invoke(toolCall.args);
                onToken(" Done\n");

                // Add tool result to messages
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
              onToken(`Error: Tool ${toolCall.name} not found\n`);
              messages.push(new ToolMessage({
                tool_call_id: toolCall.id || "",
                content: `Error: Tool ${toolCall.name} not found`,
              }));
            }
          }
        } else {
          // No more tool calls, stream the final response
          onToken("\n");
          let finalResponse = "";
          if (typeof response.content === "string") {
            finalResponse = response.content;
            onToken(response.content);
          }
          
          // Save the conversation to memory
          await this.updateMemory(sessionId, prompt, finalResponse);
          
          break;
        }
      }

      if (iterations >= maxIterations) {
        onToken("\n\nReached maximum iterations. Please try a simpler request.");
      }
    } catch (error) {
      console.error("Error in AgentService.ask:", error);
      onToken("\n\nError: Failed to get response from AI. Please check your API key and try again.");
    }
  }
}
