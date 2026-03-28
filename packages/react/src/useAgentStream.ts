import { useState, useCallback, useRef } from "react";
import { AgentStreamClient, type AgentStreamClientOptions } from "./client.js";
import type { AgentStreamCallbacks, AgentStreamState } from "./types.js";

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
export function useAgentStream(options: AgentStreamClientOptions = {}) {
  const clientRef = useRef(new AgentStreamClient(options));

  const [state, setState] = useState<AgentStreamState>({
    isStreaming: false,
    text: "",
    progress: null,
    activeTools: [],
    error: null,
    isDone: false,
  });

  const reset = useCallback(() => {
    setState({ isStreaming: false, text: "", progress: null, activeTools: [], error: null, isDone: false });
  }, []);

  const stop = useCallback(() => {
    clientRef.current.stop();
    setState((prev) => ({ ...prev, isStreaming: false }));
  }, []);

  const startStream = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    callbacks?: AgentStreamCallbacks
  ) => {
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
      },
    });
  }, []);

  return { ...state, startStream, stop, reset };
}
