# Valorant Auto Predictions — Web

The React 19 single-page app for the marketing landing page and the streamer
dashboard. It talks to the Express backend purely over the JSON API (`/api/*`)
and reuses the existing Twitch OAuth session cookie for auth.

## Architecture

- **Vite + React 19** SPA. `react-router-dom` for routing, `@tanstack/react-query`
  for server state, plain `fetch` (see `src/lib/api.ts`) for the API client.
- **Secure routes**: `AuthProvider` reads `/api/me`; `ProtectedRoute` guards
  `/dashboard` on the client, and every mutating API enforces auth + a
  `X-Requested-With` header server-side (CSRF defense on top of SameSite=lax).
- **Components** live under `src/components` (landing sections + dashboard cards),
  pages under `src/pages`, auth under `src/auth`.

## Development

This package is **not run on its own** — the backend serves it. From the repo
root, `npm run dev` starts one Express process that runs Vite in middleware mode,
so the SPA gets hot reload and the API is same-origin on a single port:

```bash
# repo root
npm run dev          # Express + Vite on http://localhost:3000
```

See [`../src/dev-server.ts`](../src/dev-server.ts) for the integration and the
root [README](../README.md) for the full workflow.

## Production

`npm run build` at the repo root builds this SPA and folds it into the server's
`dist/public`, so a single `dist/` serves the app. You can build just the web
bundle with `npm run build:web` (emits `web/dist`).

## Tests

```bash
npm test --prefix web   # vitest (jsdom + React Testing Library)
```
