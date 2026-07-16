import { useEffect } from "react";

export function useVisiblePolling(
  refresh: () => Promise<void>,
  intervalMs: number,
  visible: boolean,
): void {
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let timer: number | undefined;

    const poll = () => {
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) timer = window.setTimeout(poll, intervalMs);
        });
    };

    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [intervalMs, refresh, visible]);
}
