import { spawnSync } from 'child_process';
import { platform } from 'os';
import { existsSync } from 'fs';
import { GraphLogger } from './logger';

/**
 * Safely resolves the absolute path of an executable using system utilities.
 * This prevents path hijacking by ensuring we use a specific, validated binary.
 * Uses spawnSync with shell: false to prevent command injection.
 */
export function resolveExecutablePath(name: string): string {
  const isWindows = platform() === 'win32';
  
  // names should not contain shell meta-characters
  if (/[&|;><`\s]/.test(name)) {
    GraphLogger.error('SYSTEM', `Invalid executable name provided: ${name}`);
    return name;
  }
  
  try {
    if (isWindows) {
      // Use absolute path to where.exe to prevent hijacking of the search utility itself
      const wherePath = 'C:\\Windows\\System32\\where.exe';
      if (!existsSync(wherePath)) {
        GraphLogger.warn('SYSTEM', `System utility ${wherePath} not found, falling back to bare name`);
        return name;
      }
      
      const result = spawnSync(wherePath, [name], { 
        encoding: 'utf8',
        shell: false 
      });

      if (result.status === 0 && result.stdout) {
        const paths = result.stdout.trim().split(/\r?\n/);
        if (paths.length > 0 && paths[0] && existsSync(paths[0])) {
          return paths[0];
        }
      }
    } else {
      // Use absolute path to which on Unix-like systems
      const whichPath = '/usr/bin/which';
      if (!existsSync(whichPath)) {
        GraphLogger.warn('SYSTEM', `System utility ${whichPath} not found, falling back to bare name`);
        return name;
      }
      
      const result = spawnSync(whichPath, [name], { 
        encoding: 'utf8',
        shell: false 
      });

      if (result.status === 0 && result.stdout) {
        const path = result.stdout.trim();
        if (path && existsSync(path)) {
          return path;
        }
      }
    }
  } catch (error) {
    GraphLogger.error('SYSTEM', `Failed to resolve path for ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Fallback to the original name if resolution fails
  return name;
}
