import { BaseWorker } from './BaseWorker';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FileTool } from '../../tools/FileTool';

/**
 * Researcher Worker summarizes context and handles information retrieval.
 * Privacy-focused: uses Local Ollama by default.
 */
export class ResearcherWorker extends BaseWorker {
  constructor() {
    const tools = [
      new DynamicStructuredTool({
        name: 'summarize_context',
        description: 'Summarize provided text or conversation context into key points.',
        schema: z.object({
          text: z.string().describe('The text to summarize'),
          maxPoints: z.number().optional().default(5).describe('Maximum number of key points'),
        }),
        func: async ({ text, maxPoints }) => {
          // This tool is a placeholder - the actual summarization is done by the LLM
          return `Please summarize the following text into ${maxPoints} key points:\n\n${text}`;
        },
      }),
      new DynamicStructuredTool({
        name: 'extract_facts',
        description: 'Extract factual information from provided text.',
        schema: z.object({
          text: z.string().describe('The text to extract facts from'),
          topic: z.string().optional().describe('Specific topic to focus on'),
        }),
        func: async ({ text, topic }) => {
          const focusText = topic ? ` Focus on facts related to: ${topic}` : '';
          return `Please extract key facts from the following text.${focusText}\n\n${text}`;
        },
      }),
      new DynamicStructuredTool({
        name: 'analyze_code_context',
        description: 'Analyze code context and provide insights about structure, patterns, or issues.',
        schema: z.object({
          code: z.string().describe('The code to analyze'),
          analysisType: z.enum(['structure', 'patterns', 'issues', 'general']).default('general'),
        }),
        func: async ({ code, analysisType }) => {
          return `Please analyze the following code for ${analysisType}:\n\n${code}`;
        },
      }),
      FileTool.readFile,
      FileTool.listDirectory,
    ];

    super({
      name: 'researcher_worker',
      description: 'Handles information retrieval, summarization, and context analysis. Privacy-focused.',
      tools,
      systemPrompt: `You are a Researcher Worker, a specialized agent for information processing.

Your capabilities:
- Summarize text and conversations (summarize_context)
- Extract factual information (extract_facts)
- Analyze code context (analyze_code_context)
- Read files to get context (read_file)
- List directories to explore (list_directory)

Guidelines:
1. Be concise but comprehensive in summaries.
2. Focus on actionable and relevant information.
3. When analyzing code, identify patterns and potential issues.
4. Maintain privacy - you run locally to minimize data exposure.
5. Provide structured output when possible.
6. Use read_file to fetch content before summarizing it.

When you complete your task, provide a clear summary of findings.`,
      useLocalModel: true, // Privacy-focused: use local Ollama
    });
  }
}
