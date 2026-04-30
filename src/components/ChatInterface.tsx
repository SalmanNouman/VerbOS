import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter, type SyntaxHighlighterProps } from 'react-syntax-highlighter';
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
import {
  AgentTrace,
  reduceTrace,
  resolveLastApproval,
  startTurn,
  type TraceStep,
} from './AgentTrace';

type AgentState = 'thinking' | 'executing' | 'idle';
type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

interface ChatInterfaceProps {
  readonly currentSession: ChatSession | null;
  readonly onUpdateTitle: (sessionId: string, title: string) => Promise<void>;
}

interface ToolLog {
  id: string;
  name: string;
  args: unknown;
  result?: string;
}

const MESSAGE_ROLE_CLASSES = {
  user: 'bg-brand-primary text-background font-medium',
  assistant: 'bg-surface-raised text-text-secondary border border-border/50 hover:border-brand-primary/20',
  error: 'bg-red-500/5 text-red-600 border border-red-500/20',
};
const SYNTAX_HIGHLIGHTER_STYLE: SyntaxHighlighterProps['style'] = vscDarkPlus;
const ASSISTANT_NAME_BY_ROLE: Record<Message['role'], string> = {
  user: 'You',
  assistant: 'VerbOS',
};
const AGENT_STATE_COLORS: Record<Exclude<AgentState, 'idle'>, string> = {
  thinking: 'brand-primary',
  executing: 'brand-accent',
};
const MARKDOWN_COMPONENTS: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '');
    if (match) {
      return (
        <SyntaxHighlighter
          style={SYNTAX_HIGHLIGHTER_STYLE}
          language={match[1]}
          PreTag="div"
          className="!bg-background/80 !rounded-lg !text-xs !my-3 overflow-hidden !border !border-border/30"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      );
    }

    return (
      <code className={`${className} bg-background/60 text-brand-primary px-1.5 py-0.5 rounded text-xs font-mono border border-border/20`} {...props}>
        {children}
      </code>
    );
  },
};
const verbosApi = () => globalThis.window.verbos;

function isErrorMessage(content: string) {
  return content.includes('Error:') || content.includes('❌ Failed:') || content.includes('Agent logic reached session threshold');
}

function appendOrReplaceAssistantMessage(messages: Message[], content: string): Message[] {
  const updated = [...messages];
  const lastMessage = updated[updated.length - 1];

  if (lastMessage?.role === 'assistant') {
    updated[updated.length - 1] = { ...lastMessage, content };
  } else {
    updated.push({ role: 'assistant', content });
  }

  return updated;
}

function messageBubbleClassName(message: Message): string {
  if (message.role === 'user') {
    return MESSAGE_ROLE_CLASSES.user;
  }

  return isErrorMessage(message.content)
    ? MESSAGE_ROLE_CLASSES.error
    : MESSAGE_ROLE_CLASSES.assistant;
}

function shortenLogResult(result: string): string {
  return result.length > 300 ? `${result.slice(0, 300)}...` : result;
}

function resetAgentState(
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setStatusMessage: React.Dispatch<React.SetStateAction<string | null>>,
  setAgentState: React.Dispatch<React.SetStateAction<AgentState>>
) {
  setIsLoading(false);
  setStatusMessage(null);
  setAgentState('idle');
}

function addToolLogs(
  tools: ToolEvent['tools'],
  setToolLogs: React.Dispatch<React.SetStateAction<ToolLog[]>>
) {
  const newLogs = tools.map((tool, index) => ({
    id: `${Date.now()}-${tool.name}-${index}`,
    name: tool.name,
    args: tool.args,
  }));
  setToolLogs(prev => [...prev, ...newLogs]);
}

function setOldestPendingToolResult(
  result: string,
  setToolLogs: React.Dispatch<React.SetStateAction<ToolLog[]>>
) {
  setToolLogs(prev => {
    const pendingIndex = prev.findIndex(log => !log.result);
    if (pendingIndex === -1) {
      return prev;
    }

    const nextLogs = [...prev];
    nextLogs[pendingIndex] = { ...nextLogs[pendingIndex], result };
    return nextLogs;
  });
}

