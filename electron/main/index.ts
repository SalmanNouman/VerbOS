import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { AgentService } from './AgentService';
import { StorageService, ChatSession } from './storage';
import dotenv from 'dotenv';

// Load environment variables with explicit path
dotenv.config({ path: join(__dirname, '../../.env') });

console.log('Starting AugOS main process...');
console.log('API Key exists:', !!process.env.GOOGLE_API_KEY);

const isDev = process.env.NODE_ENV === 'development';

// AgentService will be initialized later
let agentService: AgentService | null = null;
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
  console.log('App is ready, initializing AgentService...');
  try {
    // Initialize AgentService after app is ready
    agentService = new AgentService();
    storageService = new StorageService();
    console.log('AgentService and StorageService initialized successfully');
    
    createWindow();
  } catch (error) {
    console.error('Failed to initialize services:', error);
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

// IPC handlers
ipcMain.handle('ping', async () => {
  return 'pong';
});

ipcMain.handle('ask-agent', async (event, { sessionId, prompt }: { sessionId: string; prompt: string }) => {
  if (!agentService) {
    event.sender.send('agent-token', 'Error: AgentService not initialized');
    event.sender.send('stream-end');
    return { streaming: true };
  }
  
  // Start streaming response
  await agentService.ask(sessionId, prompt, (token: string) => {
    event.sender.send('agent-token', token);
  });
  
  // Send stream-end event when done
  event.sender.send('stream-end');
  
  // Return to confirm completion
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

ipcMain.handle('history:save', async (_event, session: ChatSession) => {
  if (!storageService) throw new Error('StorageService not initialized');
  storageService.saveSession(session);
  return true;
});

ipcMain.handle('history:delete', async (_event, id: string) => {
  if (!storageService) throw new Error('StorageService not initialized');
  const result = await storageService.deleteSession(id);
  
  // Clear the session from AgentService memory
  if (agentService) {
    agentService.clearSession(id);
  }
  
  return result;
});
