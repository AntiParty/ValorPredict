import { useEffect, useState } from "react";

import { listen } from "@tauri-apps/api/event";

// True while the companion window is on screen; false once it's hidden to the
// tray. Polling and animations key off this so a backgrounded window does no
// work. The Rust side emits `app:visibility` on hide/show; we also watch the
// document's own visibility as a fallback (e.g. a plain Vite preview with no
// Tauri bridge).
export function useWindowVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<boolean>("app:visibility", (event) => setVisible(event.payload))
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    const onDocVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onDocVisibility);

    return () => {
      unlisten?.();
      document.removeEventListener("visibilitychange", onDocVisibility);
    };
  }, []);

  return visible;
}
