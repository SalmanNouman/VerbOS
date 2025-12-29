import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSystemWorker } from '../FileSystemWorker';
import { SystemWorker } from '../SystemWorker';
import { CodeWorker } from '../CodeWorker';
import { ResearcherWorker } from '../ResearcherWorker';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

describe('Full Tool Chain Integration Tests', () => {
  const testDir = join(homedir(), 'verbos-full-chain-test-' + randomUUID());
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('FileSystemWorker Capabilities', () => {
    const worker = new FileSystemWorker();
    const tools = (worker as any).tools;

    it('should have all required file tools', () => {
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('list_directory');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('create_directory');
      expect(toolNames).toContain('delete_file');
    });

    it('should successfully create a directory', async () => {
      const dirPath = join(testDir, 'new_folder');
      const createTool = tools.find((t: any) => t.name === 'create_directory');
      
      await createTool.invoke({ path: dirPath });
      
      const listTool = tools.find((t: any) => t.name === 'list_directory');
      const result = await listTool.invoke({ path: testDir });
      
      expect(result).toContain('new_folder');
    });

    it('should successfully write and read a file', async () => {
      const filePath = join(testDir, 'test.txt');
      const content = 'Full Chain Test Content';
      
      const writeTool = tools.find((t: any) => t.name === 'write_file');
      const readTool = tools.find((t: any) => t.name === 'read_file');

      await writeTool.invoke({ path: filePath, content });
      const result = await readTool.invoke({ path: filePath });
      expect(result).toBe(content);
    });
  });

  describe('SystemWorker Capabilities', () => {
    const worker = new SystemWorker();
    const tools = (worker as any).tools;

    it('should have system and shell tools', () => {
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('get_system_info');
      expect(toolNames).toContain('execute_shell_command');
    });

    it('should retrieve system info', async () => {
      const sysTool = tools.find((t: any) => t.name === 'get_system_info');
      const result = await sysTool.invoke({});
      const parsed = JSON.parse(result);
      expect(parsed.platform).toBeDefined();
    });
  });

  describe('CodeWorker Capabilities', () => {
    const worker = new CodeWorker();
    const tools = (worker as any).tools;

    it('should have code analysis and generation tools', () => {
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('analyze_code');
      expect(toolNames).toContain('generate_code');
      expect(toolNames).toContain('refactor_code');
      expect(toolNames).toContain('explain_code');
      // Also inherits file tools
      expect(toolNames).toContain('read_file');
    });

    it('should generate correct prompt for code analysis', async () => {
      const analyzeTool = tools.find((t: any) => t.name === 'analyze_code');
      const result = await analyzeTool.invoke({ 
        code: 'const x = 1;', 
        language: 'typescript',
        focusAreas: ['bugs'] 
      });
      expect(result).toContain('Analyze the following code (typescript)');
      expect(result).toContain('focusing on bugs');
      expect(result).toContain('const x = 1;');
    });
  });

  describe('ResearcherWorker Capabilities', () => {
    const worker = new ResearcherWorker();
    const tools = (worker as any).tools;

    it('should have research and summarization tools', () => {
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('summarize_context');
      expect(toolNames).toContain('extract_facts');
      expect(toolNames).toContain('analyze_code_context');
      expect(toolNames).toContain('read_file');
    });

    it('should generate correct prompt for summarization', async () => {
      const summarizeTool = tools.find((t: any) => t.name === 'summarize_context');
      const result = await summarizeTool.invoke({ 
        text: 'Long text here', 
        maxPoints: 3 
      });
      expect(result).toContain('summarize the following text into 3 key points');
      expect(result).toContain('Long text here');
    });
  });
});
