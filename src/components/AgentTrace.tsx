import { useState } from 'react';
import {
  Activity,
  Brain,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  ArrowRight,
  Wrench,
  MessageSquare,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { AgentEvent, PendingAction } from '../types/verbos';

type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;
type ToolEventTool = ToolEvent['tools'][number];

export type TraceStepKind =
  | 'turn'
  | 'supervisor'
  | 'worker'
  | 'tool'
  | 'approval'
  | 'response'
  | 'error';

export type TraceStepStatus =
  | 'pending'
  | 'ok'
  | 'error'
  | 'awaiting_approval'
  | 'approved'
  | 'denied';

type TraceSensitivity = 'safe' | 'moderate' | 'sensitive';

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  timestamp: number;
  label: string;
  detail?: string;
  workerName?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
  next?: string;
  sensitivity?: TraceSensitivity;
  status?: TraceStepStatus;
}

interface AgentTraceProps {
  readonly trace: TraceStep[];
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly isRunning: boolean;
  readonly onClear?: () => void;
}

interface TraceStepCardProps {
  readonly step: TraceStep;
}

interface ToolResultPreviewProps {
  readonly result: string;
}

interface NewTraceStepInput {
  kind: TraceStepKind;
  label: string;
  detail?: string;
  workerName?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
  next?: string;
  sensitivity?: TraceSensitivity;
  status?: TraceStepStatus;
}

const ROUTING_PATTERN = /^Routing to (.+?)\.\.\.$/;
const NEXT_PATTERN = /^Next: (.+)$/;
const SENSITIVITY_BADGE_CLASSES: Record<TraceSensitivity, string> = {
  sensitive: 'bg-red-500/10 text-red-400',
  moderate: 'bg-amber-500/10 text-amber-400',
  safe: 'bg-emerald-500/10 text-emerald-400',
};

// Monotonic counter for generating unique trace-step ids. These ids are only
// used as React keys and for targeted updates — no security or entropy
// requirement — so a process-local counter is sufficient and avoids the
// `Math.random()` "weak pseudorandom" lint flag.
let _stepCounter = 0;
const nextStepId = (prefix: string = 'step') =>
  `${prefix}-${++_stepCounter}`;

function newTraceStep(input: NewTraceStepInput): TraceStep {
  return {
    id: nextStepId(),
    timestamp: Date.now(),
    ...input,
  };
}

function pendingWorkerStep(label: string): TraceStep {
  return newTraceStep({
    kind: 'worker',
    label,
    workerName: label,
    status: 'pending',
  });
}

function supervisorStep(next: string): TraceStep {
  return newTraceStep({
    kind: 'supervisor',
    label: 'Supervisor',
    next,
    status: 'ok',
  });
}

function initialStep(detail: string): TraceStep {
  return newTraceStep({
    kind: 'supervisor',
    label: 'Initial',
    detail,
    status: 'pending',
  });
}

function toolStep(tool: ToolEventTool): TraceStep {
  return newTraceStep({
    kind: 'tool',
    label: tool.name,
    toolName: tool.name,
    toolArgs: tool.args,
    status: 'pending',
  });
}

function approvalStep(action: PendingAction): TraceStep {
  return newTraceStep({
    kind: 'approval',
    label: action.toolName,
    workerName: action.workerName,
    toolName: action.toolName,
    toolArgs: action.toolArgs,
    sensitivity: action.sensitivity,
    detail: action.description,
    status: 'awaiting_approval',
  });
}

function resultStep(kind: 'response' | 'error', detail: string): TraceStep {
  return newTraceStep({
    kind,
    label: kind === 'response' ? 'Response' : 'Error',
    detail,
    status: kind === 'response' ? 'ok' : 'error',
  });
}

function hasInitialStatus(prev: TraceStep[], detail: string): boolean {
  return prev.some(step => step.kind === 'supervisor' && step.label === 'Initial' && step.detail === detail);
}

function appendStatusStep(prev: TraceStep[], message: string): TraceStep[] {
  const routingMatch = ROUTING_PATTERN.exec(message);
  if (routingMatch) {
    return [...prev, pendingWorkerStep(routingMatch[1])];
  }

  const nextMatch = NEXT_PATTERN.exec(message);
  if (nextMatch) {
    return [...prev, supervisorStep(nextMatch[1])];
  }

  const lastStep = prev[prev.length - 1];
  const isDuplicate = !message || hasInitialStatus(prev, message) || (lastStep?.kind === 'supervisor' && lastStep.detail === message);
  return isDuplicate ? prev : [...prev, initialStep(message)];
}

