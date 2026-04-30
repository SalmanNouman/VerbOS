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
  trace: TraceStep[];
  isOpen: boolean;
  onToggle: () => void;
  isRunning: boolean;
  onClear?: () => void;
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

/**
 * Translate an `AgentEvent` into zero-or-more trace-step mutations.
 *
 * We parse the free-text `status` messages the backend emits today
 * ("Routing to FileSystem Agent...", "Next: Supervisor", etc.) so this panel
 * works with the existing SSE contract — no backend changes required.
 */
export function reduceTrace(prev: TraceStep[], event: AgentEvent): TraceStep[] {
  const now = Date.now();
  const nextId = () => nextStepId();

  switch (event.type) {
    case 'status': {
      const msg = event.message ?? '';

      const routingMatch = msg.match(ROUTING_PATTERN);
      if (routingMatch) {
        const workerLabel = routingMatch[1];
        return [
          ...prev,
          {
            id: nextId(),
            kind: 'worker',
            timestamp: now,
            label: workerLabel,
            workerName: workerLabel,
            status: 'pending',
          },
        ];
      }

      const nextMatch = msg.match(NEXT_PATTERN);
      if (nextMatch) {
        return [
          ...prev,
          {
            id: nextId(),
            kind: 'supervisor',
            timestamp: now,
            label: 'Supervisor',
            next: nextMatch[1],
            status: 'ok',
          },
        ];
      }

      // Plain "Processing...", "Thinking..." etc — only add once per turn so
      // we don't spam the trace with duplicate initial status messages.
      if (msg && !prev.some(s => s.kind === 'supervisor' && s.label === 'Initial' && s.detail === msg)) {
        const lastStep = prev[prev.length - 1];
        if (!lastStep || lastStep.kind !== 'supervisor' || lastStep.detail !== msg) {
          return [
            ...prev,
            {
              id: nextId(),
              kind: 'supervisor',
              timestamp: now,
              label: 'Initial',
              detail: msg,
              status: 'pending',
            },
          ];
        }
      }
      return prev;
    }

    case 'tool': {
      const newSteps: TraceStep[] = (event.tools ?? []).map(t => ({
        id: nextId(),
        kind: 'tool',
        timestamp: now,
        label: t.name,
        toolName: t.name,
        toolArgs: t.args,
        status: 'pending',
      }));

      // Mark the most recent worker step as "executing" (status: ok isn't right,
      // leave pending until response). No-op here — worker remains pending.
      return [...prev, ...newSteps];
    }

    case 'tool_result': {
      // Attach the result to the oldest pending tool step. `tool` events emit
      // tools in dispatch order and `tool_result` events arrive in the same
      // order, so matching oldest-first pairs each result with its own tool.
      // A backward scan would mis-assign results when multiple tools are
      // dispatched in one event (A, B, C → results for A get attached to C).
      const updated = [...prev];
      for (let i = 0; i < updated.length; i++) {
        const step = updated[i];
        if (step.kind === 'tool' && step.status === 'pending' && !step.toolResult) {
          updated[i] = { ...step, status: 'ok', toolResult: event.message };
          return updated;
        }
      }
      return prev;
    }

    case 'approval_required': {
      const action = event.action as PendingAction;
      return [
        ...prev,
        {
          id: nextId(),
          kind: 'approval',
          timestamp: now,
          label: action.toolName,
          workerName: action.workerName,
          toolName: action.toolName,
          toolArgs: action.toolArgs,
          sensitivity: action.sensitivity,
          detail: action.description,
          status: 'awaiting_approval',
        },
      ];
    }

    case 'response': {
      // Mark any trailing pending worker/supervisor steps as complete.
      const finalized = prev.map(step =>
        step.status === 'pending' ? { ...step, status: 'ok' as const } : step
      );
      return [
        ...finalized,
        {
          id: nextId(),
          kind: 'response',
          timestamp: now,
          label: 'Response',
          detail: event.message,
          status: 'ok',
        },
      ];
    }

    case 'error': {
      const finalized = prev.map(step =>
        step.status === 'pending' ? { ...step, status: 'error' as const } : step
      );
      return [
        ...finalized,
        {
          id: nextId(),
          kind: 'error',
          timestamp: now,
          label: 'Error',
          detail: event.message,
          status: 'error',
        },
      ];
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

function ToolResultPreview({ result }: { result: string }) {
  return (
    <div>
      <div className="text-[9px] text-emerald-400/80 mb-0.5 uppercase tracking-wider">Result</div>
      <pre className="bg-background/60 border border-border/30 rounded p-2 text-[10px] text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-40">
        {truncateToolResult(result)}
      </pre>
    </div>
  );
}

function TraceStepCard({ step }: { step: TraceStep }) {
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
