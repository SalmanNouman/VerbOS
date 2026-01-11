import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('verbos', {
  ping: () => ipcRenderer.invoke('ping'),
  askAgent: (sessionId: string, prompt: string) => ipcRenderer.invoke('ask-agent', { sessionId, prompt }),
  
  // Event listeners for the new graph-based agent
  onAgentEvent: (callback: (event: any) => void) => {
    ipcRenderer.removeAllListeners('agent-event');
    ipcRenderer.on('agent-event', (_event, agentEvent: any) => callback(agentEvent));
  },
  onStreamEnd: (callback: () => void) => {
    ipcRenderer.removeAllListeners('stream-end');
    ipcRenderer.on('stream-end', callback);
  },
  removeAgentEventListener: () => {
    ipcRenderer.removeAllListeners('agent-event');
  },
  removeStreamEndListener: () => {
    ipcRenderer.removeAllListeners('stream-end');
  },

  // HITL approval handlers
  approveAction: (sessionId: string) => ipcRenderer.invoke('agent:approve', sessionId),
  denyAction: (sessionId: string, reason?: string) => ipcRenderer.invoke('agent:deny', sessionId, reason),
  resumeAgent: (sessionId: string) => ipcRenderer.invoke('agent:resume', sessionId),

  // Legacy token listener (for backwards compatibility)
  onToken: (callback: (token: string) => void) => {
    ipcRenderer.removeAllListeners('agent-token');
    ipcRenderer.on('agent-token', (_event, token: string) => callback(token));
  },
  removeTokenListener: () => {
    ipcRenderer.removeAllListeners('agent-token');
  },

  history: {
    create: (title?: string) => ipcRenderer.invoke('history:create', title),
    list: () => ipcRenderer.invoke('history:list'),
    load: (id: string) => ipcRenderer.invoke('history:load', id),
    updateTitle: (sessionId: string, title: string) => ipcRenderer.invoke('history:updateTitle', sessionId, title),
    delete: (id: string) => ipcRenderer.invoke('history:delete', id),
  },
});
