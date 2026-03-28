interface TokenEvent {
    text: string;
}
interface ThinkingEvent {
    text: string;
}
interface ToolUseEvent {
    toolName: string;
    toolUseId: string;
    status: "running" | "done" | "error";
    inputSummary?: string;
    outputSummary?: string;
    durationMs?: number;
}
interface SubProgress {
    current: number;
    total: number;
    itemTitle: string;
}
interface ProgressEvent {
    step: string;
    percentage: number;
    message: string;
    subProgress?: SubProgress | null;
}
interface TurnEvent {
    turnNumber: number;
    totalTools: number;
}
interface CreationEvent {
    creationType: string;
    count: number;
    toolUseId: string;
    items?: unknown[];
}
interface ErrorEvent {
    errorType: string;
    message: string;
    details?: Record<string, unknown>;
}
interface DoneEvent {
    messageId: string;
    numTurns: number;
    toolCount: number;
    durationMs: number;
    isError: boolean;
    model?: string;
    totalCostUsd?: number;
}
interface AgentStreamCallbacks {
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
interface AgentStreamState {
    isStreaming: boolean;
    /** Accumulated text from all token events */
    text: string;
    progress: ProgressEvent | null;
    /** Names of currently running tools */
    activeTools: string[];
    error: ErrorEvent | null;
    isDone: boolean;
}

/**
 * AgentStreamClient — framework-agnostic SSE client for agent-stream protocol.
 *
 * Handles fetch, chunked SSE parsing, cross-chunk event buffering,
 * exponential-backoff reconnect, and auth token injection.
 *
 * @example
 * const client = new AgentStreamClient({ getToken: () => auth.getToken() });
 * await client.start("/api/chat", { message }, {
 *   onToken: (text) => append(text),
 *   onDone: (e) => console.log(`${e.numTurns} turns`),
 * });
 */

interface AgentStreamClientOptions {
    /** Async function returning the Bearer token, or null if unauthenticated. */
    getToken?: () => Promise<string | null>;
    /** Base URL prepended to all endpoints. Defaults to "". */
    baseUrl?: string;
}
declare class AgentStreamClient {
    private abort;
    private retryCount;
    private retryTimer;
    private readonly opts;
    constructor(options?: AgentStreamClientOptions);
    start(endpoint: string, body: Record<string, unknown>, callbacks: AgentStreamCallbacks): Promise<void>;
    stop(): void;
    private _attempt;
    /** Returns true when a "done" event was dispatched. */
    private _dispatch;
}

/**
 * React hook for consuming an agent-stream SSE endpoint.
 *
 * @example
 * const { text, isStreaming, startStream, stop } = useAgentStream({
 *   getToken: () => auth.getToken(),
 * });
 *
 * await startStream("/api/chat", { message: "Hello" }, {
 *   onCreation: (e) => showCard(e),
 * });
 */
declare function useAgentStream(options?: AgentStreamClientOptions): {
    startStream: (endpoint: string, body: Record<string, unknown>, callbacks?: AgentStreamCallbacks) => Promise<void>;
    stop: () => void;
    reset: () => void;
    isStreaming: boolean;
    text: string;
    progress: ProgressEvent | null;
    activeTools: string[];
    error: ErrorEvent | null;
    isDone: boolean;
};

export { type AgentStreamCallbacks, AgentStreamClient, type AgentStreamClientOptions, type AgentStreamState, type CreationEvent, type DoneEvent, type ErrorEvent, type ProgressEvent, type SubProgress, type ThinkingEvent, type TokenEvent, type ToolUseEvent, type TurnEvent, useAgentStream };
