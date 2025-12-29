import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileSystemWorker } from '../FileSystemWorker';
import { SystemWorker } from '../SystemWorker';
import { FileTool } from '../../../tools/FileTool';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// We want to test REAL tool execution here, but mock the LLM
// So we won't mock fs or child_process, but we will mock modelWithTools.invoke

describe('Worker Integration Tests', () => {
  const testDir = join(homedir(), 'verbos-test-' + randomUUID());
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('FileSystemWorker Real Tool Execution', () => {
    it('should write and read a real file', async () => {
      const worker = new FileSystemWorker();
      const filePath = join(testDir, 'test.txt');
      const content = 'Hello Integration';

      // Manually execute the tool logic that the worker would call
      // We can't easily invoke the worker.process loop because it relies on the LLM to generate tool calls.
      // But we can verify the TOOLS themselves work when called by the worker's tool definitions.
      
      const writeTool = (worker as any).tools.find((t: any) => t.name === 'write_file');
      expect(writeTool).toBeDefined();

      // Execute Write
      await writeTool.invoke({ path: filePath, content });

      // Verify file exists on disk
      const diskContent = await readFile(filePath, 'utf-8');
      expect(diskContent).toBe(content);

      // Execute Read via Tool
      const readTool = (worker as any).tools.find((t: any) => t.name === 'read_file');
      const readResult = await readTool.invoke({ path: filePath });
      expect(readResult).toBe(content);
    });

    it('should list directory contents', async () => {
      const worker = new FileSystemWorker();
      const filePath = join(testDir, 'list_test.txt');
      await FileTool.writeFile.invoke({ path: filePath, content: 'data' });

      const listTool = (worker as any).tools.find((t: any) => t.name === 'list_directory');
      const result = await listTool.invoke({ path: testDir });
      
      const parsed = JSON.parse(result);
      expect(parsed).toBeInstanceOf(Array);
      expect(parsed.some((item: any) => item.name === 'list_test.txt')).toBe(true);
    });
  });

  describe('SystemWorker Real Tool Execution', () => {
    it('should execute a safe shell command', async () => {
      const worker = new SystemWorker();
      const shellTool = (worker as any).tools.find((t: any) => t.name === 'execute_shell_command');
      
      const result = await shellTool.invoke({ command: 'echo "hello system"' });
      expect(result).toContain('hello system');
    });

    it('should get system info', async () => {
      const worker = new SystemWorker();
      const sysInfoTool = (worker as any).tools.find((t: any) => t.name === 'get_system_info');
      
      const result = await sysInfoTool.invoke({});
      const parsed = JSON.parse(result);
      
      expect(parsed.platform).toBeDefined();
      expect(parsed.cpu).toBeDefined();
    });
  });
});
