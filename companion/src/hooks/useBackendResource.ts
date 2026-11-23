import { useCallback, useEffect, useRef, useState } from "react";

import { useBackendEvent } from "./useBackendEvent";
import { useVisiblePolling } from "./useVisiblePolling";

/** One slow refresh in case a backend event is ever missed. */
export const SAFETY_REFRESH_MS = 60_000;

// Backend data that is pushed, not polled: fetched on mount, again whenever Rust emits
// `eventName`, when the window is revealed, and once every 60 s while visible as a
// safety net. An event with a payload is applied directly (no extra round trip); an
// event with a null payload means "something changed, re-read it".
export function useBackendResource<T>(
  fetcher: () => Promise<T>,
  eventName: string,
  visible: boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write state, so a slow older reply can't overwrite it.
  const latestRequest = useRef(0);
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  });

  const apply = useCallback((next: T) => {
    latestRequest.current += 1;
    setData(next);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const next = await fetcher();
      if (request !== latestRequest.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (request === latestRequest.current) setError(String(caught));
    }
  }, [fetcher]);

  useVisiblePolling(refresh, SAFETY_REFRESH_MS, visible);

  useBackendEvent<T | null>(eventName, (payload) => {
    // A hidden window catches up on reveal instead of re-rendering in the tray.
    if (!visibleRef.current) return;
    if (payload === null || payload === undefined) void refresh();
    else apply(payload);
  });

  return { data, error, refresh, apply };
}
