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

import type { AgentStreamCallbacks, DoneEvent, ErrorEvent } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface AgentStreamClientOptions {
  /** Async function returning the Bearer token, or null if unauthenticated. */
  getToken?: () => Promise<string | null>;
  /** Base URL prepended to all endpoints. Defaults to "". */
  baseUrl?: string;
}

export class AgentStreamClient {
  private abort: AbortController | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: AgentStreamClientOptions;

  constructor(options: AgentStreamClientOptions = {}) {
    this.opts = options;
  }

  async start(
    endpoint: string,
    body: Record<string, unknown>,
    callbacks: AgentStreamCallbacks
  ): Promise<void> {
    this.stop();
    const controller = new AbortController();
    this.abort = controller;
    this.retryCount = 0;
    await this._attempt(endpoint, body, callbacks, controller);
  }

  stop(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.abort?.abort();
    this.abort = null;
  }

  private async _attempt(
    endpoint: string,
    body: Record<string, unknown>,
    cb: AgentStreamCallbacks,
    ctrl: AbortController
  ): Promise<void> {
    if (ctrl.signal.aborted) return;
    let receivedDone = false;

    try {
      const token = await this.opts.getToken?.() ?? null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${this.opts.baseUrl ?? ""}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        const error: ErrorEvent = {
          errorType: "http_error",
          message: (errData?.message as string) ?? `HTTP ${res.status}`,
          details: errData,
        };
        cb.onError?.(error);
        cb.onDone?.({ messageId: "", numTurns: 0, toolCount: 0, durationMs: 0, isError: true });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      this.retryCount = 0;

      const decoder = new TextDecoder();
      let buffer = "";
      // Persisted across chunk boundaries — SSE event type line may arrive
      // in a different fetch chunk than its data line.
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEventType) {
            try {
              const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
              if (this._dispatch(currentEventType, data, cb)) receivedDone = true;
            } catch { /* ignore parse errors on partial data */ }
            currentEventType = "";
          }
        }
      }

      // Safety net: if the connection dropped without a done event, emit synthetic done
      if (!receivedDone) {
        cb.onDone?.({ messageId: "", numTurns: 0, toolCount: 0, durationMs: 0, isError: false });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;

      if (this.retryCount < MAX_RETRIES && !ctrl.signal.aborted) {
        this.retryCount++;
        const delay = Math.pow(2, this.retryCount - 1) * RETRY_BASE_DELAY_MS;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this._attempt(endpoint, body, cb, ctrl);
        }, delay);
        return;
      }

      const error: ErrorEvent = {
        errorType: "network_error",
        message: err instanceof Error ? err.message : "Stream connection failed",
      };
      cb.onError?.(error);
    }
  }

  /** Returns true when a "done" event was dispatched. */
  private _dispatch(
    type: string,
    d: Record<string, unknown>,
    cb: AgentStreamCallbacks
  ): boolean {
    const str = (k1: string, k2: string, fallback = "") =>
      ((d[k1] ?? d[k2] ?? fallback) as string);
    const num = (k1: string, k2: string, fallback = 0) =>
      ((d[k1] ?? d[k2] ?? fallback) as number);
    const bool = (k1: string, k2: string, fallback = false) =>
      ((d[k1] ?? d[k2] ?? fallback) as boolean);

    switch (type) {
      case "token":
        cb.onToken?.(d.text as string);
        break;
      case "thinking":
        cb.onThinking?.({ text: d.text as string });
        break;
      case "tool_use":
        cb.onToolUse?.({
          toolName: str("tool_name", "toolName"),
          toolUseId: str("tool_use_id", "toolUseId"),
          status: (str("status", "status", "running")) as "running",
          inputSummary: str("input_summary", "inputSummary"),
        });
        break;
      case "tool_result":
        cb.onToolUse?.({
          toolName: str("tool_name", "toolName"),
          toolUseId: str("tool_use_id", "toolUseId"),
          status: (str("status", "status", "done")) as "done" | "error",
          outputSummary: str("output_summary", "outputSummary"),
          durationMs: num("duration_ms", "durationMs"),
        });
        break;
      case "turn":
        cb.onTurn?.({
          turnNumber: num("turn_number", "turnNumber"),
          totalTools: num("total_tools", "totalTools"),
        });
        break;
      case "progress":
        cb.onProgress?.({
          step: d.step as string,
          percentage: d.percentage as number,
          message: d.message as string,
          subProgress: (d.sub_progress ?? d.subProgress ?? null) as any,
        });
        break;
      case "creation":
        cb.onCreation?.({
          creationType: str("creation_type", "creationType"),
          count: num("count", "count"),
          toolUseId: str("tool_use_id", "toolUseId"),
          items: (d.items ?? []) as unknown[],
        });
        break;
      case "error":
        cb.onError?.({
          errorType: str("error_type", "errorType"),
          message: d.message as string,
          details: d.details as Record<string, unknown>,
        });
        break;
      case "done":
        cb.onDone?.({
          messageId: str("message_id", "messageId"),
          numTurns: num("num_turns", "numTurns"),
          toolCount: num("tool_count", "toolCount"),
          durationMs: num("duration_ms", "durationMs"),
          isError: bool("is_error", "isError"),
          model: str("model", "model"),
          totalCostUsd: d.total_cost_usd as number | undefined,
        });
        return true;
    }
    return false;
  }
}
