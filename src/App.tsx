import { useEffect, useState, useCallback } from 'react';
import { ChatInterface } from './components/ChatInterface';
import type { ChatSession, ChatSummary } from './types/verbos';
import {
  MessageSquare,
  History,
  Settings,
  Plus,
  Trash2,
  ChevronRight,
  Cpu,
  Terminal,
  Activity,
  Command
} from 'lucide-react';
import './index.css';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatSummary[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        if (window.verbos) {
          await window.verbos.ping();
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Connection failed:', err);
        setIsConnected(false);
      }
    };
    checkConnection();
  }, []);

  const loadHistory = useCallback(async () => {
    if (!window.verbos) return;
    try {
      const history = await window.verbos.history.list();
      setChatHistory(history);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, []);

  useEffect(() => {
    const initSession = async () => {
      if (!window.verbos || !isConnected) return;

      await loadHistory();

      const history = await window.verbos.history.list();
      if (history.length > 0) {
        const session = await window.verbos.history.load(history[0].id);
        if (session) setCurrentSession(session);
      } else {
        const session = await window.verbos.history.create();
        setCurrentSession(session);
      }
    };
    initSession();
  }, [isConnected, loadHistory]);

  const createNewChat = async () => {
    if (!window.verbos) return;
    try {
      const session = await window.verbos.history.create();
      setCurrentSession(session);
      await loadHistory();
      setActiveTab('chat');
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  };

  const loadChat = async (id: string) => {
    if (!window.verbos) return;
    try {
      const session = await window.verbos.history.load(id);
      if (session) {
        setCurrentSession(session);
        setActiveTab('chat');
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  };

  const updateTitle = async (sessionId: string, title: string) => {
    if (!window.verbos) return;
    try {
      await window.verbos.history.updateTitle(sessionId, title);
      await loadHistory();
      if (currentSession?.id === sessionId) {
        setCurrentSession( prev => prev ? { ...prev, title } : null);
      }
    } catch (err) {
      console.error('Failed to update title:', err);
    }
  };

  const deleteChat = async (id: string) => {
    if (!window.verbos) return;
    try {
      await window.verbos.history.delete(id);
      if (currentSession?.id === id) {
        await createNewChat();
      }
      await loadHistory();
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-background text-text-primary overflow-hidden font-sans selection:bg-brand-primary/30">
      {/* Premium Sidebar (Activity Bar) */}
      <aside className="w-[68px] bg-surface border-r border-border flex flex-col items-center py-6 gap-6 z-30 shadow-floating">
        <div className="w-10 h-10 rounded-xl bg-brand-primary flex items-center justify-center text-background mb-4 shadow-lg shadow-brand-primary/30 animate-in zoom-in duration-500">
          <Command size={22} strokeWidth={2.5} />
        </div>

        <nav className="flex flex-col gap-3">
          <button
            onClick={() => setActiveTab('chat')}
            className={`group relative p-3 rounded-xl transition-all duration-300 ${activeTab === 'chat' ? 'text-brand-primary' : 'text-text-muted hover:text-text-primary hover:bg-surface-raised'}`}
            title="Chat Workspace"
          >
            <MessageSquare size={20} strokeWidth={activeTab === 'chat' ? 2.5 : 2} />
          </button>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`group relative p-3 rounded-xl transition-all duration-300 ${showHistory ? 'text-brand-primary' : 'text-text-muted hover:text-text-primary hover:bg-surface-raised'}`}
            title="History"
          >
            <History size={20} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-surface-overlay border border-border text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
              History
            </div>
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-3 pb-2">
          <button
            className="p-3 text-text-muted hover:text-text-primary hover:bg-surface-raised rounded-xl transition-all duration-300"
            title="System Status"
          >
            <Activity size={20} />
          </button>
          <button
            className="p-3 text-text-muted hover:text-text-primary hover:bg-surface-raised rounded-xl transition-all duration-300"
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </aside>

      {/* History Slide-out Panel */}
      <div className={`transition-all duration-500 ease-in-out border-r border-border bg-surface/50 backdrop-blur-xl flex flex-col overflow-hidden ${showHistory ? 'w-72 opacity-100' : 'w-0 opacity-0 border-none'}`}>
        <div className="p-6 flex flex-col h-full min-w-[288px]">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-lg font-display font-bold text-text-primary tracking-tight">Conversations</h2>
            <button
              onClick={createNewChat}
              className="p-2 bg-brand-primary text-background rounded-lg hover:bg-brand-primary-hover transition-all shadow-lg shadow-brand-primary/20 active:scale-95"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2">
            {chatHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-surface-raised flex items-center justify-center text-text-muted mb-4">
                  <MessageSquare size={20} />
                </div>
                <p className="text-sm text-text-muted">No history yet</p>
              </div>
            ) : (
              <div className="space-y-1">
                {chatHistory.map((chat) => (
                  <div
                    key={chat.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadChat(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        loadChat(chat.id);
                      }
                    }}
                    className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 border outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50 ${currentSession?.id === chat.id
                      ? 'bg-brand-primary/10 border-brand-primary/20 text-text-primary'
                      : 'border-transparent hover:bg-surface-raised hover:border-border-subtle text-text-secondary hover:text-text-primary'
                      }`}
                  >
                    <div className={`p-2 rounded-lg ${currentSession?.id === chat.id ? 'bg-brand-primary text-background' : 'bg-surface-raised text-text-muted group-hover:bg-surface-overlay'}`}>
                      <MessageSquare size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{chat.title}</p>
                      <p className="text-[10px] text-text-dim mt-0.5">{chat.date}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative overflow-hidden">
        {/* Modern Header / Toolbar */}
        <header className="h-16 border-b border-border/50 flex items-center justify-between px-8 bg-background/80 backdrop-blur-md z-20 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/80 rounded-full border border-border/50 shadow-premium-sm">
              <Terminal size={14} className="text-brand-primary" />
              <span className="text-xs font-medium text-text-secondary tracking-tight">VerbOS</span>
              <ChevronRight size={12} className="text-text-muted" />
              <span className="text-xs font-bold text-text-primary uppercase tracking-widest text-[10px]">Workspace</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5 text-text-muted cursor-default">
                <Cpu size={14} />
                <span>Alpha v0.1.0</span>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 min-h-0 overflow-hidden relative">
          <ChatInterface
            currentSession={currentSession}
            onUpdateTitle={updateTitle}
          />
        </main>

        {/* Status Bar (Minimal) */}
        <footer className="h-8 border-t border-border/40 bg-surface/30 backdrop-blur-sm flex items-center px-6 justify-between text-[10px] select-none text-text-muted/60">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${isConnected ? 'text-emerald-500/80 font-medium' : 'text-red-400 font-medium'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span>{isConnected ? 'READY' : 'NOT READY'}</span>
            </div>
            <div className="h-3 w-[1px] bg-border/30"></div>
            <span className="hover:text-text-primary transition-colors cursor-default">UTF-8 • TSX</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hover:text-brand-primary transition-colors cursor-pointer">PRIVACY POLICY</span>
            <span className="hover:text-brand-primary transition-colors cursor-pointer">FEEDBACK</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
