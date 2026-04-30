import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { GraphLogger } from './logger';

/**
 * Safely resolves the absolute path of an executable using system utilities.
 * This prevents path hijacking by ensuring we use a specific, validated binary.
 * Uses spawnSync with shell: false to prevent command injection.
 */
export function resolveExecutablePath(name: string): string {
  const isWindows = platform() === 'win32';

  if (/[&|;><`\s]/.test(name)) {
    GraphLogger.error('SYSTEM', `Invalid executable name provided: ${name}`);
    return name;
  }

  return isWindows ? resolveWindowsExecutable(name) : resolveUnixExecutable(name);
}

function resolveWindowsExecutable(name: string): string {
  const wherePath = String.raw`C:\Windows\System32\where.exe`;
  if (!existsSync(wherePath)) {
    GraphLogger.warn('SYSTEM', `System utility ${wherePath} not found, falling back to bare name`);
    return name;
  }

  return resolveFromCommand(wherePath, [name], name, (stdout) => {
    const paths = stdout.trim().split(/\r?\n/);
    const firstPath = paths[0];
    return firstPath && existsSync(firstPath) ? firstPath : null;
  });
}

function resolveUnixExecutable(name: string): string {
  const whichPath = '/usr/bin/which';
  if (!existsSync(whichPath)) {
    GraphLogger.warn('SYSTEM', `System utility ${whichPath} not found, falling back to bare name`);
    return name;
  }

  return resolveFromCommand(whichPath, [name], name, (stdout) => {
    const resolvedPath = stdout.trim();
    return resolvedPath && existsSync(resolvedPath) ? resolvedPath : null;
  });
}

function resolveFromCommand(
  command: string,
  args: string[],
  fallback: string,
  parseStdout: (stdout: string) => string | null
): string {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      shell: false,
    });

    if (result.status === 0 && result.stdout) {
      return parseStdout(result.stdout) ?? fallback;
    }
  } catch (error) {
    GraphLogger.error(
      'SYSTEM',
      `Failed to resolve path for ${fallback}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return fallback;
}
