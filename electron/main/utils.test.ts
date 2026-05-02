import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveExecutablePath } from './utils';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { platform } from 'os';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('os', () => ({
  platform: vi.fn(),
}));

vi.mock('./logger', () => ({
  GraphLogger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('resolveExecutablePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve uv path on Windows using spawnSync', () => {
    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(existsSync).mockImplementation((path) => {
      if (typeof path !== 'string') return false;
      // Using forward slashes in mocks to avoid escaping hell during file writing
      if (path.replace(/\\/g, '/') === 'C:/Windows/System32/where.exe') return true;
      if (path.replace(/\\/g, '/') === 'C:/Users/test/.local/bin/uv.exe') return true;
      return false;
    });
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'C:\\Users\\test\\.local\\bin\\uv.exe\r\n',
    } as any);

    const result = resolveExecutablePath('uv');
    
    // The utility uses double backslashes in the code, so we match that
    expect(result.replace(/\\/g, '/')).toBe('C:/Users/test/.local/bin/uv.exe');
    expect(vi.mocked(spawnSync).mock.calls[0][0].replace(/\\/g, '/')).toBe('C:/Windows/System32/where.exe');
    expect(vi.mocked(spawnSync).mock.calls[0][1]).toEqual(['uv']);
  });

  it('should resolve uv path on Unix using spawnSync', () => {
    vi.mocked(platform).mockReturnValue('linux');
    vi.mocked(existsSync).mockImplementation((path) => {
      if (typeof path !== 'string') return false;
      if (path === '/usr/bin/which') return true;
      if (path === '/usr/local/bin/uv') return true;
      return false;
    });
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '/usr/local/bin/uv\n',
    } as any);

    const result = resolveExecutablePath('uv');
    
    expect(result).toBe('/usr/local/bin/uv');
    expect(spawnSync).toHaveBeenCalledWith('/usr/bin/which', ['uv'], {
      encoding: 'utf8',
      shell: false,
    });
  });

  it('should reject invalid executable names with shell meta-characters', () => {
    const result = resolveExecutablePath('uv & malicious');
    expect(result).toBe('uv & malicious');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('should fallback to name if where.exe is missing on Windows', () => {
    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(existsSync).mockReturnValue(false);

    const result = resolveExecutablePath('uv');
    
    expect(result).toBe('uv');
  });

  it('should fallback to name if spawnSync fails', () => {
    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(existsSync).mockImplementation((path) => {
      if (String(path).replace(/\\/g, '/') === 'C:/Windows/System32/where.exe') return true;
      return false;
    });
    vi.mocked(spawnSync).mockImplementation(() => {
      throw new Error('Process failed');
    });

    const result = resolveExecutablePath('nonexistent');
    
    expect(result).toBe('nonexistent');
  });
});