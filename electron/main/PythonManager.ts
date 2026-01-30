import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { app } from 'electron';
import { GraphLogger } from './graph/logger';

const PYTHON_PORT = 8000;
const HEALTH_CHECK_INTERVAL = 500;
const HEALTH_CHECK_TIMEOUT = 30000;

export class PythonManager {
  private process: ChildProcess | null = null;
  private isReady: boolean = false;
  private readonly port: number;
  private readonly isDev: boolean;

  constructor(port: number = PYTHON_PORT) {
    this.port = port;
    this.isDev = process.env.NODE_ENV === 'development';
  }

  async start(): Promise<void> {
    if (this.process) {
      GraphLogger.warn('PYTHON', 'Python process already running');
      return;
    }

    GraphLogger.info('PYTHON', `Starting Python backend on port ${this.port}...`);

    const backendPath = this.isDev
      ? join(__dirname, '../../backend')
      : join(process.resourcesPath, 'backend');

    const serverScript = join(backendPath, 'server.py');

    if (this.isDev) {
      this.process = spawn('uv', ['run', 'python', serverScript, '--port', String(this.port)], {
        cwd: backendPath,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      const executableName = process.platform === 'win32' ? 'server.exe' : 'server';
      const executablePath = join(backendPath, 'dist', executableName);
      this.process = spawn(executablePath, ['--port', String(this.port)], {
        cwd: backendPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        GraphLogger.info('PYTHON', message);
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        GraphLogger.error('PYTHON', message);
      }
    });

    this.process.on('error', (error: Error) => {
      GraphLogger.error('PYTHON', `Failed to start Python process: ${error.message}`);
      this.process = null;
    });

    this.process.on('exit', (code: number | null, signal: string | null) => {
      GraphLogger.info('PYTHON', `Python process exited with code ${code}, signal ${signal}`);
      this.process = null;
      this.isReady = false;
    });

    await this.waitForReady();
  }

  private async waitForReady(): Promise<void> {
    const startTime = Date.now();
    const healthUrl = `http://127.0.0.1:${this.port}/health`;

    GraphLogger.info('PYTHON', `Waiting for health check at ${healthUrl}...`);

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT) {
      try {
        const response = await fetch(healthUrl);
        if (response.ok) {
          const data = await response.json();
          GraphLogger.info('PYTHON', `Backend ready: ${JSON.stringify(data)}`);
          this.isReady = true;
          return;
        }
      } catch {
        // Server not ready yet, continue polling
      }
      await this.sleep(HEALTH_CHECK_INTERVAL);
    }

    throw new Error(`Python backend failed to start within ${HEALTH_CHECK_TIMEOUT}ms`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    if (!this.process) {
      GraphLogger.warn('PYTHON', 'No Python process to stop');
      return;
    }

    GraphLogger.info('PYTHON', 'Stopping Python backend...');

    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(this.process.pid), '/f', '/t'], { shell: true });
    } else {
      this.process.kill('SIGTERM');
    }

    this.process = null;
    this.isReady = false;
  }

  getPort(): number {
    return this.port;
  }

  getIsReady(): boolean {
    return this.isReady;
  }
}

let pythonManagerInstance: PythonManager | null = null;

export function getPythonManager(): PythonManager {
  if (!pythonManagerInstance) {
    pythonManagerInstance = new PythonManager();
  }
  return pythonManagerInstance;
}

export function setupPythonManagerLifecycle(): void {
  app.on('will-quit', () => {
    pythonManagerInstance?.stop();
  });
}
