import { useCallback, useEffect, useState } from "react";

import { companionApi } from "../api";
import { useBackendEvent } from "../hooks/useBackendEvent";
import { useNotice } from "../hooks/useNotice";
import { useWindowVisible } from "../hooks/useWindowVisible";
import type { DetectionMetrics, DetectionStatus, LogEntry } from "../types";
import { LogPanel } from "./LogPanel";
import { Notice } from "./Notice";
import { StatusGrid } from "./StatusGrid";

/** Metrics are counters over the last minute; there is no event for them. */
export const METRICS_REFRESH_MS = 5000;

interface Props {
  status: DetectionStatus | null;
  onStatus: (status: DetectionStatus) => void;
}

// Developer panel (rendered only in dev builds). Nothing is fetched until it is opened:
// logs come from `get_logs` and then follow `logs-changed`, metrics refresh every 5 s,
// and both stop again when the panel is closed.
export function Diagnostics({ status, onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [metrics, setMetrics] = useState<DetectionMetrics | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = useWindowVisible();
  const { notice, showError, clear } = useNotice();
  const active = open && visible;

  const loadLogs = useCallback(async () => {
    try {
      setLogs(await companionApi.getLogs());
    } catch {
      // No Tauri bridge in a plain Vite preview.
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      setMetrics(await companionApi.getDetectionMetrics());
    } catch {
      // Same as above.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadLogs();
    void loadMetrics();
    const timer = window.setInterval(() => void loadMetrics(), METRICS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, loadLogs, loadMetrics]);

  useBackendEvent<null>("logs-changed", () => void loadLogs(), active);

  async function run(operation: () => Promise<DetectionStatus>) {
    setBusy(true);
    clear();
    try {
      onStatus(await operation());
    } catch (error) {
      showError(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="diagnostics-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Diagnostics</summary>
      {open && status && (
        <div className="diagnostics-body">
          <p className="muted-line">Raw detection signals and sanitized runtime logs.</p>
          <StatusGrid status={status} metrics={metrics} />
          <div className="diagnostics-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void run(status.monitoring ? companionApi.stopMonitoring : companionApi.startMonitoring)
              }
            >
              {status.monitoring ? "Stop monitoring" : "Start monitoring"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void run(companionApi.resetCooldown)}
            >
              Reset cooldown
            </button>
          </div>
          <Notice notice={notice} />
          <LogPanel logs={logs} onClear={() => void run(companionApi.clearLogs)} />
        </div>
      )}
    </details>
  );
}
