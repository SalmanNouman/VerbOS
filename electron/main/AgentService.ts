import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export class AgentService {
  private model: ChatGoogleGenerativeAI;

  constructor() {
    this.model = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }

  async ask(prompt: string, onToken: (token: string) => void): Promise<void> {
    try {
      const messages = [
        new SystemMessage("You are AugOS, a helpful AI assistant. Provide clear, concise, and accurate responses."),
        new HumanMessage(prompt),
      ];

      const stream = await this.model.stream(messages);

      for await (const chunk of stream) {
        const token = chunk.content as string;
        if (token) {
          onToken(token);
        }
      }
    } catch (error) {
      console.error("Error in AgentService.ask:", error);
      onToken("\n\nError: Failed to get response from AI. Please check your API key and try again.");
    }
  }
}
