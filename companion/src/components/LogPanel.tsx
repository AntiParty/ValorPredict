import type { LogEntry } from "../types";

interface Props {
  logs: LogEntry[];
  onClear: () => void;
}

export function LogPanel({ logs, onClear }: Props) {
  return (
    <section className="log-panel">
      <div className="panel-heading">
        <h3>Debug log</h3>
        <button type="button" className="button ghost" onClick={onClear}>
          Clear logs
        </button>
      </div>
      <div className="log-rows">
        {logs.length === 0 ? (
          <p className="empty-log">No local events yet.</p>
        ) : (
          [...logs].reverse().map((entry, index) => (
            <div className="log-row" key={`${entry.timestamp}-${index}`}>
              <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
              <span className={`log-level ${entry.level}`}>{entry.level}</span>
              <p>{entry.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
