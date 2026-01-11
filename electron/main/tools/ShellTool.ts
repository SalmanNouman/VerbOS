import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { GraphLogger } from '../graph/logger';
import { validateDirectoryPath } from './pathValidation';

const execAsync = promisify(exec);

/**
 * Security configuration for shell command execution.
 * Only whitelisted commands are allowed to prevent arbitrary code execution.
 */
const SHELL_SECURITY_CONFIG = {
  // Whitelisted command prefixes that are allowed to execute
  allowedCommands: [
    // Package managers
    'npm',
    'npx',
    'yarn',
    'pnpm',
    // Version control
    'git',
    // Network diagnostics
    'ping',
    'curl',
    'wget',
    // Directory listing (read-only)
    'ls',
    'dir',
    'cat',
    'type',
    'echo',
    'pwd',
    // Process info (read-only)
    'ps',
    'tasklist',
    'whoami',
  ],
  // Blocked patterns that should never be allowed even within whitelisted commands
  blockedPatterns: [
    // Command substitution and chaining (must be checked first)
    /\$\(/i,           // $(...) command substitution
    /`[^`]*`/,         // backtick command substitution
    /;/,               // command separator
    /&&/,              // AND chaining
    /\|\|/,            // OR chaining
    /\|/,              // pipe (can chain to dangerous commands)
    /\n/,              // newline command separator
    // Dangerous operations
    /rm\s+-rf/i,
    /del\s+\/[sfq]/i,
    /format\s+/i,
    /mkfs/i,
    /dd\s+if=/i,
    />\s*\/dev\//i,
    /shutdown/i,
    /reboot/i,
    /halt/i,
    /poweroff/i,
    /init\s+0/i,
    /kill\s+-9\s+-1/i,
    /pkill\s+-9/i,
    /chmod\s+777/i,
    /chown\s+root/i,
    /sudo/i,
    /su\s+-/i,
    /passwd/i,
    /useradd/i,
    /userdel/i,
    /groupadd/i,
    /visudo/i,
    /crontab/i,
    /systemctl/i,
    /service\s+/i,
    /registry/i,
    /regedit/i,
    /reg\s+(add|delete|import|export)/i,
  ],
  // Maximum execution time in milliseconds
  timeout: 30000,
  // Maximum output size in bytes
  maxOutputSize: 1024 * 100, // 100KB
};

/**
 * Validates if a command is safe to execute
 * @param command The command to validate
 * @returns true if command is allowed, throws Error otherwise
 */
function validateCommand(command: string): void {
  if (!command || typeof command !== 'string') {
    throw new Error('Validation Error: Command cannot be empty');
  }

  const trimmedCommand = command.trim().toLowerCase();
  const commandBase = trimmedCommand.split(/\s+/)[0];

  // Check if command starts with an allowed prefix
  const isAllowed = SHELL_SECURITY_CONFIG.allowedCommands.some(
    allowed => commandBase === allowed.toLowerCase()
  );

  if (!isAllowed) {
    throw new Error(
      `Security Violation: Command '${commandBase}' is not in the whitelist. ` +
      `Allowed commands: ${SHELL_SECURITY_CONFIG.allowedCommands.join(', ')}`
    );
  }

  // Check for blocked patterns
  for (const pattern of SHELL_SECURITY_CONFIG.blockedPatterns) {
    if (pattern.test(command)) {
      throw new Error(
        `Security Violation: Command contains a blocked pattern. ` +
        `This operation is not permitted for security reasons.`
      );
    }
  }
}

/**
 * Determines the sensitivity level of a command for HITL purposes
 * @param command The command to analyze
 * @returns 'safe' | 'moderate' | 'sensitive'
 */
export function getCommandSensitivity(command: string): 'safe' | 'moderate' | 'sensitive' {
  const trimmedCommand = command.trim().toLowerCase();
  const commandBase = trimmedCommand.split(/\s+/)[0];

  // Safe commands (read-only, no side effects)
  const safeCommands = ['ls', 'dir', 'cat', 'type', 'echo', 'pwd', 'ps', 'tasklist', 'whoami', 'ping'];
  if (safeCommands.includes(commandBase)) {
    // Check if it's truly read-only (no redirects)
    if (!trimmedCommand.includes('>')) {
      return 'safe';
    }
  }

  // Moderate commands (may have side effects but generally safe)
  const moderateCommands = ['git', 'npm', 'npx', 'yarn', 'pnpm', 'pip', 'curl', 'wget'];
  if (moderateCommands.includes(commandBase)) {
    // Git status, log, diff are safe
    if (commandBase === 'git') {
      const safeGitSubcommands = ['status', 'log', 'diff', 'branch', 'remote', 'show', 'ls-files', 'ls-tree'];
      const gitSubcommand = trimmedCommand.split(/\s+/)[1];
      if (safeGitSubcommands.includes(gitSubcommand)) {
        return 'safe';
      }
    }
    // npm list, npm view are safe
    if (commandBase === 'npm') {
      const safeNpmSubcommands = ['list', 'ls', 'view', 'info', 'search', 'outdated', 'audit'];
      const npmSubcommand = trimmedCommand.split(/\s+/)[1];
      if (safeNpmSubcommands.includes(npmSubcommand)) {
        return 'safe';
      }
    }
    return 'sensitive';
  }

  // Everything else that passed validation is sensitive
  return 'sensitive';
}

/**
 * ShellTool provides controlled shell command execution to the agent.
 * Commands are validated against a strict whitelist before execution.
 */
export class ShellTool {
  static executeCommand = new DynamicStructuredTool({
    name: 'execute_shell_command',
    description: 
      'Execute a shell command on the system. Only whitelisted commands are allowed: ' +
      SHELL_SECURITY_CONFIG.allowedCommands.join(', ') +
      '. Returns the command output (stdout) or error message.',
    schema: z.object({
      command: z.string().describe('The shell command to execute'),
      cwd: z.string().optional().describe('Optional working directory for the command'),
    }),
    func: async ({ command, cwd }) => {
      // Validate command before execution
      validateCommand(command);

      const sensitivity = getCommandSensitivity(command);
      GraphLogger.info('TOOL', `Executing command (sensitivity: ${sensitivity}): ${command}`);

      try {
        const options: { timeout: number; maxBuffer: number; cwd?: string; shell?: string } = {
          timeout: SHELL_SECURITY_CONFIG.timeout,
          maxBuffer: SHELL_SECURITY_CONFIG.maxOutputSize,
        };

        if (cwd) {
          // Validate cwd against allowed paths
          try {
            await validateDirectoryPath(cwd);
            options.cwd = cwd;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            GraphLogger.error('TOOL', `Invalid cwd path: ${cwd} - ${errorMsg}`);
            throw new Error(`Security Violation: Working directory '${cwd}' is not allowed. ${errorMsg}`);
          }
        }

        // Use appropriate shell based on platform
        if (platform() === 'win32') {
          options.shell = 'powershell.exe';
        }

        const { stdout, stderr } = await execAsync(command, options);

        let result = '';
        if (stdout) {
          result += stdout;
        }
        if (stderr) {
          result += (result ? '\n\nStderr:\n' : 'Stderr:\n') + stderr;
        }

        return result || 'Command executed successfully (no output)';
      } catch (error: any) {
        if (error.killed) {
          throw new Error(`Execution Error: Command timed out after ${SHELL_SECURITY_CONFIG.timeout / 1000} seconds`);
        }
        if (error.code === 'ENOENT') {
          throw new Error(`Execution Error: Command not found: ${command.split(/\s+/)[0]}`);
        }
        throw new Error(`Execution Error: Command failed: ${error.message}`);
      }
    },
  });

  /**
   * Get all tools as an array
   */
  static getTools() {
    return [this.executeCommand];
  }

  /**
   * Get the sensitivity level of a command (exposed for HITL logic)
   */
  static getCommandSensitivity = getCommandSensitivity;
}
