"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AgentStreamClient: () => AgentStreamClient,
  useAgentStream: () => useAgentStream
});
module.exports = __toCommonJS(index_exports);

// src/client.ts
var MAX_RETRIES = 3;
var RETRY_BASE_DELAY_MS = 1e3;
var AgentStreamClient = class {
  abort = null;
  retryCount = 0;
  retryTimer = null;
  opts;
  constructor(options = {}) {
    this.opts = options;
  }
  async start(endpoint, body, callbacks) {
    this.stop();
    const controller = new AbortController();
    this.abort = controller;
    this.retryCount = 0;
    await this._attempt(endpoint, body, callbacks, controller);
  }
  stop() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.abort?.abort();
    this.abort = null;
  }
  async _attempt(endpoint, body, cb, ctrl) {
    if (ctrl.signal.aborted) return;
    let receivedDone = false;
    try {
      const token = await this.opts.getToken?.() ?? null;
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${this.opts.baseUrl ?? ""}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const error = {
          errorType: "http_error",
          message: errData?.message ?? `HTTP ${res.status}`,
          details: errData
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
              const data = JSON.parse(line.slice(6));
              if (this._dispatch(currentEventType, data, cb)) receivedDone = true;
            } catch {
            }
            currentEventType = "";
          }
        }
      }
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
      const error = {
        errorType: "network_error",
        message: err instanceof Error ? err.message : "Stream connection failed"
      };
      cb.onError?.(error);
    }
  }
  /** Returns true when a "done" event was dispatched. */
  _dispatch(type, d, cb) {
    const str = (k1, k2, fallback = "") => d[k1] ?? d[k2] ?? fallback;
    const num = (k1, k2, fallback = 0) => d[k1] ?? d[k2] ?? fallback;
    const bool = (k1, k2, fallback = false) => d[k1] ?? d[k2] ?? fallback;
    switch (type) {
      case "token":
        cb.onToken?.(d.text);
        break;
      case "thinking":
        cb.onThinking?.({ text: d.text });
        break;
      case "tool_use":
        cb.onToolUse?.({
          toolName: str("tool_name", "toolName"),
          toolUseId: str("tool_use_id", "toolUseId"),
          status: str("status", "status", "running"),
          inputSummary: str("input_summary", "inputSummary")
        });
        break;
      case "tool_result":
        cb.onToolUse?.({
          toolName: str("tool_name", "toolName"),
          toolUseId: str("tool_use_id", "toolUseId"),
          status: str("status", "status", "done"),
          outputSummary: str("output_summary", "outputSummary"),
          durationMs: num("duration_ms", "durationMs")
        });
        break;
      case "turn":
        cb.onTurn?.({
          turnNumber: num("turn_number", "turnNumber"),
          totalTools: num("total_tools", "totalTools")
        });
        break;
      case "progress":
        cb.onProgress?.({
          step: d.step,
          percentage: d.percentage,
          message: d.message,
          subProgress: d.sub_progress ?? d.subProgress ?? null
        });
        break;
      case "creation":
        cb.onCreation?.({
          creationType: str("creation_type", "creationType"),
          count: num("count", "count"),
          toolUseId: str("tool_use_id", "toolUseId"),
          items: d.items ?? []
        });
        break;
      case "error":
        cb.onError?.({
          errorType: str("error_type", "errorType"),
          message: d.message,
          details: d.details
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
          totalCostUsd: d.total_cost_usd
        });
        return true;
    }
    return false;
  }
};

// src/useAgentStream.ts
var import_react = require("react");
function useAgentStream(options = {}) {
  const clientRef = (0, import_react.useRef)(new AgentStreamClient(options));
  const [state, setState] = (0, import_react.useState)({
    isStreaming: false,
    text: "",
    progress: null,
    activeTools: [],
    error: null,
    isDone: false
  });
  const reset = (0, import_react.useCallback)(() => {
    setState({ isStreaming: false, text: "", progress: null, activeTools: [], error: null, isDone: false });
  }, []);
  const stop = (0, import_react.useCallback)(() => {
    clientRef.current.stop();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);
  const startStream = (0, import_react.useCallback)(async (endpoint, body, callbacks) => {
    setState({ isStreaming: true, text: "", progress: null, activeTools: [], error: null, isDone: false });
    await clientRef.current.start(endpoint, body, {
      onToken: (text) => {
        setState((prev) => ({ ...prev, text: prev.text + text }));
        callbacks?.onToken?.(text);
      },
      onThinking: (e) => callbacks?.onThinking?.(e),
      onToolUse: (e) => {
        if (e.status === "running") {
          setState((prev) => ({ ...prev, activeTools: [...prev.activeTools, e.toolName] }));
        }
        callbacks?.onToolUse?.(e);
      },
      onTurn: (e) => callbacks?.onTurn?.(e),
      onProgress: (e) => {
        setState((prev) => ({ ...prev, progress: e }));
        callbacks?.onProgress?.(e);
      },
      onCreation: (e) => callbacks?.onCreation?.(e),
      onError: (e) => {
        setState((prev) => ({ ...prev, isStreaming: false, error: e }));
        callbacks?.onError?.(e);
      },
      onDone: (e) => {
        setState((prev) => ({ ...prev, isStreaming: false, isDone: true }));
        callbacks?.onDone?.(e);
      }
    });
  }, []);
  return { ...state, startStream, stop, reset };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentStreamClient,
  useAgentStream
});
