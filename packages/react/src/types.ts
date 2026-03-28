// ── Inbound SSE event payloads ────────────────────────────────────────

export interface TokenEvent {
  text: string;
}

export interface ThinkingEvent {
  text: string;
}

export interface ToolUseEvent {
  toolName: string;
  toolUseId: string;
  status: "running" | "done" | "error";
  inputSummary?: string;
  outputSummary?: string;
  durationMs?: number;
}

export interface SubProgress {
  current: number;
  total: number;
  itemTitle: string;
}

export interface ProgressEvent {
  step: string;
  percentage: number;
  message: string;
  subProgress?: SubProgress | null;
}

export interface TurnEvent {
  turnNumber: number;
  totalTools: number;
}

export interface CreationEvent {
  creationType: string;
  count: number;
  toolUseId: string;
  items?: unknown[];
}

export interface ErrorEvent {
  errorType: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoneEvent {
  messageId: string;
  numTurns: number;
  toolCount: number;
  durationMs: number;
  isError: boolean;
  model?: string;
  totalCostUsd?: number;
}

// ── Callback map passed to startStream / AgentStreamClient ───────────

export interface AgentStreamCallbacks {
  onToken?: (text: string) => void;
  onThinking?: (event: ThinkingEvent) => void;
  /** Called for both tool_use (status=running) and tool_result (status=done|error) */
  onToolUse?: (event: ToolUseEvent) => void;
  onTurn?: (event: TurnEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  onCreation?: (event: CreationEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onDone?: (event: DoneEvent) => void;
}

// ── React hook state ─────────────────────────────────────────────────

export interface AgentStreamState {
  isStreaming: boolean;
  /** Accumulated text from all token events */
  text: string;
  progress: ProgressEvent | null;
  /** Names of currently running tools */
  activeTools: string[];
  error: ErrorEvent | null;
  isDone: boolean;
}
