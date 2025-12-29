import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Sparkles,
  ArrowUp,
  Command,
  Loader2,
  Terminal,
  Cpu,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronRight,
  Brain
} from 'lucide-react';
import type { ChatSession, Message, AgentEvent, PendingAction } from '../types/verbos';

interface ChatInterfaceProps {
  currentSession: ChatSession | null;
  onUpdateTitle: (sessionId: string, title: string) => Promise<void>;
}

interface ToolLog {
  name: string;
  args: any;
  result?: string;
}

export function ChatInterface({ currentSession, onUpdateTitle }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastInput, setLastInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [toolLogs, setToolLogs] = useState<ToolLog[]>([]);
  const [showToolLogs, setShowToolLogs] = useState(false);
  const [agentState, setAgentState] = useState<'thinking' | 'executing' | 'idle'>('idle');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, toolLogs, statusMessage]);

  useEffect(() => {
    if (currentSession) {
      setMessages(currentSession.messages);
    } else {
      setMessages([]);
    }
  }, [currentSession?.id]);

  const handleAgentEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'status':
        setStatusMessage(event.message);
        setAgentState('thinking');
        break;
      case 'tool':
        setStatusMessage(event.message); // "Using tools: ..."
        setAgentState('executing');
        if (event.tools) {
          const newLogs = event.tools.map(t => ({ name: t.name, args: t.args }));
          setToolLogs(prev => [...prev, ...newLogs]);
        }
        break;
      case 'tool_result':
        setToolLogs(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && !last.result) {
            last.result = event.message;
          }
          return copy;
        });
        break;
      case 'response':
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];

          // Check if we need to append a new message or update existing
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = { ...lastMsg, content: event.message };
          } else {
            updated.push({ role: 'assistant', content: event.message });
          }
          return updated;
        });
        setStatusMessage(null);
        setAgentState('idle');
        break;
      case 'approval_required':
        setPendingAction(event.action);
        setStatusMessage(null);
        setIsLoading(false); // Paused waiting for user
        setAgentState('idle');
        break;
      case 'error':
        setMessages(prev => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            updated[updated.length - 1] = { ...lastMsg, content: `Error: ${event.message}` };
          } else {
            updated.push({ role: 'assistant', content: `Error: ${event.message}` });
          }
          return updated;
        });
        setStatusMessage(null);
        setAgentState('idle');
        break;
      case 'done':
        setIsLoading(false);
        setStatusMessage(null);
        setAgentState('idle');
        break;
    }
  };

  const sendMessage = async (text: string) => {
    if (!currentSession) return;

    setIsLoading(true);
    setStatusMessage('Thinking...');
    setAgentState('thinking');
    setToolLogs([]);
    setShowToolLogs(false);

    try {
      if (window.verbos && window.verbos.askAgent) {
        window.verbos.onAgentEvent(handleAgentEvent);

        window.verbos?.onStreamEnd(async () => {
          setIsLoading(false);
          setStatusMessage(null);
          setAgentState('idle');
          window.verbos?.removeAgentEventListener();
          window.verbos?.removeStreamEndListener();
        });

        await window.verbos.askAgent(currentSession.id, text);
      } else {
        // Fallback for dev/demo without backend
        setTimeout(async () => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `I received: "${text}". Connect to VerbOS backend for full functionality.`
          }]);
          setIsLoading(false);
          setAgentState('idle');
        }, 800);
      }
    } catch (error) {
      console.error('Agent error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: Failed to contact agent. Please ensure the backend is running.`
      }]);
      setIsLoading(false);
      setStatusMessage(null);
      setAgentState('idle');
    }
  };

  const handleApprove = async () => {
    if (!currentSession || !pendingAction) return;

    setIsLoading(true);
    setPendingAction(null);
    setStatusMessage('Executing approved action...');
    setAgentState('executing');

    try {
      await window.verbos?.approveAction(currentSession.id);

      window.verbos?.onAgentEvent(handleAgentEvent);
      window.verbos?.onStreamEnd(() => {
        setIsLoading(false);
        setStatusMessage(null);
        setAgentState('idle');
        window.verbos?.removeAgentEventListener();
        window.verbos?.removeStreamEndListener();
      });

      await window.verbos?.resumeAgent(currentSession.id);
    } catch (error) {
      console.error('Approval error:', error);
      setIsLoading(false);
      setStatusMessage(null);
      setAgentState('idle');
    }
  };

  const handleDeny = async () => {
    if (!currentSession || !pendingAction) return;

    setIsLoading(true);
    setPendingAction(null);
    setStatusMessage('Action denied, continuing...');
    setAgentState('thinking');

    try {
      await window.verbos?.denyAction(currentSession.id, 'User denied the action');

      window.verbos?.onAgentEvent(handleAgentEvent);
      window.verbos?.onStreamEnd(() => {
        setIsLoading(false);
        setStatusMessage(null);
        setAgentState('idle');
        window.verbos?.removeAgentEventListener();
        window.verbos?.removeStreamEndListener();
      });

      await window.verbos?.resumeAgent(currentSession.id);
    } catch (error) {
      console.error('Deny error:', error);
      setIsLoading(false);
      setStatusMessage(null);
      setAgentState('idle');
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

            {/* Loading/Status/Reasoning Indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-surface-raised border border-border/50 px-4 py-3 rounded-2xl shadow-md w-full max-w-xl">
                  {/* Status Header */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center">
                      {agentState === 'thinking' ? (
                        <Brain size={16} className="text-brand-primary animate-pulse" />
                      ) : (
                        <Terminal size={16} className="text-brand-accent animate-pulse" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${agentState === 'thinking' ? 'text-brand-primary' : 'text-brand-accent'}`}>
                        {statusMessage || 'Processing'}
                      </div>
                      <div className="flex gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentState === 'thinking' ? 'bg-brand-primary/60' : 'bg-brand-accent/60'}`} style={{ animationDelay: '0ms' }} />
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentState === 'thinking' ? 'bg-brand-primary/60' : 'bg-brand-accent/60'}`} style={{ animationDelay: '150ms' }} />
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentState === 'thinking' ? 'bg-brand-primary/60' : 'bg-brand-accent/60'}`} style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                    {toolLogs.length > 0 && (
                      <button
                        onClick={() => setShowToolLogs(!showToolLogs)}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary px-2 py-1 rounded-md hover:bg-surface-overlay transition-colors"
                      >
                        {showToolLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {showToolLogs ? 'Hide Reasoning' : 'View Reasoning'}
                      </button>
                    )}
                  </div>

                  {/* Collapsible Tool Logs */}
                  {showToolLogs && toolLogs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/30 space-y-3 animate-in fade-in slide-in-from-top-1">
                      {toolLogs.map((log, i) => (
                        <div key={i} className="text-xs">
                          <div className="flex items-center gap-2 text-text-dim mb-1 font-mono">
                            <ChevronRight size={10} />
                            <span className="font-semibold text-brand-secondary">{log.name}</span>
                          </div>
                          <div className="pl-4 border-l-2 border-border/30 ml-1 space-y-1">
                            <pre className="bg-background/50 p-2 rounded text-[10px] text-text-secondary overflow-x-auto">
                              {JSON.stringify(log.args, null, 2)}
                            </pre>
                            {log.result && (
                              <div className="mt-1">
                                <div className="text-[10px] text-green-500/80 mb-0.5">Result:</div>
                                <pre className="bg-background/50 p-2 rounded text-[10px] text-text-secondary overflow-x-auto max-h-32">
                                  {log.result.length > 300 ? log.result.slice(0, 300) + '...' : log.result}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* HITL Approval Card */}
            {pendingAction && !isLoading && (
              <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
                <div className="bg-amber-500/5 border border-amber-500/30 px-5 py-4 rounded-2xl shadow-lg max-w-md w-full">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle size={20} className="text-amber-500" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-1">
                        Approval Required
                      </div>
                      <p className="text-sm text-text-primary font-medium">
                        {pendingAction.description}
                      </p>
                    </div>
                  </div>

                  <div className="bg-background/50 rounded-lg p-3 mb-4 border border-border/30">
                    <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
                      <Wrench size={12} />
                      <span className="font-medium">{pendingAction.toolName}</span>
                      <span className="text-text-dim">by {pendingAction.workerName.replace('_worker', '')}</span>
                    </div>
                    <div className="relative group">
                      <pre
                        className="text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar"
                        title={JSON.stringify(pendingAction.toolArgs, null, 2)}
                      >
                        {JSON.stringify(pendingAction.toolArgs, null, 2)}
                      </pre>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleApprove}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-xl text-sm font-medium text-green-500 transition-all active:scale-95"
                    >
                      <CheckCircle size={16} />
                      Approve
                    </button>
                    <button
                      onClick={handleDeny}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-sm font-medium text-red-500 transition-all active:scale-95"
                    >
                      <XCircle size={16} />
                      Deny
                    </button>
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