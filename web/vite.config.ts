/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The web app is served by the backend Express process: in development via Vite
// middleware (see ../src/dev-server.ts), in production from the built dist/. The
// API, auth, and duo routes are handled by Express directly, so no dev proxy is
// needed here.
export default defineConfig({
  plugins: [react()],
  // No source maps in the production bundle so the original source can't be
  // reconstructed from the browser.
  build: { sourcemap: false },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    css: false,
  },
});
