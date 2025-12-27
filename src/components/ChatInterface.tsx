import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Send,
  Bot,
  User,
  Sparkles,
  ArrowUp,
  Command,
  Loader2,
  Terminal,
  Cpu,
  ShieldCheck,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import type { ChatSession, Message } from '../types/verbos';

interface ChatInterfaceProps {
  currentSession: ChatSession | null;
  onUpdateTitle: (sessionId: string, title: string) => Promise<void>;
}

export function ChatInterface({ currentSession, onUpdateTitle }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastInput, setLastInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Only update messages when the session ID changes to prevent flickering
  // caused by parent component updates (like title changes) resetting local state
  useEffect(() => {
    if (currentSession) {
      setMessages(currentSession.messages);
    } else {
      setMessages([]);
    }
  }, [currentSession?.id]);

  const sendMessage = async (text: string) => {
    if (!currentSession) return;

    setIsLoading(true);
    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      if (window.verbos && window.verbos.askAgent) {
        window.verbos.onToken((token: string) => {
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              updated[updated.length - 1] = { ...lastMsg, content: lastMsg.content + token };
            }
            return updated;
          });
        });

        window.verbos?.onStreamEnd(async () => {
          setIsLoading(false);
          window.verbos?.removeTokenListener();
          window.verbos?.removeStreamEndListener();
        });

        await window.verbos.askAgent(currentSession.id, text);
      } else {
        setTimeout(async () => {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: `I received: "${text}". Connect to VerbOS backend for full functionality.` };
            return updated;
          });
          setIsLoading(false);
        }, 800);
      }
    } catch (error) {
      console.error('Agent error:', error);
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Error: Failed to contact agent. Please ensure the backend is running.` };
        return updated;
      });
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !currentSession) return;

    const userMsg: Message = {
      role: 'user',
      content: input,
    };

    setMessages(prev => [...prev, userMsg]);
    setLastInput(input);
    const currentInput = input;
    setInput('');

    if (messages.length === 0) {
      const newTitle = currentInput.slice(0, 50) + (currentInput.length > 50 ? '...' : '');
      onUpdateTitle(currentSession.id, newTitle).catch(err => {
        console.error('Failed to update title:', err);
      });
    }

    await sendMessage(currentInput);
  };

  const handleRetry = async () => {
    if (!lastInput || isLoading || !currentSession) return;
    await sendMessage(lastInput);
  };

  const isErrorMessage = (content: string) => {
    return content.includes('Error:') || content.includes('❌ Failed:') || content.includes('Agent logic reached session threshold');
  };

  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Messages Area - Scrollable Container */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-6 py-8">
            <div className="w-16 h-16 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary mb-6 border border-brand-primary/20 shadow-lg shadow-brand-primary/10">
              <Sparkles size={32} strokeWidth={1.5} />
            </div>
            <h1 className="text-2xl font-display font-bold text-text-primary mb-2 text-center tracking-tight">How can I assist you today?</h1>
            <p className="text-text-secondary text-sm max-w-md text-center leading-relaxed mb-8">
              I am VerbOS, your agentic interface. I can help automate your workflow, manage system tasks, or just chat.
            </p>

            <div className="grid grid-cols-2 gap-3 w-full max-w-md">
              <div className="p-3 rounded-xl bg-surface-raised/50 border border-border/50 hover:border-brand-primary/30 hover:bg-surface-raised cursor-pointer transition-all group">
                <Terminal size={16} className="text-brand-primary mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-xs font-bold text-text-primary mb-0.5">Modern Shell</p>
                <p className="text-[10px] text-text-muted">Run system commands safely</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-raised/50 border border-border/50 hover:border-brand-accent/30 hover:bg-surface-raised cursor-pointer transition-all group">
                <Cpu size={16} className="text-brand-accent mb-2 group-hover:scale-110 transition-transform" />
                <p className="text-xs font-bold text-text-primary mb-0.5">Agentic Logic</p>
                <p className="text-[10px] text-text-muted">Multi-step task automation</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-4 space-y-5">
            {messages.map((msg, index) => {
              const isError = isErrorMessage(msg.content);
              return (
                <div
                  key={index}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}
                >
                  <div className={`flex flex-col gap-1.5 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${msg.role === 'user' ? 'text-brand-secondary' : 'text-brand-primary'}`}>
                        {msg.role === 'user' ? 'You' : 'VerbOS'}
                      </span>
                    </div>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md transition-all hover:shadow-lg ${msg.role === 'user'
                        ? 'bg-brand-primary text-background font-medium'
                        : isError
                          ? 'bg-red-500/5 text-red-600 border border-red-500/20'
                          : 'bg-surface-raised text-text-secondary border border-border/50 hover:border-brand-primary/20'
                        }`}
                    >
                      {isError && msg.role === 'assistant' && (
                        <div className="flex items-center gap-2 mb-2 text-red-500 font-semibold text-xs uppercase tracking-wide">
                          <AlertCircle size={14} />
                          <span>Action Failed</span>
                        </div>
                      )}
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-invert prose-sm">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ node, inline, className, children, ...props }: any) {
                                const match = /language-(\w+)/.exec(className || '');
                                return !inline && match ? (
                                  <SyntaxHighlighter
                                    style={vscDarkPlus as any}
                                    language={match[1]}
                                    PreTag="div"
                                    className="!bg-background/80 !rounded-lg !text-xs !my-3 overflow-hidden !border !border-border/30"
                                    {...props}
                                  >
                                    {String(children).replace(/\n$/, '')}
                                  </SyntaxHighlighter>
                                ) : (
                                  <code className={`${className} bg-background/60 text-brand-primary px-1.5 py-0.5 rounded text-xs font-mono border border-border/20`} {...props}>
                                    {children}
                                  </code>
                                );
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
              <div className="flex justify-start">
                <div className="bg-surface-raised border border-border/50 px-4 py-3 rounded-2xl shadow-md">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center">
                      <Bot size={16} className="text-brand-primary animate-pulse" />
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold text-brand-primary uppercase tracking-wider mb-1">Thinking</div>
                      <div className="flex gap-1">
                        <div className="w-1.5 h-1.5 bg-brand-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-brand-primary/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-brand-primary/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Retry Button */}
            {!isLoading && messages.length > 0 && isErrorMessage(messages[messages.length - 1].content) && (
              <div className="flex justify-center mt-4 animate-in fade-in slide-in-from-bottom-2">
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-raised hover:bg-surface-overlay border border-border rounded-xl text-xs font-medium text-text-secondary transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  <RefreshCw size={14} />
                  <span>Retry Last Request</span>
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="px-6 py-3 border-t border-border/30 bg-background flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-3 bg-surface-overlay border border-border/60 rounded-2xl px-4 py-2 focus-within:border-brand-primary/50 transition-colors">
              <Command size={18} className="text-text-muted flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message VerbOS..."
                className="flex-1 bg-transparent text-text-primary py-2 focus:outline-none text-sm placeholder:text-text-muted/50"
                autoFocus
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className={`p-2 rounded-xl transition-all ${input.trim() && !isLoading
                  ? 'bg-brand-primary text-background hover:bg-brand-primary-hover'
                  : 'bg-surface-raised text-text-muted opacity-50'
                  }`}
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
              </button>
            </div>
          </form>
          <div className="flex justify-center gap-4 mt-2 text-[10px] text-text-dim">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-raised text-[9px]">Enter</kbd>
              Send
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-raised text-[9px]">Cmd</kbd>
              Commands
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

