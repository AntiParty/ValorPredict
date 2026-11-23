import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles.css";

async function start() {
  // A plain browser in dev has no Tauri bridge: stand in a mock backend so the UI renders.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMockBackend } = await import("./preview/mockBackend");
    installMockBackend();
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
