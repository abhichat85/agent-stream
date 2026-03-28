import { useState } from "react";
// When published: import { useAgentStream } from "@agent-stream/react";
// For local dev: npm install ../../packages/react
import { useAgentStream } from "@agent-stream/react";

const styles = {
  container: { maxWidth: 700, margin: "40px auto", padding: "0 20px" },
  heading: { fontSize: 20, marginBottom: 20, color: "#a0c4ff" },
  form: { display: "flex", gap: 8, marginBottom: 16 },
  input: {
    flex: 1, padding: "8px 12px", background: "#1a1a1a", border: "1px solid #333",
    borderRadius: 6, color: "#e0e0e0", fontFamily: "monospace", fontSize: 14,
  },
  button: {
    padding: "8px 16px", background: "#4a90e2", border: "none",
    borderRadius: 6, color: "#fff", cursor: "pointer", fontFamily: "monospace",
  },
  stopButton: {
    padding: "8px 16px", background: "#e24a4a", border: "none",
    borderRadius: 6, color: "#fff", cursor: "pointer", fontFamily: "monospace",
  },
  status: { fontSize: 12, color: "#888", marginBottom: 8 },
  tools: { fontSize: 12, color: "#7ec8a0", marginBottom: 8 },
  progress: { fontSize: 12, color: "#c8a07e", marginBottom: 8 },
  output: {
    background: "#111", border: "1px solid #222", borderRadius: 6,
    padding: 16, minHeight: 200, whiteSpace: "pre-wrap" as const,
    fontSize: 14, lineHeight: 1.6,
  },
} as const;

export default function App() {
  const [input, setInput] = useState("");
  const { text, isStreaming, activeTools, progress, error, startStream, stop } =
    useAgentStream(); // no auth needed for this example

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    await startStream("/chat", { message: input });
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>agent-stream demo</h2>

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          style={styles.input}
          disabled={isStreaming}
        />
        {!isStreaming ? (
          <button type="submit" style={styles.button} disabled={!input.trim()}>
            Send
          </button>
        ) : (
          <button type="button" onClick={stop} style={styles.stopButton}>
            Stop
          </button>
        )}
      </form>

      {progress && (
        <div style={styles.progress}>
          ▶ {progress.message} ({progress.percentage}%)
        </div>
      )}

      {activeTools.length > 0 && (
        <div style={styles.tools}>
          ⚙ {activeTools.join(", ")}
        </div>
      )}

      {error && (
        <div style={{ ...styles.status, color: "#e24a4a" }}>
          Error: {error.message}
        </div>
      )}

      <pre style={styles.output}>
        {text || (isStreaming ? "" : "← Send a message to see the stream")}
        {isStreaming && "▌"}
      </pre>
    </div>
  );
}
