import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SystemWorker } from '../SystemWorker';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { GraphStateType } from '../../state';

// Mock path validation to always pass for tests
vi.mock('../../tools/pathValidation', () => ({
  validateReadPath: vi.fn((p) => Promise.resolve(p)),
  validateWritePath: vi.fn((p) => Promise.resolve(p)),
  validateDirectoryPath: vi.fn((p) => Promise.resolve(p)),
}));

// Mock child_process for ShellTool
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd, opts, callback) => {
    // If only two args (cmd, callback)
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    // Default success for tests
    callback(null, { stdout: 'mock output', stderr: '' });
    return { kill: vi.fn() }; // return mock child process
  })
}));

describe('SystemWorker', () => {
  let worker: SystemWorker;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key';
    worker = new SystemWorker();
    
    // Mock the model invocation
    vi.spyOn((worker as any).modelWithTools, 'invoke').mockResolvedValue(new AIMessage({
      content: 'Thinking...',
      tool_calls: []
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct set of tools', () => {
    const toolNames = (worker as any).tools.map((t: any) => t.name);
    expect(toolNames).toContain('get_system_info');
    expect(toolNames).toContain('execute_shell_command');
  });

  it('should allow safe commands immediately', async () => {
    vi.spyOn((worker as any).modelWithTools, 'invoke').mockResolvedValue(new AIMessage({
      content: '',
      tool_calls: [{
        name: 'execute_shell_command',
        args: { command: 'echo hello' },
        id: 'call-1'
      }]
    }));

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    expect(result.awaitingApproval).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toBeInstanceOf(ToolMessage);
  });

  it('should trigger HITL for sensitive commands', async () => {
    // 'npm install' is considered sensitive/moderate in ShellTool but sensitive in BaseWorker?
    // Let's check BaseWorker logic:
    // BaseWorker calls getCommandSensitivity.
    // ShellTool.getCommandSensitivity('npm install') -> 'moderate' (if command is 'npm install', base is 'npm')
    // Wait, let's check ShellTool.getCommandSensitivity logic.
    // 'npm' is moderate.
    // BaseWorker defaults to 'moderate' for unknown tools.
    // But for 'execute_shell_command', it calls getCommandSensitivity.
    // If result is 'safe', it returns 'safe'.
    // If result is 'moderate', it returns 'moderate'.
    // If result is 'sensitive', it returns 'sensitive'.
    
    // BaseWorker ONLY triggers HITL if sensitivity === 'sensitive'.
    // So 'moderate' commands do NOT trigger HITL in current BaseWorker logic.
    // Let's check BaseWorker.ts:
    // if (sensitivity === 'sensitive') { ... awaitingApproval: true }
    
    // So I need a command that returns 'sensitive'.
    // 'rm -rf' is blocked.
    // 'format' is blocked.
    // How about a non-whitelisted command? No, validateCommand throws.
    // How about a whitelisted command that is NOT safe or moderate?
    // allowedCommands: npm, git, ping, etc.
    // git status -> safe.
    // git commit -> moderate?
    // npm install -> moderate?
    
    // Let's look at getCommandSensitivity in ShellTool.ts again.
    // Safe: ls, dir, cat, ... ping, node, python.
    // Moderate: git, npm, ...
    //   git status -> safe
    //   npm list -> safe
    // Else moderate.
    
    // Everything else is sensitive?
    // "Everything else that passed validation is sensitive"
    // But validateCommand restricts to allowedCommands list.
    // So if it's in allowedCommands but NOT in safeCommands AND NOT in moderateCommands...
    // allowedCommands: npm, npx, yarn, pnpm, git, ping, curl, wget, node, python, pip, ls, dir, cat, type, echo, pwd, ps, tasklist, whoami.
    
    // safeCommands covers: ls, dir, cat, type, echo, pwd, ps, tasklist, whoami, ping, node, python.
    // moderateCommands covers: git, npm, npx, yarn, pnpm, pip, curl, wget.
    
    // It seems ALL allowed commands are either safe or moderate.
    // There are NO 'sensitive' commands reachable via 'execute_shell_command' given the current whitelist and logic?
    // Wait. If I run `npm install`, it is moderate.
    // If I run `git commit`, it is moderate.
    
    // The spec says: "SystemWorker correctly executes shell commands with HITL approval for all executions."
    // Acceptance Criteria: "SystemWorker correctly executes shell commands with HITL approval for all executions."
    // This implies ALL shell commands should be HITL? Or maybe just "all sensitive ones"?
    // The plan says: "Refine `BaseWorker` sensitivity whitelist and mapping logic (Enforce strict security)" in Phase 3.
    
    // BUT for SystemWorker implementation now (Phase 1), maybe we want to verify it works as is.
    // However, if NO command triggers HITL, then we can't test HITL.
    // And if `BaseWorker` only traps 'sensitive', and `ShellTool` only returns 'safe' or 'moderate' for allowed commands...
    // Then HITL will never trigger for shell commands currently.
    
    // Let's create a test case that fails because of this, and then fix it.
    // I will try to use a command that SHOULD be sensitive.
    // Maybe I should update `BaseWorker` or `ShellTool` to make 'moderate' also trigger HITL?
    // Or maybe I should make modification commands 'sensitive'.
    
    // For now, let's write a test that EXPECTS HITL for `npm install`.
    // If it fails (because it executed immediately), then I know I need to adjust the sensitivity logic.
    
    vi.spyOn((worker as any).modelWithTools, 'invoke').mockResolvedValue(new AIMessage({
      content: '',
      tool_calls: [{
        name: 'execute_shell_command',
        args: { command: 'npm install' },
        id: 'call-2'
      }]
    }));

    const state: GraphStateType = { messages: [] } as any;
    const result = await worker.process(state);
    
    // Based on current logic, this might be false. I expect it to be true for safety.
    expect(result.awaitingApproval).toBe(true); 
  });
});
