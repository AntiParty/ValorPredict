# ValorPredict auth service

A small, **stateless** Vercel project that lets streamers connect Twitch to
ValorPredict without registering their own Twitch application.

ValorPredict registers **one** Twitch application. Its Client Secret lives here, in
Vercel environment variables, and is used for exactly two things: trading a
sign-in `code` for tokens, and refreshing tokens. Everything else (creating and
resolving predictions) goes straight from the desktop app to Twitch.

This service has **no database and stores nothing**. Tokens exist in memory only
while a request is being handled, and are never logged.

## How it works

```text
App                       Browser                    This service                  Twitch
 │ Connect Twitch            │                            │                            │
 │── open /api/login ───────▶│── GET /api/login ─────────▶│ signed state cookie        │
 │                           │◀─ 302 to Twitch authorize ─│                            │
 │                           │──────────── user approves ────────────────────────────▶│
 │                           │◀──────────── 302 /api/callback?code&state ─────────────│
 │                           │── GET /api/callback ──────▶│ check state cookie         │
 │                           │                            │── POST /oauth2/token ─────▶│  (uses the secret)
 │                           │                            │◀─ access + refresh token ──│
 │                           │◀─ page: masked code + Copy ┤ seal tokens → vp1_… (10 min)
 │  user clicks Copy         │                            │
 │── POST /api/redeem ───────────────────────────────────▶│ open vp1_…
 │◀───────────────────────────────────────────── tokens ──│
 │  …a few hours later…      │                            │
 │── POST /api/refresh ──────────────────────────────────▶│── POST /oauth2/token ─────▶│  (uses the secret)
 │◀───────────────────────────────────────────── tokens ──│◀───────────────────────────│
```

### The connection code

After Twitch approves, the browser shows a page with a **masked** code
(`vp1_••••••••••••`) and a **Copy connection code** button. The code is never
displayed as text and never put in a URL.

What gets copied is the Twitch tokens encrypted with AES-256-GCM using
`CODE_SEAL_KEY`, which only this service has. So:

- it means nothing to anyone who finds it in clipboard history, a screenshot, or a
  message the user pasted by mistake;
