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
      // Errors will be caught by the AgentService
      const validatedPath = await validateDirectoryPath(path);
      const items = await fs.readdir(validatedPath, { withFileTypes: true });
      
      const result = await Promise.all(items.map(async item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        size: item.isFile() ? (await fs.stat(join(validatedPath, item.name))).size : undefined,
      })));
      
      return JSON.stringify(result, null, 2);
    },
  });

  static readFile = new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read the contents of a text file. Returns the file content as a string.',
    schema: z.object({
      path: z.string().describe('The absolute path of the file to read'),
      encoding: z.enum(['utf-8', 'utf8', 'ascii', 'binary', 'base64', 'hex', 'latin1', 'ucs2', 'utf16le']).optional().default('utf-8').describe('File encoding (default: utf-8)'),
    }),
    func: async ({ path, encoding }) => {
      // Errors will be caught by the AgentService
      const validatedPath = await validateReadPath(path);
      const stats = await fs.stat(validatedPath);
      
      // Check file size limit
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`Validation Error: File too large (${Math.round(stats.size / 1024)}KB). Maximum allowed size is ${MAX_FILE_SIZE / 1024}KB.`);
      }
      
      const content = await fs.readFile(validatedPath, encoding as BufferEncoding);
      return content;
    },
  });

  static writeFile = new DynamicStructuredTool({
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
    schema: z.object({
      path: z.string().describe('The absolute path of the file to write'),
      content: z.string().describe('The content to write to the file'),
      encoding: z.enum(['utf-8', 'utf8', 'ascii', 'binary', 'base64', 'hex', 'latin1', 'ucs2', 'utf16le']).optional().default('utf-8').describe('File encoding (default: utf-8)'),
    }),
    func: async ({ path, content, encoding }) => {
      // Errors will be caught by the AgentService
      const bufferEncoding = Buffer.byteLength(content, encoding as BufferEncoding);
      // Check content size limit
      if (bufferEncoding > MAX_WRITE_SIZE) {
        throw new Error(`Validation Error: Content too large (${Math.round(bufferEncoding / 1024)}KB). Maximum allowed size is ${MAX_WRITE_SIZE / 1024}KB.`);
      }
      
      const validatedPath = await validateWritePath(path);
      await fs.writeFile(validatedPath, content, encoding as BufferEncoding);
      return `Successfully wrote to file: ${validatedPath}`;
    },
  });

  static createDirectory = new DynamicStructuredTool({
    name: 'create_directory',
    description: 'Create a new directory.',
    schema: z.object({
      path: z.string().describe('The absolute path of the directory to create'),
    }),
    func: async ({ path }) => {
      // Errors will be caught by the AgentService
      const validatedPath = await validateWritePath(path);
      await fs.mkdir(validatedPath, { recursive: true });
      return `Successfully created directory: ${validatedPath}`;
    },
  });

  static deleteFile = new DynamicStructuredTool({
    name: 'delete_file',
    description: 'Delete a file from the file system. Use with caution.',
    schema: z.object({
      path: z.string().describe('The absolute path of the file to delete'),
    }),
    func: async ({ path }) => {
      // Errors will be caught by the AgentService
      const validatedPath = await validateReadPath(path);
      await fs.unlink(validatedPath);
      return `Successfully deleted file: ${validatedPath}`;
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
      this.createDirectory,
      this.deleteFile,
    ];
  }
}
