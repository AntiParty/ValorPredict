import type { LogEntry } from "../types";

interface Props {
  logs: LogEntry[];
  onClear: () => Promise<void>;
}

export function LogPanel({ logs, onClear }: Props) {
  return (
    <section className="panel log-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Sanitized output</span>
          <h2>Debug Log</h2>
        </div>
        <button className="text-button" onClick={onClear}>
          Clear Log
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
