# ValorPredict

Free Windows desktop app that automatically opens **Twitch Channel Points
Predictions** when your Valorant match starts — and resolves them from the
match result when it ends. Detection, prediction coordination, and storage run
locally on your PC, while the app connects directly to Riot and Twitch as
needed. There is no ValorPredict account or fee. The only ValorPredict-run piece
is a small open-source [sign-in service](../auth/README.md) used to connect and
refresh your Twitch login; it stores nothing.

> ValorPredict isn't endorsed by Riot Games and doesn't reflect the views or
> opinions of Riot Games or anyone officially involved in producing or managing
> Riot Games properties.

## Install

Download the installer from the
[latest GitHub release](https://github.com/AntiParty/ValorPredict/releases/latest) and run it.

The installer is not code-signed, so Windows SmartScreen may warn on first
run — choose **More info → Run anyway**. If you'd rather not trust a binary,
build from source (below); it's the same code.

## Set up (one time, ~1 minute)

1. Launch ValorPredict and click **Connect Twitch**. Your browser opens Twitch's
   usual authorization screen.
2. Approve. The page shows a hidden connection code with a **Copy connection
   code** button. The code is encrypted, never displayed as text, and expires
   after 10 minutes.
3. Back in ValorPredict, click **Paste from clipboard**. The app reads the code
   itself and clears your clipboard afterwards. (If that fails, **Paste
   manually** takes it in a masked field.)

No Twitch developer account is needed. Sign-in goes through ValorPredict's
shared Twitch application: its Client Secret is held by the open-source
[`auth/`](../auth/README.md) service, which exchanges your sign-in for tokens
and refreshes them every few hours. It keeps no database and logs no tokens,
but your tokens pass through it briefly in memory, so you are trusting that
service in this mode. Predictions themselves go directly between the app and
Twitch, so they keep working if the service is down.

### Use your own Twitch application instead

Under **Use my own Twitch application** you can register your own app and skip
the sign-in service entirely. Its credentials are stored locally and sent only
to Twitch:

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   and choose **Register Your Application**.
2. Name it anything (e.g. `ValorPredict`), set the OAuth Redirect URL exactly to:

   ```text
   http://localhost:3000/auth/twitch/callback
   ```

3. Create the app, then copy the **Client ID** and generate a **Client Secret**.
4. Paste both into the setup screen, then click **Connect Twitch**.

The app requests only the `channel:manage:predictions` and
`channel:read:predictions` scopes. Your account must be eligible for Channel
Points Predictions (affiliate or partner).

## Use

1. Enable and customize the **Competitive** and/or **Custom** preset (title,
   outcomes, prediction window).
2. Click **Start monitoring**.
3. Queue into Valorant. When a supported match goes live, a prediction opens
   automatically; when the match ends, it resolves to the winning outcome.
   If the result can't be read, the prediction stays open for manual resolution.

Closing the window hides the app to the system tray — detection keeps running.
**Quit** lives in the tray menu. **Send test prediction** opens a real
prediction from your preset so you can verify the pipeline anytime.

Unrated, swiftplay, deathmatch, and anything else the detector can't positively
identify normalize to `unknown` and are ignored.

## What it does NOT do

- Read Valorant memory, inject into the game, or hook functions.
- Sniff network packets or bypass Vanguard.
- Automate gameplay, agent selection, chat, or match actions.
- Send Riot credentials or match data to ValorPredict, Twitch, analytics
  providers, or unrelated third parties. There is no telemetry upload.

Detection is read-only: the app reads the local Riot Client lockfile and calls
local Riot Client endpoints plus Riot-owned game services. The lockfile
password is used only on loopback; Riot session tokens are held in memory and
sent only to Riot-owned services for read-only requests. Raw MatchIDs stay in
the Rust backend and are SHA-256 hashed before they appear in status or logs.
Prediction requests go directly to Twitch. Twitch sign-in and token refresh go
through the sign-in service unless you use your own Twitch application.

## Build from source

Prerequisites: Node.js 20+, Rust stable (MSVC), Microsoft WebView2, and the
Windows C++ build tools required by Tauri.

```powershell
cd companion
npm install
npm run tauri dev     # run in development (adds simulation + telemetry panels)
npm run tauri build   # produce the release installer (src-tauri/target/release/bundle/nsis)
```

Verification:

```powershell
cd companion
npm run build         # type-check + bundle the UI
cd src-tauri
cargo test            # vap_core + companion tests
```

## Architecture

- `core/` — `vap_core`: Tauri-independent Twitch OAuth, connection-code
  redemption, SQLite store, and prediction lifecycle, so the backend logic can
  be compiled and tested on its own.
- `../auth/` — the stateless Vercel sign-in service (see its README). To point a
  build at your own deployment, set `VALORPREDICT_TWITCH_CLIENT_ID` and
  `VALORPREDICT_BROKER_URL` when building.
- `src-tauri/` — the desktop shell: read-only Riot detection loop, tray, and
  IPC commands that surface `vap_core` to the UI.
- `src/` — React UI: onboarding wizard, prediction presets, monitoring.

If Riot changes a local endpoint, update the centralized paths and JSON
extraction in `src-tauri/src/riot_local_client.rs`.
