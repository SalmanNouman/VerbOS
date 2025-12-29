import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphLogger } from '../logger';

describe('GraphLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log info messages with correct formatting', () => {
    GraphLogger.info('GRAPH', 'Test info');
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] INFO  \[GRAPH\] Test info/));
  });

  it('should log messages with data', () => {
    GraphLogger.info('WORKER', 'Processing', { id: 1 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('| {"id":1}'));
  });

  it('should log warn messages to console.warn', () => {
    GraphLogger.warn('TOOL', 'Slow tool');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARN  [TOOL] Slow tool'));
  });

  it('should log error messages to console.error', () => {
    GraphLogger.error('SYSTEM', 'Crash');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ERROR [SYSTEM] Crash'));
  });

  it('should log debug messages when in dev mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    
    GraphLogger.debug('GRAPH', 'Debug log');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('DEBUG [GRAPH] Debug log'));
    
    process.env.NODE_ENV = originalEnv;
  });
});