- it stops working **10 minutes** after it was issued;
- it is **not** strictly single-use, because the service keeps no state. The
  10-minute window is the protection. (Making it single-use would need a small
  store such as Upstash Redis.)

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/login` | GET | Sets a signed state cookie and redirects to Twitch's approval screen. |
| `/api/callback` | GET | Twitch redirects here. Checks the state cookie, exchanges the code, renders the masked copy page. |
| `/api/redeem` | POST | `{ "code": "vp1_…" }` → `{ access_token, refresh_token, expires_in }` |
| `/api/refresh` | POST | `{ "refresh_token": "…" }` → `{ access_token, refresh_token, expires_in }` |

There are no CORS headers: only the desktop app calls the POST routes, never a
web page. Every response is `Cache-Control: no-store`.

### What the app should expect

`/api/redeem` and `/api/refresh` need a `Content-Type: application/json` body of at
most 2 KB and a `User-Agent` starting with `ValorPredict/` (for example
`ValorPredict/0.2.0`). The User-Agent check only filters out random noise; it is
not authentication.

| Status | Body | Meaning | App should |
| --- | --- | --- | --- |
| 200 | `{ access_token, refresh_token, expires_in }` | Success. Always save the **new** refresh token. | Store tokens |
| 400 | `{ "error": "invalid" }` | Code malformed or tampered with, or bad input | Ask the user to try again |
| 410 | `{ "error": "expired" }` | (redeem) code older than 10 minutes | "That code expired, click Connect Twitch again" |
| 401 | `{ "error": "reauth" }` | (refresh) Twitch refused the refresh token: revoked or expired | Show "Reconnect Twitch" |
| 502 | `{ "error": "upstream" }` | (refresh) Twitch or the network failed | Retry later; keep the current tokens |
| 403 | `{ "error": "forbidden" }` | Missing `ValorPredict/` User-Agent | Fix the client |
| 413 / 415 | `{ "error": "too_large" \| "unsupported_media_type" }` | Bad body | Fix the client |
| 500 | `{ "error": "server_misconfigured" }` | Environment variables missing or wrong | Tell the developer |

`expires_in` from `/api/redeem` is the lifetime **remaining** on the access token
(up to 10 minutes less than Twitch originally granted), so it is safe to schedule
a refresh from it directly.

## Deploying

### 1. Register the Twitch application

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and choose **Register Your Application**.
2. **Client Type: Confidential** (only confidential apps get a Client Secret).
3. **OAuth Redirect URLs**: add both
   - `https://<your-deployment-host>/api/callback`
   - `http://localhost:3001/api/callback` (only needed for `npm run dev:local`, see [Local testing](#local-testing))
4. Create it, then copy the **Client ID** and generate a **Client Secret**.

### 2. Create the Vercel project

1. Import the repository in Vercel and set **Root Directory** to `auth`. Framework preset: **Other**. No build command is needed.
2. Add these environment variables (Production, and Preview if you want it), marking the three secrets as **Sensitive**:

   | Name | Value |
   | --- | --- |
   | `TWITCH_CLIENT_ID` | from the Twitch console |
   | `TWITCH_CLIENT_SECRET` | from the Twitch console (Sensitive) |
   | `PUBLIC_BASE_URL` | the deployment's public origin, e.g. `https://auth.example.com`. No trailing slash or path. It must match the redirect URL registered with Twitch. |
   | `CODE_SEAL_KEY` | 32 random bytes, base64 (Sensitive). `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `STATE_SIGNING_KEY` | a **different** 32 random bytes, base64 (Sensitive) |

3. Deploy. If you add a custom domain, use that origin for `PUBLIC_BASE_URL` and in the Twitch redirect list, then redeploy.

### 3. Add a rate limit

In the Vercel dashboard, open the project's **Firewall** and add a rate-limiting
rule for `/api/*` (for example 30 requests per minute per IP). `/api/redeem` and
`/api/refresh` can't do anything useful without a valid code or refresh token, so
this is about keeping noise and cost down, not about protecting the secret.

### 4. Check it works

Open `https://<your-deployment-host>/api/login` in a browser. You should reach
Twitch's approval screen, then a page with a masked code and a Copy button. To
check the POST routes after copying a code:

```bash
curl -s https://<your-deployment-host>/api/redeem \
  -H 'Content-Type: application/json' -H 'User-Agent: ValorPredict/dev' \
  -d '{"code":"<paste the code>"}'
```

## Local testing

Three levels, from quickest to most realistic. Run everything from the `auth/`
folder after `npm install`.

### 1. Unit tests (no accounts, no network)

```bash
npm test
npm run typecheck
```

### 2. The whole flow with a simulated Twitch (no accounts)

```bash
npm run dev:fake
```

Open <http://localhost:3001/api/login>. The simulated Twitch approves instantly,
so you land on the masked copy page. Click **Copy connection code**, then redeem
it the way the app will:

```powershell
# PowerShell
Invoke-RestMethod http://localhost:3001/api/redeem -Method Post -ContentType 'application/json' `
  -UserAgent 'ValorPredict/dev' -Body (@{ code = 'vp1_...paste here...' } | ConvertTo-Json)
```

```bash
# macOS / Linux / Git Bash
curl -s http://localhost:3001/api/redeem -H 'Content-Type: application/json' \
  -H 'User-Agent: ValorPredict/dev' -d '{"code":"vp1_...paste here..."}'
```

Use `/api/refresh` the same way with `{"refresh_token":"fake-refresh-1"}`. Two special
refresh tokens exercise the failure paths: `revoked` returns `401 reauth` and
`outage` returns `502 upstream`. Codes only work for the current run, because the
keys are regenerated each time the server starts.

### 3. Real Twitch, on your machine

1. In the Twitch console, add `http://localhost:3001/api/callback` to your app's OAuth Redirect URLs (a separate development app is fine).
2. Copy `.env.example` to `.env.local` and fill it in with `PUBLIC_BASE_URL=http://localhost:3001`. Generate each key with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Run it twice, for `CODE_SEAL_KEY` and `STATE_SIGNING_KEY`. `.env.local` is git-ignored.
3. Run `npm run dev:local` and open <http://localhost:3001/api/login>.

The dev server uses port **3001** because the desktop app's own sign-in listener
uses 3000. To change it, set `PORT` (PowerShell: `$env:PORT=3002; npm run dev:local`)
and keep `PUBLIC_BASE_URL` and the Twitch redirect URL in step with it.

`npm run dev:vercel` runs Vercel's own emulator (`vercel dev`). It needs a Vercel
login and a linked project, so use it only to check Vercel-specific behaviour.

## Rotating secrets

| What | Effect |
| --- | --- |
| `TWITCH_CLIENT_SECRET` | Generate a new one in the Twitch console, update it in Vercel, redeploy. **No app release needed**, and existing users stay signed in. |
| `CODE_SEAL_KEY` | Only invalidates codes that are in flight (at most 10 minutes' worth). |
| `STATE_SIGNING_KEY` | Only invalidates sign-ins that are in progress. |

If the Client Secret ever leaks, rotate it straight away. Because it never ships
inside the app, the fix is a dashboard change, not a new installer.

## Security notes

- **The secret never leaves Vercel.** It is not in the app, the repository or any response.
- **Nothing sensitive is logged.** The code never logs request or response bodies. The only things logged are names of missing environment variables.
- **Login is bound to the browser that started it.** `state` is HMAC-signed in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` prefixed on https) and must match what Twitch returns. Someone can't hand a victim a callback link and have it complete.
- **The sign-in page is locked down.** Nonce-based CSP with `default-src 'none'`, `frame-ancestors 'none'`, `no-store`, `no-referrer`. It reflects nothing from the query string.
- **Scopes are checked.** If Twitch grants fewer scopes than the app needs, sign-in is refused with an explanation.
- **Existing tokens survive an outage.** Predictions are created and resolved directly against Twitch, so if this service is down, only new sign-ins and refreshes are affected.

## Layout

```text
api/        the four routes (Vercel Functions, Web-standard Request/Response)
lib/        env, sealing, state cookie, Twitch calls, page HTML, HTTP helpers
test/       Vitest suite
dev/        local dev server (not deployed)
```
