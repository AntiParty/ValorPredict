# Valorant Auto Predictions Companion

A Windows-first Tauri desktop companion for the Valorant Auto Predictions backend.

The app works without Valorant through development-only simulation controls.
Production builds present a small status and setup surface. When Valorant and
Riot Client are available, it can inspect read-only local Riot state and send
sanitized state changes to the backend.

## What It Does

- Stores the backend URL and local companion API key on this PC.
- Tests the backend connection with `/api/local/ping`.
- Simulates Competitive, Custom, and pre-game events.
- Detects Riot Client and Valorant process presence.
- Reads the Riot lockfile locally.
- Calls read-only local Riot session endpoints.
- Calls read-only pre-game and current-game player-state endpoints.
- Reads match details to normalize only Competitive and Custom modes.
- Hashes MatchIDs before they enter status, logs, or backend requests.
- Deduplicates match events and applies a ten-minute current-game cooldown.
- Remembers whether monitoring was enabled across launches.
- Hides to the Windows system tray when the window is closed.

## What It Does Not Do

- Read Valorant memory.
- Inject into Valorant or hook game functions.
- Sniff network packets.
- Bypass Vanguard.
- Automate gameplay, agent selection, chat, or match actions.
- Send Riot tokens, lockfile passwords, raw MatchIDs, or screenshots to the backend.
- Perform Twitch OAuth. Twitch remains owned by the web backend.

## Safety And Privacy

The Riot lockfile password, Riot authorization token, entitlement token, full local API key, and raw MatchID stay inside the Rust process.

The backend receives only:

- state;
- normalized game mode (`competitive`, `custom`, or `unknown`);
- confidence;
- SHA-256 MatchID hash;
- region and shard;
- non-sensitive evidence labels.

Local Riot Client requests are restricted to `127.0.0.1`. Riot GLZ requests keep normal TLS certificate validation enabled.

## Run

Prerequisites:

- Node.js
- Rust stable MSVC toolchain
- Microsoft WebView2
- Windows C++ build tools required by Tauri

```powershell
cd companion
npm install
npm run tauri dev
```

Development mode includes simulation buttons, detector telemetry, cooldown
controls, and sanitized logs.

## Build

```powershell
cd companion
npm run tauri build
```

The compiled app omits development diagnostics. Closing its window always hides
it to the system tray; **Quit** is available only from the tray menu.

## Connect To The Backend

1. Start the backend from the repository root with `npm run dev`.
2. Open the web dashboard.
3. Connect Twitch and enable the Competitive and/or Custom preset.
4. Generate a Local API Key in the **Local Companion App** card.
5. Open this companion.
6. Enter `http://localhost:3000` and paste the key.
7. Save settings.
8. Click **Test Connection**.

## Test Without Valorant In Development

1. Complete the backend connection steps.
2. Run the companion with `npm run tauri dev`.
3. Click **Simulate Pre-Game** to send a state-only event.
4. Click **Simulate Competitive** or **Simulate Custom**.
5. Confirm the backend creates a Twitch prediction.
6. Resolve or cancel the prediction from the web dashboard before repeating.

Simulation and real detection use the same Rust backend client.

## Test With Valorant

1. Start Riot Client and Valorant.
2. Click **Start Monitoring**.
3. Queue into a game.
4. Check for `pre_game` during agent select.
5. Check for `current_game` after loading into the match.
6. Confirm the detected mode is Competitive, Custom, or Unknown.
7. Confirm logs show only a short MatchID hash prefix.

Only Competitive and Custom can trigger predictions. Unrated, alternate queues,
missing mode data, and unfamiliar Riot values normalize to Unknown and are
ignored by the backend.

If Riot changes a local endpoint, update the centralized paths and JSON extraction in `src-tauri/src/riot_local_client.rs`.

## Verification

```powershell
cd companion
npm run build
cd src-tauri
cargo test
cargo check
```
