import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";

// Subscribes to a Rust -> UI event for as long as the component is mounted. The latest
// `handler` is always called, so callers don't need to memoise it. Pass `enabled=false`
// to detach (for example while a collapsed panel is closed).
export function useBackendEvent<T>(
  name: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<T>(name, (event) => latest.current(event.payload))
      .then((dispose) => {
        // The component may have unmounted while the subscription was being set up.
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => undefined); // No Tauri bridge in a plain Vite preview.

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name, enabled]);
}
