import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatSession, Message } from '../types/augos';

interface ChatInterfaceProps {
  currentSession: ChatSession | null;
  onSaveSession: (session: ChatSession) => Promise<void>;
}

export function ChatInterface({ currentSession, onSaveSession }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (currentSession) {
      setMessages(currentSession.messages);
    } else {
      setMessages([]);
    }
  }, [currentSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !currentSession) return;

    const userMsg: Message = {
      role: 'user',
      content: input,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    if (messages.length === 0) {
      await onSaveSession({
        ...currentSession,
        title: input.slice(0, 50) + (input.length > 50 ? '...' : ''),
        messages: newMessages,
        updatedAt: Date.now(),
      });
    }

    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
    };
    const messagesWithAssistant = [...newMessages, assistantMsg];
    setMessages(messagesWithAssistant);

    try {
      if (window.augos && window.augos.askAgent) {
        window.augos.onToken((token: string) => {
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              updated[updated.length - 1] = { ...lastMsg, content: lastMsg.content + token };
            }
            return updated;
          });
        });

        window.augos?.onStreamEnd(async () => {
          setIsLoading(false);
          window.augos?.removeTokenListener();
          window.augos?.removeStreamEndListener();

          setMessages(prev => {
            onSaveSession({
              ...currentSession,
              messages: prev,
              updatedAt: Date.now(),
            });
            return prev;
          });
        });

        await window.augos.askAgent(userMsg.content);
      } else {
        setTimeout(async () => {
          const finalMessages = messagesWithAssistant.map((msg, i) =>
            i === messagesWithAssistant.length - 1
              ? { ...msg, content: `I received: "${userMsg.content}". Connect to AugOS backend for full functionality.` }
              : msg
          );
          setMessages(finalMessages);
          setIsLoading(false);
          await onSaveSession({
            ...currentSession,
            messages: finalMessages,
            updatedAt: Date.now(),
          });
        }, 800);
      }
    } catch (error) {
      console.error('Agent error:', error);
      const errorMessages = messagesWithAssistant.map((msg, i) =>
        i === messagesWithAssistant.length - 1
          ? { ...msg, content: `Error: Failed to contact agent.` }
          : msg
      );
      setMessages(errorMessages);
      setIsLoading(false);
      await onSaveSession({
        ...currentSession,
        messages: errorMessages,
        updatedAt: Date.now(),
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[60vh] text-text-muted opacity-50 select-none">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-4"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5c0-2 2-2 2-2" /></svg>
              <p className="text-sm font-medium">AugOS Agent Ready</p>
              <p className="text-xs mt-1">Type a command to begin...</p>
            </div>
          )}

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
            >
              <div
                className={`max-w-[85%] rounded-lg p-4 shadow-sm text-sm leading-relaxed ${msg.role === 'user'
                  ? 'bg-surfaceHighlight text-text-primary border border-border'
                  : 'bg-transparent text-text-secondary pl-2 border-l-2 border-primary/50 rounded-none'
                  }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-primary uppercase tracking-wider opacity-80 select-none">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5c0-2 2-2 2-2" /></svg>
                    <span>Agent</span>
                  </div>
                )}
                {msg.role === 'assistant' ? (
                  <div className="prose prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({ node, inline, className, children, ...props }: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                            <SyntaxHighlighter
                              style={oneDark as any}
                              language={match[1]}
                              PreTag="div"
                              {...props}
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={className} {...props}>
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
          ))}

          {isLoading && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
            <div className="flex justify-start animate-in fade-in duration-300">
              <div className="bg-transparent pl-0 border-l-2 border-primary/50 p-4 rounded-none">
                <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-primary uppercase tracking-wider opacity-80">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M12 2v4" /><path d="m16.2 7.8 2.9-2.9" /><path d="M18 12h4" /><path d="m16.2 16.2 2.9 2.9" /><path d="M12 18v4" /><path d="m7.8 16.2-2.9 2.9" /><path d="M6 12H2" /><path d="m7.8 7.8-2.9-2.9" /></svg>
                  <span>Thinking</span>
                </div>
                <div className="h-4 w-24 bg-surfaceHighlight/50 rounded animate-pulse"></div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-background border-t border-border z-10">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="relative group">
            <div className="absolute inset-0 bg-primary/5 rounded-lg blur-sm group-focus-within:bg-primary/10 transition-all duration-300"></div>
            <div className="relative flex items-center bg-surface border border-border rounded-lg shadow-sm focus-within:border-primary/50 focus-within:shadow-[0_0_0_1px_rgba(59,130,246,0.1)] transition-all duration-200">
              <div className="pl-3 text-text-muted">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </div>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask AugOS..."
                className="flex-1 bg-transparent text-text-primary p-3 focus:outline-none font-sans placeholder:text-text-muted/50"
                autoFocus
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2 mr-1 text-text-muted hover:text-primary disabled:opacity-30 disabled:hover:text-text-muted transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            </div>
          </form>
          <div className="flex justify-center mt-2 gap-4 text-[10px] text-text-muted opacity-60">
            <span className="flex items-center gap-1"><span className="bg-surface border border-border px-1 rounded text-[9px]">↵</span> to send</span>
            <span className="flex items-center gap-1"><span className="bg-surface border border-border px-1 rounded text-[9px]">↑</span> for history</span>
          </div>
        </div>
      </div>
    </div>
  );
}

