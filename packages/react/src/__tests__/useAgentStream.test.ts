import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "../useAgentStream";

function mockFetch(events: string[], status = 200) {
  const encoder = new TextEncoder();
  global.fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const ev of events) controller.enqueue(encoder.encode(ev));
        controller.close();
      },
    }),
    json: async () => ({ message: `HTTP ${status}` }),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("useAgentStream", () => {
  it("initialises with isStreaming=false", () => {
    const { result } = renderHook(() => useAgentStream());
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.text).toBe("");
  });

  it("sets isStreaming=true while running then false on done", async () => {
    mockFetch([
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":1,\"tool_count\":0,\"duration_ms\":10,\"is_error\":false}\n\n",
    ]);
    const { result } = renderHook(() => useAgentStream());
    await act(async () => {
      await result.current.startStream("/api/chat", {});
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isDone).toBe(true);
  });

  it("accumulates text from token events", async () => {
    mockFetch([
      "event: token\ndata: {\"text\":\"Hello\"}\n\n",
      "event: token\ndata: {\"text\":\" world\"}\n\n",
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":1,\"tool_count\":0,\"duration_ms\":10,\"is_error\":false}\n\n",
    ]);
    const { result } = renderHook(() => useAgentStream());
    await act(async () => {
      await result.current.startStream("/api/chat", {});
    });
    expect(result.current.text).toBe("Hello world");
  });

  it("adds tool name to activeTools on tool_use", async () => {
    mockFetch([
      "event: tool_use\ndata: {\"tool_name\":\"search\",\"tool_use_id\":\"t1\",\"status\":\"running\"}\n\n",
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":1,\"tool_count\":1,\"duration_ms\":10,\"is_error\":false}\n\n",
    ]);
    const { result } = renderHook(() => useAgentStream());
    await act(async () => {
      await result.current.startStream("/api/chat", {});
    });
    expect(result.current.activeTools).toContain("search");
  });

  it("reset() clears state", async () => {
    mockFetch([
      "event: token\ndata: {\"text\":\"hi\"}\n\n",
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":1,\"tool_count\":0,\"duration_ms\":10,\"is_error\":false}\n\n",
    ]);
    const { result } = renderHook(() => useAgentStream());
    await act(async () => { await result.current.startStream("/api/chat", {}); });
    expect(result.current.text).toBe("hi");
    act(() => { result.current.reset(); });
    expect(result.current.text).toBe("");
    expect(result.current.isDone).toBe(false);
  });
});
