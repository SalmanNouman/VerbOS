import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { AgentServiceGraph, AgentEvent } from './AgentServiceGraph';
import { StorageService } from './storage';
import dotenv from 'dotenv';
import { GraphLogger } from './graph/logger';

// Load environment variables with explicit path
dotenv.config({ path: join(__dirname, '../../.env') });

GraphLogger.info('SYSTEM', 'Starting VerbOS main process...');
GraphLogger.info('SYSTEM', `API Key exists: ${!!process.env.GOOGLE_API_KEY}`);

const isDev = process.env.NODE_ENV === 'development';

// Services will be initialized later
let agentService: AgentServiceGraph | null = null;
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
app.whenReady().then(() => {
  GraphLogger.info('SYSTEM', 'App is ready, initializing services...');
  try {
    // Initialize StorageService first (AgentService depends on it)
    storageService = new StorageService();
    // Pass the database instance to AgentServiceGraph for LangGraph checkpointing
    agentService = new AgentServiceGraph(storageService, storageService.db);
    GraphLogger.info('SYSTEM', 'AgentServiceGraph and StorageService initialized successfully');

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

  if (!agentService) {
    event.sender.send('agent-event', { type: 'error', message: 'AgentService not initialized' });
    event.sender.send('stream-end');
    return { streaming: true };
  }

  // Start streaming events from the graph
  await agentService.ask(sessionId, prompt, (agentEvent: AgentEvent) => {
    event.sender.send('agent-event', agentEvent);
  });

  // Send stream-end event when done
  event.sender.send('stream-end');

  return { streaming: true };
});

// Approval handlers for HITL
ipcMain.handle('agent:approve', async (_event, sessionId: string) => {
  try{
    if (!agentService) throw new Error('AgentService not initialized');
    await agentService.approveAction(sessionId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent:deny', async (_event, sessionId: string, reason?: string) => {
  try{
    if (!agentService) throw new Error('AgentService not initialized');
    await agentService.denyAction(sessionId, reason);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent:resume', async (event, sessionId: string) => {
  if (!agentService) throw new Error('AgentService not initialized');
  try {
    await agentService.resume(sessionId, (agentEvent: AgentEvent) => {
      event.sender.send('agent-event', agentEvent);
    });
  } catch (error) {
    event.sender.send('agent-event', {
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
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
