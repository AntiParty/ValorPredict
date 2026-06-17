# Valorant Auto Predictions

Automatically create Twitch Channel Points Predictions when a supported Valorant
match starts. Competitive and Custom each have one independent preset;
unsupported or unknown modes are ignored.

This repository is a small monorepo with three parts:

| Part | Path | What it is |
| --- | --- | --- |
| **Backend API** | [`src/`](src/) | Express 5 + TypeScript JSON API, Twitch OAuth, SQLite persistence. Serves the built SPA in production. |
| **Web app** | [`web/`](web/README.md) | React 19 + Vite single-page app (landing page + streamer dashboard). Talks to the backend over the JSON API. |
| **Companion** | [`companion/`](companion/README.md) | Windows Tauri desktop app. Simulation controls plus an optional read-only Riot match detector. |

## Architecture

- The **web app** is a pure SPA. It reads/writes the backend's `/api/*` JSON
  endpoints with `fetch` and reuses the Twitch OAuth **session cookie** for
  auth. Client routes are guarded by `ProtectedRoute`, and every mutating API
  enforces auth server-side plus an `X-Requested-With` header (CSRF defense on
  top of `SameSite=lax`).
- The **backend** owns Twitch OAuth, prediction lifecycle, and persistence. In
  production it also serves the built SPA (`web/dist`) same-origin, falling back
  to `index.html` for client routes. `/api`, `/auth`, and the public `/duo/:token`
  chatbot endpoint stay server-handled.
- The **companion** authenticates separately to `/api/local/*` with a hashed
  `vap_` Bearer key. It never receives the streamer's Twitch tokens.

```text
src/                Backend (Express JSON API)
  app.ts            App composition: session, routers, SPA serving
  auth.ts           Twitch OAuth routes and session login
  config.ts         Environment validation and bounds
  db.ts             SQLite schema and persistence
  index.ts          Runtime entry point
  local-api.ts      Companion Bearer-key API (/api/local/*)
  predictions.ts    Prediction lifecycle + match-start entry point
  session-helpers.ts Shared session/user/flash helpers
  twitch.ts         Twitch OAuth and Helix client
  types.ts          Shared backend data types
  web-api.ts        JSON API router (/api/*) consumed by the SPA
web/                React SPA (see web/README.md)
  src/
    auth/           AuthProvider + ProtectedRoute (secure routes)
    components/     Brand, Toast, landing sections, dashboard cards
    hooks/          useReveal, useDashboardMutation
    lib/            Typed API client + formatting helpers
    pages/          Landing, Dashboard
    App.tsx         Router + QueryClient + providers
companion/          Windows Tauri desktop app
test/               Backend tests (node:test + supertest)
data/               Local SQLite database (gitignored)
```

## Prerequisites

- **Node.js 20.19+** (Vite 8 / React 19).
- A Twitch account eligible for Channel Points Predictions.

## Twitch developer app setup

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Choose **Register Your Application**.
3. Name it, e.g. `Valorant Auto Predictions Local`.
4. Add this OAuth redirect URL exactly:

   ```text
   http://localhost:3000/auth/twitch/callback
   ```

5. Pick a category and create the app.
6. Open **Manage**, copy the Client ID, and generate a Client Secret.

The app requests these user scopes: `channel:manage:predictions` and
`channel:read:predictions`.

## Configure

Copy `.env.example` to `.env` and fill in the Twitch credentials:

```dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
SESSION_SECRET=replace_with_a_long_random_value
DATABASE_PATH=./data/valorant-auto-predictions.sqlite
PORT=3000
```

Generate a long random `SESSION_SECRET`. In PowerShell:

```powershell
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

## Develop

Install dependencies for both packages, then run the API and the SPA dev server
together:

```bash
npm install                 # backend deps
npm install --prefix web    # web deps
npm run dev:all             # API on :3000 + Vite SPA on :5173
```

Open **http://localhost:5173**. The Vite dev server has hot reload and proxies
`/api`, `/auth`, and `/duo` to the backend on `:3000`, so the app looks
same-origin and the session cookie works.

Prefer separate terminals? Run `npm run dev` (API) and `npm run dev:web` (SPA)
in two windows.

> Hitting `:3000` directly serves the **built** SPA from `web/dist`, not your
> live edits. Use `:5173` while developing, or rebuild with `npm run build:web`.

## Build and run (production)

```bash
npm run build:all           # builds web/dist, then compiles the backend
$env:NODE_ENV = "production" # PowerShell; use `export` on bash
npm start                   # Express serves the SPA + API on :3000
```

In production, simulation routes and `/api/debug` are not registered.

## Testing

```bash
npm test            # backend: node:test + supertest (in-memory SQLite, fake Twitch)
npm run build       # backend typecheck
npm run test:web    # web: vitest + React Testing Library
```

Tests need no real Twitch credentials.

## Local companion API

After connecting Twitch, use the **Local Companion App** card on the dashboard:

1. Click **Generate Local API Key**.
2. Copy the key while it is visible — it is shown only once.
3. Paste it into the desktop companion.

The key starts with `vap_`; only its SHA-256 hash is stored. Regenerating
immediately invalidates the previous key.

**Validate a key and identify the streamer:**

```bash
curl http://localhost:3000/api/local/ping \
  -H "Authorization: Bearer vap_your_key"
```

**Signal a match start:**

```bash
curl -X POST http://localhost:3000/api/local/valorant-match-start \
  -H "Authorization: Bearer vap_your_key" \
  -H "Content-Type: application/json" \
  -d '{"gameMode":"competitive"}'
```

The `action` field is `prediction_created` (Twitch accepted a new prediction),
`ignored` (no enabled preset for the mode, or a prediction is already active),
or `error`. Missing or invalid keys receive HTTP `401`.

The backend also accepts sanitized state updates at
`POST /api/local/valorant-state`; only `current_game` with an enabled
`competitive`/`custom` preset opens a prediction.

## Notes

- **Public showcase**: streamer names and avatars appear in the landing-page
  rail only when the streamer enables **Feature my channel publicly**. Accounts
  are private by default.
- **Landing metrics** reflect real local database totals (connected streamers,
  predictions created, Channel Points wagered).
- **Launch offer**: the page presents a planned Creator plan at **$9/month** with
  a **7-day free trial**. Checkout and billing are not implemented in this
  proof of concept.
- **Match detection**: the simulation and companion endpoints both call
  `handleValorantMatchStart(...)`. Future OCR/detection logic belongs in the
  companion or another detector — no Twitch logic needs to move into it.