function agentStateClasses(agentState: AgentState) {
  const color = agentState === 'executing' ? AGENT_STATE_COLORS.executing : AGENT_STATE_COLORS.thinking;

  return {
    text: color === 'brand-primary' ? 'text-brand-primary' : 'text-brand-accent',
    dot: color === 'brand-primary' ? 'bg-brand-primary/60' : 'bg-brand-accent/60',
  };
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
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [showTrace, setShowTrace] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetLoadingState = () => {
    resetAgentState(setIsLoading, setStatusMessage, setAgentState);
  };

  const removeStreamListeners = () => {
    verbosApi()?.removeAgentEventListener();
    verbosApi()?.removeStreamEndListener();
  };

  const registerStreamListeners = () => {
    const verbos = verbosApi();
    verbos?.onAgentEvent(handleAgentEvent);
    verbos?.onStreamEnd(() => {
      resetLoadingState();
      removeStreamListeners();
    });
  };

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
    // Trace is scoped to a session's runtime view; reset on session switch so
    // we don't mix steps from the previous conversation with the new one.
    setTrace([]);
  }, [currentSession?.id]);

  const handleAgentEvent = (event: AgentEvent) => {
    setTrace(prev => reduceTrace(prev, event));

    switch (event.type) {
      case 'status':
        setStatusMessage(event.message);
        setAgentState('thinking');
        break;
      case 'tool':
        setStatusMessage(event.message);
        setAgentState('executing');
        if (event.tools) {
          addToolLogs(event.tools, setToolLogs);
        }
        break;
      case 'tool_result':
        setOldestPendingToolResult(event.message, setToolLogs);
        break;
      case 'response':
        setMessages(prev => appendOrReplaceAssistantMessage(prev, event.message));
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
        setMessages(prev => appendOrReplaceAssistantMessage(prev, `Error: ${event.message}`));
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
    setTrace(prev => startTurn(prev, text));

    try {
      const verbos = verbosApi();
      if (verbos?.askAgent) {
        registerStreamListeners();
        await verbos.askAgent(currentSession.id, text);
      } else {
        setTimeout(async () => {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `I received: "${text}". Connect to VerbOS backend for full functionality.`
          }]);
          resetLoadingState();
        }, 800);
      }
    } catch (error) {
      console.error('Agent error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: Failed to contact agent. Please ensure the backend is running.`
      }]);
      resetLoadingState();
    }
  };

  const handleApprove = async () => {
    if (!currentSession || !pendingAction) return;

    setIsLoading(true);
    setPendingAction(null);
    setStatusMessage('Executing approved action...');
    setAgentState('executing');
    setTrace(prev => resolveLastApproval(prev, 'approved'));

    try {
      const verbos = verbosApi();
      await verbos?.approveAction(currentSession.id);
      registerStreamListeners();
      await verbos?.resumeAgent(currentSession.id);
    } catch (error) {
      console.error('Approval error:', error);
      resetLoadingState();
    }
  };

  const handleDeny = async () => {
    if (!currentSession || !pendingAction) return;

    setIsLoading(true);
    setPendingAction(null);
    setStatusMessage('Action denied, continuing...');
    setAgentState('thinking');
    setTrace(prev => resolveLastApproval(prev, 'denied'));

    try {
      const verbos = verbosApi();
      await verbos?.denyAction(currentSession.id, 'User denied the action');
      registerStreamListeners();
      await verbos?.resumeAgent(currentSession.id);
    } catch (error) {
      console.error('Deny error:', error);
      resetLoadingState();
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

  return (
    <div className="flex h-full bg-background relative min-h-0">
    <div className="flex flex-col h-full bg-background relative flex-1 min-w-0">
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
              const bubbleAlignment = msg.role === 'user' ? 'justify-end' : 'justify-start';
              const messageAlignment = msg.role === 'user' ? 'items-end' : 'items-start';
              const nameColor = msg.role === 'user' ? 'text-brand-secondary' : 'text-brand-primary';
              return (
                <div
                  key={`${msg.role}-${index}-${msg.content.length}`}
                  className={`flex ${bubbleAlignment} group`}
                >
                  <div className={`flex flex-col gap-1.5 max-w-[80%] ${messageAlignment}`}>
                    <div className="flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${nameColor}`}>
                        {ASSISTANT_NAME_BY_ROLE[msg.role]}
                      </span>
                    </div>
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md transition-all hover:shadow-lg ${messageBubbleClassName(msg)}`}
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
                            components={MARKDOWN_COMPONENTS}
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
                      <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${agentStateClasses(agentState).text}`}>
                        {statusMessage || 'Processing'}
                      </div>
                      <div className="flex gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentStateClasses(agentState).dot}`} style={{ animationDelay: '0ms' }} />
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentStateClasses(agentState).dot}`} style={{ animationDelay: '150ms' }} />
                        <div className={`w-1.5 h-1.5 rounded-full animate-bounce ${agentStateClasses(agentState).dot}`} style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                    {toolLogs.length > 0 && (
                      <button
                        type="button"
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
                      {toolLogs.map((log) => (
                        <div key={log.id} className="text-xs">
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
                                  {shortenLogResult(log.result)}
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
                      type="button"
                      onClick={handleApprove}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded-xl text-sm font-medium text-green-500 transition-all active:scale-95"
                    >
                      <CheckCircle size={16} />
                      Approve
                    </button>
                    <button
                      type="button"
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
                  type="button"
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
              <span>Send</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-surface-raised text-[9px]">Cmd</kbd>
              <span>Commands</span>
            </span>
          </div>
        </div>
      </div>
    </div>

      <AgentTrace
        trace={trace}
        isOpen={showTrace}
        onToggle={() => setShowTrace(v => !v)}
        onClear={() => setTrace([])}
        isRunning={isLoading}
      />
    </div>
  );
}