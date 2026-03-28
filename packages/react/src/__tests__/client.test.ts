import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentStreamClient } from "../client";

// Minimal SSE stream helper
function makeStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const ev of events) controller.enqueue(encoder.encode(ev));
      controller.close();
    },
  });
}

function mockFetch(events: string[], status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    body: makeStream(events),
    json: async () => ({ message: `HTTP ${status}` }),
  });
}

afterEach(() => vi.restoreAllMocks());

describe("AgentStreamClient", () => {
  it("calls onToken for each token event", async () => {
    mockFetch([
      "event: token\ndata: {\"text\":\"Hello\"}\n\n",
      "event: done\ndata: {\"message_id\":\"m1\",\"num_turns\":1,\"tool_count\":0,\"duration_ms\":100,\"is_error\":false}\n\n",
    ]);
    const client = new AgentStreamClient();
    const tokens: string[] = [];
    await client.start("/api/chat", {}, { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(["Hello"]);
  });

  it("calls onDone after done event", async () => {
    mockFetch([
      "event: done\ndata: {\"message_id\":\"m1\",\"num_turns\":2,\"tool_count\":3,\"duration_ms\":500,\"is_error\":false}\n\n",
    ]);
    const client = new AgentStreamClient();
    let done: any;
    await client.start("/api/chat", {}, { onDone: (e) => (done = e) });
    expect(done.numTurns).toBe(2);
    expect(done.toolCount).toBe(3);
  });

  it("calls onError on HTTP 4xx and triggers synthetic done", async () => {
    mockFetch([], 401);
    const client = new AgentStreamClient();
    let error: any;
    let doneCalled = false;
    await client.start("/api/chat", {}, {
      onError: (e) => (error = e),
      onDone: () => (doneCalled = true),
    });
    expect(error.errorType).toBe("http_error");
    expect(doneCalled).toBe(true);
  });

  it("handles events split across chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: tok",
      "en\ndata: {\"text\":\"split\"}\n\n",
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":0,\"tool_count\":0,\"duration_ms\":0,\"is_error\":false}\n\n",
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      json: async () => ({}),
    });
    const client = new AgentStreamClient();
    const tokens: string[] = [];
    await client.start("/api/chat", {}, { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(["split"]);
  });

  it("persists currentEventType when event: line and data: line are in separate chunks", async () => {
    const encoder = new TextEncoder();
    // Chunk 1: complete "event: token\n" — but NO data line yet
    // Chunk 2: "data: {...}\n\n" — currentEventType must still be "token" here
    const chunks = [
      "event: token\n",
      "data: {\"text\":\"persisted\"}\n\n",
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":0,\"tool_count\":0,\"duration_ms\":0,\"is_error\":false}\n\n",
    ];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      json: async () => ({}),
    });
    const client = new AgentStreamClient();
    const tokens: string[] = [];
    await client.start("/api/chat", {}, { onToken: (t) => tokens.push(t) });
    expect(tokens).toEqual(["persisted"]);
  });

  it("emits synthetic done when stream ends without done event", async () => {
    mockFetch(["event: token\ndata: {\"text\":\"hi\"}\n\n"]);
    const client = new AgentStreamClient();
    let doneCalled = false;
    await client.start("/api/chat", {}, { onDone: () => (doneCalled = true) });
    expect(doneCalled).toBe(true);
  });

  it("passes Authorization header when getToken returns a value", async () => {
    mockFetch([
      "event: done\ndata: {\"message_id\":\"\",\"num_turns\":0,\"tool_count\":0,\"duration_ms\":0,\"is_error\":false}\n\n",
    ]);
    const client = new AgentStreamClient({ getToken: async () => "tok_abc" });
    await client.start("/api/chat", {}, {});
    const call = (global.fetch as any).mock.calls[0];
    expect(call[1].headers["Authorization"]).toBe("Bearer tok_abc");
  });
});
