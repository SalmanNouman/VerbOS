import { describe, it, expect } from 'vitest';
import { getToolSensitivity } from '../BaseWorker';

describe('Security Refinement - getToolSensitivity', () => {
  it('should mark file read operations as safe', () => {
    expect(getToolSensitivity('read_file', {})).toBe('safe');
    expect(getToolSensitivity('list_directory', {})).toBe('safe');
  });

  it('should mark file write/delete operations as sensitive', () => {
    expect(getToolSensitivity('write_file', {})).toBe('sensitive');
    expect(getToolSensitivity('delete_file', {})).toBe('sensitive');
  });

  it('should mark system info as safe', () => {
    expect(getToolSensitivity('get_system_info', {})).toBe('safe');
  });

  it('should mark code analysis tools as safe', () => {
    expect(getToolSensitivity('analyze_code', {})).toBe('safe');
    expect(getToolSensitivity('generate_code', {})).toBe('safe');
    expect(getToolSensitivity('refactor_code', {})).toBe('safe');
    expect(getToolSensitivity('explain_code', {})).toBe('safe');
  });

  it('should mark researcher tools as safe', () => {
    expect(getToolSensitivity('summarize_context', {})).toBe('safe');
    expect(getToolSensitivity('extract_facts', {})).toBe('safe');
    expect(getToolSensitivity('analyze_code_context', {})).toBe('safe');
  });

  it('should default unknown tools to sensitive', () => {
    expect(getToolSensitivity('unknown_tool', {})).toBe('sensitive');
    expect(getToolSensitivity('random_action', {})).toBe('sensitive');
  });

  it('should delegate shell command sensitivity to ShellTool logic', () => {
    // We mock/assume getCommandSensitivity logic here. 
    // 'echo' is safe
    expect(getToolSensitivity('execute_shell_command', { command: 'echo hello' })).toBe('safe');
    // 'npm install' is sensitive (as per our previous change)
    expect(getToolSensitivity('execute_shell_command', { command: 'npm install' })).toBe('sensitive');
  });
});
