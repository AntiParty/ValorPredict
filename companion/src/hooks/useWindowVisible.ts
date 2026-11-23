import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

import { listen } from "@tauri-apps/api/event";

const WindowVisibleContext = createContext(true);

// True while the companion window is on screen; false once it's hidden to the
// tray. Refreshes and timers key off this so a backgrounded window does no work.
// The Rust side emits `app:visibility` on hide/show; the document's own visibility is
// a fallback (e.g. a plain Vite preview with no Tauri bridge).
function useWindowVisibleSource(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<boolean>("app:visibility", (event) => setVisible(event.payload))
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => undefined);

    const onDocVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onDocVisibility);

    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", onDocVisibility);
    };
  }, []);

  return visible;
}

/** Mount once near the root: one Tauri listener shared by every consumer. */
export function WindowVisibleProvider({ children }: { children: ReactNode }) {
  const visible = useWindowVisibleSource();
  // Plain .ts (no JSX) so this file keeps its original name on disk.
  return createElement(WindowVisibleContext.Provider, { value: visible }, children);
}

export function useWindowVisible(): boolean {
  return useContext(WindowVisibleContext);
}
