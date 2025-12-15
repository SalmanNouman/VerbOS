import { normalize, resolve } from 'path';
import { realpath } from 'fs/promises';
import { homedir } from 'os';
import { promises as fs } from 'fs';

/**
 * Security configuration for file access
 */
const SECURITY_CONFIG = {
  // Allowed base directories for file operations
  allowedDirectories: [
    homedir(), // User's home directory
    process.cwd(), // Current working directory
  ],
  // Blocked paths (absolute paths that should never be accessible)
  blockedPaths: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    '/etc',
    '/usr/bin',
    '/usr/sbin',
    '/bin',
    '/sbin',
    '/system',
  ],
};

/**
 * Validates if a path is safe to access
 * @param requestedPath The path requested by the user/agent
 * @returns The validated absolute path
 * @throws Error if path is not allowed
 */
export async function validatePath(requestedPath: string): Promise<string> {
  // Normalize and resolve to absolute path
  // If path is relative, resolve it relative to user's home directory
  let absolutePath = resolve(requestedPath);
  
  // If the path doesn't look absolute (e.g., "Downloads"), try resolving from home
  if (!requestedPath.includes(':') && !requestedPath.startsWith('/') && !requestedPath.startsWith('\\')) {
    absolutePath = resolve(homedir(), requestedPath);
  }
  
  // Check if path exists first before trying realpath
  try {
    await fs.access(absolutePath);
  } catch {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }
  
  // Resolve symlinks to prevent symlink traversal attacks
  const realPath = await realpath(absolutePath);
  
  // Check against blocked paths
  for (const blocked of SECURITY_CONFIG.blockedPaths) {
    if (realPath.toLowerCase().startsWith(blocked.toLowerCase())) {
      throw new Error(`Access denied: Path is in a restricted system directory`);
    }
  }
  
  // Check if path is within allowed directories
  let isAllowed = false;
  for (const allowedDir of SECURITY_CONFIG.allowedDirectories) {
    const resolvedAllowed = await realpath(allowedDir).catch(() => allowedDir);
    if (realPath.toLowerCase().startsWith(resolvedAllowed.toLowerCase())) {
      isAllowed = true;
      break;
    }
  }
  
  if (!isAllowed) {
    throw new Error(
      `Access denied: Path must be within user home directory or current working directory. ` +
      `Requested: ${realPath}`
    );
  }
  
  return realPath;
}

/**
 * Validates a path for file reading operations
 */
export async function validateReadPath(path: string): Promise<string> {
  const validatedPath = await validatePath(path);
  
  // Check if file exists and is readable
  try {
    const stats = await fs.stat(validatedPath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${validatedPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such file')) {
      throw new Error(`File not found: ${validatedPath}`);
    }
    throw error;
  }
  
  return validatedPath;
}

/**
 * Validates a path for directory listing operations
 */
export async function validateDirectoryPath(path: string): Promise<string> {
  const validatedPath = await validatePath(path);
  
  // Check if directory exists and is accessible
  try {
    const stats = await fs.stat(validatedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${validatedPath}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such file')) {
      throw new Error(`Directory not found: ${validatedPath}`);
    }
    throw error;
  }
  
  return validatedPath;
}

/**
 * Validates a path for file writing operations
 */
export async function validateWritePath(path: string): Promise<string> {
  // First validate the path as normal
  const validatedPath = await validatePath(path);
  
  // Check if parent directory exists and is accessible
  const parentDir = resolve(validatedPath, '..');
  try {
    const parentStats = await fs.stat(parentDir);
    if (!parentStats.isDirectory()) {
      throw new Error(`Cannot write file: Parent path is not a directory: ${parentDir}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such file')) {
      throw new Error(`Cannot write file: Parent directory does not exist: ${parentDir}`);
    }
    throw error;
  }
  
  // Additional check: if file exists, resolve its real path to prevent symlink attacks
  try {
    const fileRealPath = await realpath(validatedPath);
    // Re-validate the real path
    return await validatePath(fileRealPath);
  } catch {
    // File doesn't exist, return the validated path
    return validatedPath;
  }
}
