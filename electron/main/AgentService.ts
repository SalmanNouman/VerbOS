import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { FileTool } from "./tools/FileTool";
import { SystemTool } from "./tools/SystemTool";

export class AgentService {
  private model: ChatGoogleGenerativeAI;
  private tools: any[];

  constructor() {
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // Initialize tools
    this.tools = [...FileTool.getTools(), ...SystemTool.getTools()];
  }

  async ask(prompt: string, onToken: (token: string) => void): Promise<void> {
    try {
      // Bind tools to the model
      const modelWithTools = this.model.bindTools(this.tools);

      const messages: any[] = [
        new SystemMessage(
          "You are AugOS, a helpful AI assistant with access to file system and system information tools. " +
          "Use tools when necessary to answer questions about files, directories, or system information. " +
          "Always provide clear and concise responses.\n\n" +
          `IMPORTANT: You are running on ${process.platform === 'win32' ? 'Windows' : process.platform}. ` +
          `The user's home directory is: ${require('os').homedir()}. ` +
          `When accessing user folders like Downloads, Documents, Desktop, use the correct path format for this OS. ` +
          `For example, Downloads folder is at: ${require('path').join(require('os').homedir(), 'Downloads')}`
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
        const response = await modelWithTools.invoke(messages);
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
            }
          }
        } else {
          // No more tool calls, stream the final response
          onToken("\n");
          if (typeof response.content === "string") {
            onToken(response.content);
          }
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
