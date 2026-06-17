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

Run the backend and the SPA dev server together:

```bash
# terminal 1 — Express API on :3000
npm run dev

# terminal 2 — Vite dev server on :5173 (proxies /api, /auth, /duo to :3000)
npm run dev --prefix web
```

Open http://localhost:5173. The Vite proxy makes the app look same-origin to the
browser so the SameSite=lax session cookie is sent with API calls. Point the
proxy elsewhere with `VITE_API_TARGET`.

## Production

```bash
npm run build --prefix web   # emits web/dist
npm run build                # compiles the backend to dist/
npm start                    # Express serves web/dist same-origin
```

Express serves `web/dist` statically and falls back to `index.html` for client
routes; `/api`, `/auth`, and `/duo` stay server-handled.

## Tests

```bash
npm test --prefix web   # vitest (jsdom + React Testing Library)
```
