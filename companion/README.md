# ValorPredict

Free Windows desktop app that automatically opens **Twitch Channel Points
Predictions** when your Valorant match starts — and resolves them from the
match result when it ends. Everything runs locally on your PC: Twitch OAuth,
the prediction lifecycle, and the SQLite store live inside the app. There is
no hosted service, no account, and no fee.

> ValorPredict isn't endorsed by Riot Games and doesn't reflect the views or
> opinions of Riot Games or anyone officially involved in producing or managing
> Riot Games properties.

## Install

Download the latest installer from
[GitHub Releases](https://github.com/AntiParty/ValorPredict/releases) and run it.

The installer is not code-signed, so Windows SmartScreen may warn on first
run — choose **More info → Run anyway**. If you'd rather not trust a binary,
build from source (below); it's the same code.

## Set up (one time, ~3 minutes)

Each streamer registers their **own** Twitch application, so your credentials
never touch anyone else's server:

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   and choose **Register Your Application**.
2. Name it anything (e.g. `ValorPredict`), set the OAuth Redirect URL exactly to:

   ```text
   http://localhost:3000/auth/twitch/callback
   ```

3. Create the app, then copy the **Client ID** and generate a **Client Secret**.
4. Launch ValorPredict and paste both into the setup screen, then click
   **Connect Twitch** — a browser opens for the usual Twitch authorization.

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
- Send your Riot tokens, lockfile password, raw MatchIDs, or Twitch
  credentials anywhere. There is no telemetry.

Detection is read-only: the app reads the local Riot Client lockfile and calls
the same local HTTP endpoints the client itself exposes. The lockfile password,
Riot tokens, and raw MatchIDs never leave the Rust process; MatchIDs are
SHA-256 hashed before they appear in status or logs.

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

- `core/` — `vap_core`: Tauri-independent Twitch OAuth, SQLite store, and
  prediction lifecycle. Also ships a standalone `bin/server.rs` for the
  optional legacy browser dashboard.
- `src-tauri/` — the desktop shell: read-only Riot detection loop, tray, and
  IPC commands that surface `vap_core` to the UI.
- `src/` — React UI: onboarding wizard, prediction presets, monitoring.

If Riot changes a local endpoint, update the centralized paths and JSON
extraction in `src-tauri/src/riot_local_client.rs`.
