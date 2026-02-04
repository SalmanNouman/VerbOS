export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

export type LogCategory = 'GRAPH' | 'WORKER' | 'TOOL' | 'CHECKPOINT' | 'SYSTEM' | 'PYTHON';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
}

/**
 * Structured logger for the VerbOS main process.
 * Provides consistent formatting and categorization for logs.
 */
export class GraphLogger {
  private static format(entry: LogEntry): string {
    const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    const levelStr = entry.level.padEnd(5);
    return `[${entry.timestamp}] ${levelStr} [${entry.category}] ${entry.message}${dataStr}`;
  }

  private static log(level: LogLevel, category: LogCategory, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };
    
    const formatted = this.format(entry);
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  static info(category: LogCategory, message: string, data?: any) {
    this.log(LogLevel.INFO, category, message, data);
  }

  static warn(category: LogCategory, message: string, data?: any) {
    this.log(LogLevel.WARN, category, message, data);
  }

  static error(category: LogCategory, message: string, data?: any) {
    this.log(LogLevel.ERROR, category, message, data);
  }

  static debug(category: LogCategory, message: string, data?: any) {
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      this.log(LogLevel.DEBUG, category, message, data);
    }
  }
}
