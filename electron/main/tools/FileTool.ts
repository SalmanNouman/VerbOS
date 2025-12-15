import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { promises as fs } from 'fs';
import { join } from 'path';
import { validateReadPath, validateWritePath, validateDirectoryPath } from './pathValidation';

/**
 * FileTool provides safe file system operations to the agent
 */
const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit for file operations
const MAX_WRITE_SIZE = 1024 * 1024; // 1MB limit for write operations
export class FileTool {
  static listDirectory = new DynamicStructuredTool({
    name: 'list_directory',
    description: 'List the contents of a directory. Returns an array of file and directory names.',
    schema: z.object({
      path: z.string().describe('The absolute path of the directory to list'),
    }),
    func: async ({ path }) => {
      try {
        console.log('[FileTool] list_directory called with path:', path);
        const validatedPath = await validateDirectoryPath(path);
        console.log('[FileTool] validated path:', validatedPath);
        const items = await fs.readdir(validatedPath, { withFileTypes: true });
        
        const result = await Promise.all(items.map(async item => ({
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          size: item.isFile() ? (await fs.stat(join(validatedPath, item.name))).size : undefined,
        })));
        
        return JSON.stringify(result, null, 2);
      } catch (error) {
        if (error instanceof Error) {
          return `Error: ${error.message}`;
        }
        return 'Unknown error occurred while listing directory';
      }
    },
  });

  static readFile = new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read the contents of a text file. Returns the file content as a string.',
    schema: z.object({
      path: z.string().describe('The absolute path of the file to read'),
      encoding: z.string().optional().default('utf-8').describe('File encoding (default: utf-8)'),
    }),
    func: async ({ path, encoding }) => {
      try {
        const validatedPath = await validateReadPath(path);
        const stats = await fs.stat(validatedPath);
        
        // Check file size limit
        if (stats.size > MAX_FILE_SIZE) {
          return `Error: File too large (${Math.round(stats.size / 1024)}KB). Maximum allowed size is ${MAX_FILE_SIZE / 1024}KB.`;
        }
        
        const content = await fs.readFile(validatedPath, encoding as BufferEncoding);
        return content;
      } catch (error) {
        if (error instanceof Error) {
          return `Error: ${error.message}`;
        }
        return 'Unknown error occurred while reading file';
      }
    },
  });

  static writeFile = new DynamicStructuredTool({
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
    schema: z.object({
      path: z.string().describe('The absolute path of the file to write'),
      content: z.string().describe('The content to write to the file'),
      encoding: z.string().optional().default('utf-8').describe('File encoding (default: utf-8)'),
    }),
    func: async ({ path, content, encoding }) => {
      try {
        // Check content size limit
        if (Buffer.byteLength(content, encoding as BufferEncoding) > MAX_WRITE_SIZE) {
          return `Error: Content too large (${Math.round(Buffer.byteLength(content, encoding as BufferEncoding) / 1024)}KB). Maximum allowed size is ${MAX_WRITE_SIZE / 1024}KB.`;
        }
        
        const validatedPath = await validateWritePath(path);
        await fs.writeFile(validatedPath, content, encoding as BufferEncoding);
        return `Successfully wrote to file: ${validatedPath}`;
      } catch (error) {
        if (error instanceof Error) {
          return `Error: ${error.message}`;
        }
        return 'Unknown error occurred while writing file';
      }
    },
  });

  /**
   * Get all tools as an array
   */
  static getTools() {
    return [
      this.listDirectory,
      this.readFile,
      this.writeFile,
    ];
  }
}
