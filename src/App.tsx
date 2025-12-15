import { useEffect, useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import './index.css';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');

  useEffect(() => {
    const checkConnection = async () => {
      try {
        if (window.augos) {
          await window.augos.ping();
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Connection failed:', err);
        setIsConnected(false);
      }
    };
    checkConnection();
  }, []);

  return (
    <div className="flex h-screen w-screen bg-background text-text-primary overflow-hidden font-sans selection:bg-primary-muted selection:text-primary">
      {/* Sidebar (Activity Bar) */}
      <aside className="w-12 bg-surface border-r border-border flex flex-col items-center py-4 gap-4 z-20">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center text-primary mb-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5c0-2 2-2 2-2"/></svg>
        </div>
        
        <button 
          onClick={() => setActiveTab('chat')}
          className={`p-2 rounded-md transition-all duration-200 ${activeTab === 'chat' ? 'text-primary bg-primary/10' : 'text-text-muted hover:text-text-primary hover:bg-surfaceHighlight'}`}
          title="Chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        
        <button 
          onClick={() => setActiveTab('history')}
          className={`p-2 rounded-md transition-all duration-200 ${activeTab === 'history' ? 'text-primary bg-primary/10' : 'text-text-muted hover:text-text-primary hover:bg-surfaceHighlight'}`}
          title="History"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
        </button>

        <div className="mt-auto flex flex-col gap-4">
          <button 
            className="p-2 text-text-muted hover:text-text-primary hover:bg-surfaceHighlight rounded-md transition-all duration-200"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header */}
        <header className="h-10 border-b border-border flex items-center justify-between px-4 bg-background/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold tracking-wide text-text-primary">AugOS</span>
            <span className="text-text-muted">/</span>
            <span className="text-text-secondary">workspace</span>
          </div>
          <div className="flex items-center gap-3">
             <span className="text-xs px-2 py-0.5 rounded-full bg-surface border border-border text-text-muted">v0.1.0-alpha</span>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-hidden relative">
          <ChatInterface />
        </main>

        {/* Status Bar */}
        <footer className="h-6 border-t border-border bg-surface flex items-center px-3 justify-between text-[10px] select-none">
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 ${isConnected ? 'text-text-secondary' : 'text-red-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
              <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div className="h-3 w-[1px] bg-border"></div>
            <span className="text-text-muted">main</span>
          </div>
          <div className="flex items-center gap-3 text-text-muted">
            <span>UTF-8</span>
            <span>TypeScript React</span>
            <div className="flex items-center gap-1 hover:text-text-primary cursor-pointer">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span>Feedback</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;