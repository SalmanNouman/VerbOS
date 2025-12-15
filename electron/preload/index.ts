import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('augos', {
  ping: () => ipcRenderer.invoke('ping'),
  askAgent: (prompt: string) => ipcRenderer.invoke('ask-agent', prompt),
  onToken: (callback: (token: string) => void) => {
    ipcRenderer.on('agent-token', (_event, token: string) => callback(token));
  },
  onStreamEnd: (callback: () => void) => {
    ipcRenderer.on('stream-end', callback);
  },
  removeTokenListener: () => {
    ipcRenderer.removeAllListeners('agent-token');
  },
  removeStreamEndListener: () => {
    ipcRenderer.removeAllListeners('stream-end');
  },
});
