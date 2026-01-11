import { BaseWorker } from './BaseWorker';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { FileTool } from '../../tools/FileTool';

/**
 * Code Worker is specialized in code analysis and generation.
 * Capabilities: analyze code, generate code, refactor suggestions.
 */
export class CodeWorker extends BaseWorker {
  constructor() {
    const tools = [
      new DynamicStructuredTool({
        name: 'analyze_code',
        description: 'Analyze code for structure, quality, potential bugs, and improvements.',
        schema: z.object({
          code: z.string().describe('The code to analyze'),
          language: z.string().optional().describe('Programming language of the code'),
          focusAreas: z.array(z.enum(['bugs', 'performance', 'security', 'style', 'all'])).default(['all']),
        }),
        func: async ({ code, language, focusAreas }) => {
          const langInfo = language ? ` (${language})` : '';
          const focus = focusAreas.includes('all') ? 'all aspects' : focusAreas.join(', ');
          return `Analyze the following code${langInfo} focusing on ${focus}:\n\n${code}`;
        },
      }),
      new DynamicStructuredTool({
        name: 'generate_code',
        description: 'Generate code based on requirements or specifications.',
        schema: z.object({
          requirements: z.string().describe('Description of what the code should do'),
          language: z.string().describe('Target programming language'),
          style: z.enum(['minimal', 'documented', 'production']).default('documented'),
        }),
        func: async ({ requirements, language, style }) => {
          return `Generate ${style} ${language} code for: ${requirements}`;
        },
      }),
      new DynamicStructuredTool({
        name: 'refactor_code',
        description: 'Suggest refactoring improvements for existing code.',
        schema: z.object({
          code: z.string().describe('The code to refactor'),
          goals: z.array(z.enum(['readability', 'performance', 'maintainability', 'testability'])).default(['readability']),
        }),
        func: async ({ code, goals }) => {
          return `Suggest refactoring for the following code to improve ${goals.join(', ')}:\n\n${code}`;
        },
      }),
      new DynamicStructuredTool({
        name: 'explain_code',
        description: 'Explain what a piece of code does in plain language.',
        schema: z.object({
          code: z.string().describe('The code to explain'),
          detailLevel: z.enum(['brief', 'detailed', 'line-by-line']).default('detailed'),
        }),
        func: async ({ code, detailLevel }) => {
          return `Explain the following code (${detailLevel}):\n\n${code}`;
        },
      }),
      FileTool.readFile,
      FileTool.writeFile,
      FileTool.listDirectory,
    ];

    super({
      name: 'code_worker',
      description: 'Handles code analysis, generation, refactoring, and explanation.',
      tools,
      systemPrompt: `You are a Code Worker, a specialized agent for code-related tasks.

Your capabilities:
- Analyze code for bugs, performance, security, and style (analyze_code)
- Generate code from requirements (generate_code)
- Suggest refactoring improvements (refactor_code)
- Explain code in plain language (explain_code)
- Read files to get code context (read_file)
- Write code to files (write_file)
- List directories to explore project structure (list_directory)

Guidelines:
1. Always consider best practices for the target language.
2. Provide actionable suggestions, not just observations.
3. When generating code, include necessary imports and error handling.
4. Consider edge cases and potential issues.
5. Format code properly with appropriate indentation.
6. Use read_file to fetch code content before analyzing it.

When you complete your task, provide the code or analysis with clear explanations.`,
    });
  }
}
