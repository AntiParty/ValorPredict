/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3000";

// The SPA runs on its own dev server but must look same-origin to the browser
// so the SameSite=lax session cookie is sent. The proxy forwards the API,
// OAuth, and the public duo endpoint to the Express backend.
const proxy = {
  "/api": { target: API_TARGET, changeOrigin: true },
  "/auth": { target: API_TARGET, changeOrigin: true },
  "/duo": { target: API_TARGET, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    css: false,
  },
});
