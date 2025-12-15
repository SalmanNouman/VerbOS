import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

const isDev = process.env.NODE_ENV === 'development';

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
  createWindow();

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

ipcMain.handle('ask-agent', async (_event, prompt: string) => {
  // Placeholder for Phase 2: LangChain integration
  console.log('Received prompt:', prompt);
  return `[System]: I received your request: "${prompt}". AI Brain is not yet connected (Phase 2).`;
});