function appendToolResult(prev: TraceStep[], message: string): TraceStep[] {
  const updated = [...prev];
  const pendingIndex = updated.findIndex(step => step.kind === 'tool' && step.status === 'pending' && !step.toolResult);
  if (pendingIndex === -1) {
    return prev;
  }

  updated[pendingIndex] = { ...updated[pendingIndex], status: 'ok', toolResult: message };
  return updated;
}

function finalizePending(prev: TraceStep[], status: 'ok' | 'error'): TraceStep[] {
  return prev.map(step => step.status === 'pending' ? { ...step, status } : step);
}

/**
 * Translate an `AgentEvent` into zero-or-more trace-step mutations.
 *
 * We parse the free-text `status` messages the backend emits today
 * ("Routing to FileSystem Agent...", "Next: Supervisor", etc.) so this panel
 * works with the existing SSE contract — no backend changes required.
 */
export function reduceTrace(prev: TraceStep[], event: AgentEvent): TraceStep[] {
  switch (event.type) {
    case 'status':
      return appendStatusStep(prev, event.message ?? '');

    case 'tool': {
      const newSteps: TraceStep[] = (event.tools ?? []).map(toolStep);
      return [...prev, ...newSteps];
    }

    case 'tool_result':
      return appendToolResult(prev, event.message);

    case 'approval_required': {
      return [...prev, approvalStep(event.action)];
    }

    case 'response': {
      return [...finalizePending(prev, 'ok'), resultStep('response', event.message)];
    }

    case 'error': {
      return [...finalizePending(prev, 'error'), resultStep('error', event.message)];
    }

    case 'done':
    default:
      return prev;
  }
}

/**
 * Mark the most-recent approval step as approved/denied. Called from the
 * HITL handlers in ChatInterface so the trace reflects the user's decision.
 */
export function resolveLastApproval(
  prev: TraceStep[],
  decision: 'approved' | 'denied'
): TraceStep[] {
  const updated = [...prev];
  for (let i = updated.length - 1; i >= 0; i--) {
    const step = updated[i];
    if (step.kind === 'approval' && step.status === 'awaiting_approval') {
      updated[i] = { ...step, status: decision };
      return updated;
    }
  }
  return prev;
}

/** Start a new turn in the trace with the user's prompt at the top. */
export function startTurn(prev: TraceStep[], userMessage: string): TraceStep[] {
  return [
    ...prev,
    {
      id: nextStepId('turn'),
      kind: 'turn',
      timestamp: Date.now(),
      label: 'User',
      detail: userMessage,
      status: 'ok',
    },
  ];
}

function stepIcon(step: TraceStep) {
  const size = 14;
  switch (step.kind) {
    case 'turn':
      return <MessageSquare size={size} className="text-brand-secondary" />;
    case 'supervisor':
      return <Brain size={size} className="text-brand-primary" />;
    case 'worker':
      return <Cpu size={size} className="text-brand-accent" />;
    case 'tool':
      return <Wrench size={size} className="text-amber-400" />;
    case 'approval':
      return <AlertTriangle size={size} className="text-amber-500" />;
    case 'response':
      return <Sparkles size={size} className="text-emerald-400" />;
    case 'error':
      return <XCircle size={size} className="text-red-400" />;
  }
}

function statusBadge(status?: TraceStepStatus) {
  if (!status) return null;
  const common = 'inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded';
  switch (status) {
    case 'pending':
      return (
        <span className={`${common} bg-brand-primary/10 text-brand-primary`}>
          <Clock size={9} /> pending
        </span>
      );
    case 'ok':
      return (
        <span className={`${common} bg-emerald-500/10 text-emerald-400`}>
          <CheckCircle2 size={9} /> ok
        </span>
      );
    case 'error':
      return (
        <span className={`${common} bg-red-500/10 text-red-400`}>
          <XCircle size={9} /> error
        </span>
      );
    case 'awaiting_approval':
      return (
        <span className={`${common} bg-amber-500/10 text-amber-500`}>
          <AlertTriangle size={9} /> awaiting
        </span>
      );
    case 'approved':
      return (
        <span className={`${common} bg-emerald-500/10 text-emerald-400`}>
          <CheckCircle2 size={9} /> approved
        </span>
      );
    case 'denied':
      return (
        <span className={`${common} bg-red-500/10 text-red-400`}>
          <XCircle size={9} /> denied
        </span>
      );
  }
}

