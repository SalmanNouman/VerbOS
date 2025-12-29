import { BaseWorker } from './BaseWorker';
import { SystemTool } from '../../tools/SystemTool';
import { ShellTool } from '../../tools/ShellTool';
import { platform } from 'os';

/**
 * System Worker manages system info and shell commands.
 * Capabilities: get system info, execute whitelisted shell commands.
 */
export class SystemWorker extends BaseWorker {
  constructor() {
    super({
      name: 'system_worker',
      description: 'Handles system operations: system info, shell commands (npm, git, ping, etc.).',
      tools: [...SystemTool.getTools(), ...ShellTool.getTools()],
      systemPrompt: `You are a System Worker, a specialized agent for system operations.

Your capabilities:
- Get system information (get_system_info)
- Execute whitelisted shell commands (execute_shell_command)

Allowed shell commands: npm, npx, yarn, pnpm, git, ping, curl, wget, node, python, pip, ls, dir, cat, type, echo, pwd, ps, tasklist, whoami

Current platform: ${platform()}

Guidelines:
1. Use get_system_info for hardware/OS queries.
2. Only use execute_shell_command for allowed commands.
3. Be cautious with commands that modify state (npm install, git commit, etc.).
4. Provide clear output summaries for command results.
5. Handle command timeouts gracefully (30 second limit).

When you complete your task, provide a clear summary of what was done.`,
    });
  }
}
