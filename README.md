# ValorPredict

**Free, self-contained Windows app that automatically creates Twitch Channel
Points Predictions when your Valorant match starts** — and resolves them from
the match result when it ends. No ValorPredict-hosted service, ValorPredict
account, or subscription: detection, prediction coordination, and storage run
locally, while the app connects directly to Riot and Twitch as needed.

**➡ The product lives in [`companion/`](companion/README.md).** Start there for
install, setup, and build instructions.

> ValorPredict isn't endorsed by Riot Games and doesn't reflect the views or
> opinions of Riot Games. It uses read-only surfaces exposed by the installed
> Riot Client and Riot-owned game services — see
> [How detection works](#how-detection-works).

## Repository layout

| Path | What it is |
| --- | --- |
| [`companion/src-tauri/`](companion/src-tauri/) | The desktop shell: read-only Riot match detection, system tray, and the IPC commands that surface `vap_core` to the UI. |
| [`companion/core/`](companion/core/) | `vap_core`: Tauri-independent Twitch OAuth, SQLite store, and prediction lifecycle. Compiles and tests on its own. |
| [`companion/src/`](companion/src/) | The React UI: onboarding wizard, prediction presets, and monitoring dashboard. |

## How detection works

This section exists so anyone — including anti-cheat engineers — can verify
exactly what the app touches without reading the whole tree first. Every step
below maps to a specific source file.

The desktop app polls, on a timer, using **only** these inputs:

1. **Process list** — checks whether `RiotClientServices.exe` and
   `VALORANT-Win64-Shipping.exe` are running, via the `sysinfo` crate. Nothing
   is opened, read from, or written to those processes.
   → [`process_detection.rs`](companion/src-tauri/src/process_detection.rs)

2. **Riot Client lockfile** — reads the plain-text file the Riot Client itself
   writes at
   `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile`. This is the
   local handshake file used to discover the Riot Client's loopback port and
   per-session password.
   → [`riot_lockfile.rs`](companion/src-tauri/src/riot_lockfile.rs)

3. **Local loopback API** — makes authenticated **HTTP GET** requests to
   `https://127.0.0.1:<port>` (the local endpoints the Riot Client exposes on
   the loopback interface) to obtain the session's entitlement token, PUUID, and
   region/shard — the same endpoints the client uses for its own UI.
   → [`riot_local_client.rs`](companion/src-tauri/src/riot_local_client.rs) (`local_json`)

4. **Riot-owned match-state endpoints** — with those tokens, makes read-only
   **HTTP GET** requests to Riot-owned `glz-*.a.pvp.net` and
   `pd.*.a.pvp.net` endpoints for pregame / current-game / match-details, over
   normal validated TLS. These services are used by the Riot Client; they are
   not presented here as Riot's documented public developer API. The app only
   ever *reads* them.
   → [`riot_local_client.rs`](companion/src-tauri/src/riot_local_client.rs) (`glz_json`, `get_match_result`)

5. **Log file (read-only fallback)** — if region/shard/version can't be resolved
   from the API, it reads `VALORANT\Saved\Logs\ShooterGame.log` to parse them.
   → [`riot_local_client.rs`](companion/src-tauri/src/riot_local_client.rs) (`read_shooter_game_log`)

The detection loop turns those signals into a state (`PreGame`, `CurrentGame`,
`Menus`, …) and, on transitions, tells `vap_core` to open or resolve a Twitch
prediction.
→ [`valorant_detector.rs`](companion/src-tauri/src/valorant_detector.rs)

## What it does NOT do

- Read or write Valorant/Riot process memory, inject code, or hook functions.
- Capture the screen, run OCR, or read pixels.
- Sniff, intercept, or modify network packets, and it does not touch Vanguard.
- Automate gameplay, agent selection, aiming, chat, or any in-match action —
  every Riot request is a read-only `GET`.
- Send Riot credentials or match data to ValorPredict, Twitch, analytics
  providers, or unrelated third parties. Riot session tokens are used only for
  authenticated requests to Riot-owned services. There is no telemetry or
  analytics upload.

## Data & privacy

- Twitch credentials are **per-user**: each streamer registers their own free
  Twitch application. Credentials are stored locally and sent only to Twitch
  as required for OAuth; there is no ValorPredict credential server.
- The Riot lockfile password is used only with the local loopback client. Riot
  access/entitlement tokens are held in memory and sent only to Riot-owned
  services for the read-only requests described above.
- Raw MatchIDs stay in the Rust backend and are **SHA-256 hashed**
  ([`hashing.rs`](companion/src-tauri/src/hashing.rs)) before they appear in the
  UI, status, or logs.
- OAuth tokens and prediction history live in a local SQLite file on the user's
  machine (managed by `vap_core`). Network traffic is limited to the direct
  Riot and Twitch requests required for detection and prediction management.

## Quick start (users)

Download the installer from the
[latest release](https://github.com/AntiParty/ValorPredict/releases/latest), run it, and
follow the in-app setup: register your own (free) Twitch application, paste its
Client ID/Secret, connect Twitch, enable a preset, start monitoring. Details in
the [companion README](companion/README.md).

## Build & verify from source

The installer is not code-signed; building from source produces the same app.

```powershell
cd companion
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce the release installer
```

Verification:

```powershell
cd companion
npm run build         # type-check + bundle the UI
cd src-tauri
cargo test            # vap_core + detection tests (see tests/)
```

## License

[MIT](LICENSE)