function sensitivityBadge(sensitivity?: TraceStep['sensitivity']) {
  if (!sensitivity) return null;

  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${SENSITIVITY_BADGE_CLASSES[sensitivity]}`}>
      {sensitivity}
    </span>
  );
}

function truncateToolResult(result: string): string {
  return result.length > 600 ? `${result.slice(0, 600)}\n... [truncated]` : result;
}

function ToolResultPreview({ result }: ToolResultPreviewProps) {
  return (
    <div>
      <div className="text-[9px] text-emerald-400/80 mb-0.5 uppercase tracking-wider">Result</div>
      <pre className="bg-background/60 border border-border/30 rounded p-2 text-[10px] text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-40">
        {truncateToolResult(result)}
      </pre>
    </div>
  );
}

function TraceStepCard({ step }: TraceStepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasExpandable = Boolean(step.detail || step.toolArgs || step.toolResult);

  return (
    <div className="group">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-md bg-surface-overlay border border-border/50 flex items-center justify-center">
          {stepIcon(step)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-text-primary truncate">
              {step.label}
            </span>
            {step.kind === 'supervisor' && step.next && (
              <>
                <ArrowRight size={10} className="text-text-dim" />
                <span className="text-[10px] text-text-muted font-mono">{step.next}</span>
              </>
            )}
            {sensitivityBadge(step.sensitivity)}
            {statusBadge(step.status)}
          </div>

          {hasExpandable && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}

          {expanded && (
            <div className="mt-1.5 space-y-1.5">
              {step.detail && (
                <pre className="bg-background/60 border border-border/30 rounded p-2 text-[10px] text-text-secondary whitespace-pre-wrap break-words overflow-x-auto">
                  {step.detail}
                </pre>
              )}
              {step.toolArgs != null && (
                <div>
                  <div className="text-[9px] text-text-dim mb-0.5 uppercase tracking-wider">Args</div>
                  <pre className="bg-background/60 border border-border/30 rounded p-2 text-[10px] text-text-secondary overflow-x-auto">
                    {JSON.stringify(step.toolArgs, null, 2)}
                  </pre>
                </div>
              )}
              {step.toolResult && <ToolResultPreview result={step.toolResult} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgentTrace({ trace, isOpen, onToggle, isRunning, onClear }: AgentTraceProps) {
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        title="Show agent trace"
        className="self-stretch flex-shrink-0 w-10 border-l border-border/50 bg-surface/30 hover:bg-surface-raised transition-colors flex flex-col items-center py-4 gap-3 text-text-muted hover:text-text-primary"
      >
        <ChevronLeft size={16} />
        <Activity size={18} className={isRunning ? 'text-brand-primary animate-pulse' : ''} />
        <div
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Trace
        </div>
        {trace.length > 0 && (
          <span className="text-[9px] font-mono bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded">
            {trace.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside className="self-stretch flex-shrink-0 w-80 border-l border-border/50 bg-surface/30 flex flex-col min-h-0">
      <div className="h-11 flex items-center justify-between px-3 border-b border-border/50 bg-background/40 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className={isRunning ? 'text-brand-primary animate-pulse' : 'text-text-muted'} />
          <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">Agent Trace</span>
          {trace.length > 0 && (
            <span className="text-[10px] font-mono bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded">
              {trace.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {trace.length > 0 && onClear && (
            <button
              onClick={onClear}
              className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-surface-overlay"
              title="Clear trace"
            >
              Clear
            </button>
          )}
          <button
            onClick={onToggle}
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-surface-overlay"
            title="Hide trace panel"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
        {trace.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center text-text-muted mb-3">
              <Activity size={16} />
            </div>
            <p className="text-xs text-text-muted max-w-[220px] leading-relaxed">
              Send a message to see the supervisor's routing, each worker's tool calls, and approvals as they happen.
            </p>
          </div>
        ) : (
          trace.map(step => <TraceStepCard key={step.id} step={step} />)
        )}
      </div>
    </aside>
  );
}
