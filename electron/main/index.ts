import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { StorageService } from './storage';
import { getPythonManager, setupPythonManagerLifecycle } from './PythonManager';
import { getPythonAPIClient } from './PythonAPIClient';
import dotenv from 'dotenv';
import { GraphLogger } from './logger';

// Load environment variables with explicit path
dotenv.config({ path: join(__dirname, '../../.env') });

GraphLogger.info('SYSTEM', 'Starting VerbOS main process...');
GraphLogger.info('SYSTEM', `API Key exists: ${!!process.env.GOOGLE_API_KEY}`);

const isDev = process.env.NODE_ENV === 'development';

// Services will be initialized later
let storageService: StorageService | null = null;

function createWindow(): void {
  // Create the browser window
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// App event listeners
app.whenReady().then(async () => {
  GraphLogger.info('SYSTEM', 'App is ready, initializing services...');
  try {
    // Setup Python backend lifecycle management
    setupPythonManagerLifecycle();

    // Start Python backend
    const pythonManager = getPythonManager();
    await pythonManager.start();

    // Initialize StorageService
    storageService = new StorageService();
    GraphLogger.info('SYSTEM', 'StorageService initialized, Python backend ready');

    createWindow();
  } catch (error) {
    GraphLogger.error('SYSTEM', 'Failed to initialize services', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  storageService?.close();
});

// IPC handlers
ipcMain.handle('ping', async () => {
  return 'pong';
});

ipcMain.handle('ask-agent', async (event, { sessionId, prompt }: { sessionId: string; prompt: string }) => {
  if (!sessionId || !prompt) {
    event.sender.send('agent-event', { type: 'error', message: 'Missing sessionId or prompt' });
    event.sender.send('stream-end');
    return { streaming: true };
  }

  // Save user message to storage
  if (storageService) {
    storageService.addMessage(sessionId, 'user', prompt);
  }

  // Stream events from Python backend
  const apiClient = getPythonAPIClient();
  let finalResponse = '';

  try {
    for await (const agentEvent of apiClient.streamChat(sessionId, prompt)) {
      event.sender.send('agent-event', agentEvent);
      if (agentEvent.type === 'response' && agentEvent.message) {
        finalResponse = agentEvent.message;
      }
    }

    // Save assistant response to storage
    if (storageService && finalResponse) {
      storageService.addMessage(sessionId, 'assistant', finalResponse);
    }
  } catch (error) {
    GraphLogger.error('SYSTEM', 'Error streaming from Python backend', error);
    event.sender.send('agent-event', {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  event.sender.send('stream-end');
  return { streaming: true };
});

// Approval handlers for HITL
ipcMain.handle('agent:approve', async (_event, sessionId: string) => {
  try {
    const apiClient = getPythonAPIClient();
    return await apiClient.approveAction(sessionId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent:deny', async (_event, sessionId: string, reason?: string) => {
  try {
    const apiClient = getPythonAPIClient();
    return await apiClient.denyAction(sessionId, reason);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent:resume', async (event, sessionId: string) => {
  const apiClient = getPythonAPIClient();
  try {
    for await (const agentEvent of apiClient.resumeChat(sessionId)) {
      event.sender.send('agent-event', agentEvent);
    }
  } catch (error) {
    event.sender.send('agent-event', {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    event.sender.send('stream-end');
  }
  return { streaming: true };
});

// History handlers
ipcMain.handle('history:create', async (_event, title?: string) => {
  if (!storageService) throw new Error('StorageService not initialized');
  const session = storageService.createSession(title);
  return session;
});

ipcMain.handle('history:list', async () => {
  if (!storageService) throw new Error('StorageService not initialized');
  return storageService.getAllSessions();
});

ipcMain.handle('history:load', async (_event, id: string) => {
  if (!storageService) throw new Error('StorageService not initialized');
  return storageService.getSession(id);
});

ipcMain.handle('history:updateTitle', async (_event, sessionId: string, title: string) => {
  if (!storageService) throw new Error('StorageService not initialized');
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('Invalid sessionId: must be a non-empty string');
  }
  if (typeof title !== 'string' || !title) {
    throw new Error('Invalid title: must be a non-empty string');
  }
  return storageService.updateTitle(sessionId, title);
});

ipcMain.handle('history:delete', async (_event, id: string) => {
  if (!storageService) throw new Error('StorageService not initialized');
  return storageService.deleteSession(id);
});
