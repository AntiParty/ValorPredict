import type { ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { Brand } from "./predictions/Brand";

// The window is undecorated (tauri.conf.json), so this bar is the title bar: the empty
// area drags the window, and the two buttons replace the native minimize and close.
// Closing goes through the normal close request, which Rust turns into "close to tray".
export function Titlebar({ children }: { children?: ReactNode }) {
  const call = (action: "minimize" | "close") => {
    getCurrentWindow()[action]().catch(() => undefined);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <Brand />
      <div className="titlebar__spacer" data-tauri-drag-region />
      {children && <div className="titlebar__extra">{children}</div>}
      <div className="window-controls">
        <button
          type="button"
          className="window-control"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => call("minimize")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="window-control window-control--close"
          aria-label="Close to tray"
          title="Close to tray"
          onClick={() => call("close")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// Every screen sits in the same frame: a fixed title bar and a scrolling body below it.
export function AppFrame({
  titlebar,
  children,
  center = false,
}: {
  titlebar?: ReactNode;
  children: ReactNode;
  center?: boolean;
}) {
  return (
    <div className="app-frame">
      <Titlebar>{titlebar}</Titlebar>
      <div className="app-body">
        <main className={`companion-shell${center ? " is-centered" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
