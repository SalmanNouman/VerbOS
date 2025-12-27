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
  if (!requestedPath) {
    throw new Error('Path cannot be empty');
  }

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
    // If it's a write operation, the file might not exist yet, but we need to check the parent.
    // However, this function is general.
    // We'll throw a specific error.
    throw new Error(`File System Error: The path '${absolutePath}' does not exist.`);
  }
  
  // Resolve symlinks to prevent symlink traversal attacks
  const realPath = await realpath(absolutePath);
  
  // Check against blocked paths
  for (const blocked of SECURITY_CONFIG.blockedPaths) {
    if (realPath.toLowerCase().startsWith(blocked.toLowerCase())) {
      throw new Error(`Security Violation: Access to system directory '${realPath}' is strictly prohibited.`);
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
      `Security Violation: Access to '${realPath}' is denied. Operations are restricted to the User Home Directory and the Project Directory.`
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
      throw new Error(`Operation Failed: The path '${validatedPath}' is a directory, not a file.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such file')) {
      throw new Error(`File Not Found: The file '${validatedPath}' could not be found.`);
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
      throw new Error(`Operation Failed: The path '${validatedPath}' is not a directory.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such file')) {
      throw new Error(`Directory Not Found: The directory '${validatedPath}' could not be found.`);
    }
    throw error;
  }
  
  return validatedPath;
}

/**
 * Validates a path for file writing operations
 */
export async function validateWritePath(path: string): Promise<string> {
  if (!path) {
    throw new Error('Path cannot be empty');
  }

  // Resolve to an absolute path using the same rules as validatePath,
  // but do not require the file itself to exist.
  let absolutePath = resolve(path);
  if (!path.includes(':') && !path.startsWith('/') && !path.startsWith('\\')) {
    absolutePath = resolve(homedir(), path);
  }

  // Validate the parent directory (must exist, be a directory, and be within allowed roots).
  const parentDir = resolve(absolutePath, '..');
  
  try {
    await validateDirectoryPath(parentDir);
  } catch (error) {
      if (error instanceof Error && error.message.includes('Directory Not Found')) {
          throw new Error(`Operation Failed: The parent directory '${parentDir}' does not exist.`);
      }
      throw error;
  }

  // If the target file already exists, resolve its real path and fully validate it
  // to defend against symlink attacks.
  try {
    const fileRealPath = await realpath(absolutePath);
    return await validatePath(fileRealPath);
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // New file: parent has been validated, so this path is safe to use.
      return absolutePath;
    }
    throw error;
  }
}