# ValorPredict

**Free, self-contained Windows app that automatically creates Twitch Channel
Points Predictions when your Valorant match starts** — and resolves them when
it ends. No hosted service, no subscription: Twitch OAuth, the prediction
lifecycle, and storage all run locally inside the app.

**➡ The product lives in [`companion/`](companion/README.md).** Start there for
install, setup, and build instructions.

## Repository layout

| Part | Path | Status |
| --- | --- | --- |
| **ValorPredict app** | [`companion/`](companion/README.md) | **The product.** Windows Tauri app: Riot match detection + local Twitch predictions (`vap_core` Rust crate). |
| Web app | [`web/`](web/README.md) | Legacy/optional. Browser dashboard from the old hosted-service design. |
| Backend API | [`src/`](src/) | Legacy/optional. Express 5 + TypeScript API the web app talks to. |

The web app and backend predate the self-contained companion and are kept for
anyone who wants a browser dashboard (`vap_core` also ships a standalone
`bin/server.rs`). They are not required to use ValorPredict and are not part
of releases.

## Quick start (users)

Download the installer from
[Releases](https://github.com/AntiParty/ValorPredict/releases), run it, and
follow the in-app setup: register your own (free) Twitch application, paste
its Client ID/Secret, connect Twitch, enable a preset, start monitoring.
Details in the [companion README](companion/README.md).

## Quick start (developers)

```powershell
cd companion
npm install
npm run tauri dev
```

Rust tests: `cd companion/src-tauri && cargo test` (covers `vap_core` and the
detection shell). UI type-check/bundle: `cd companion && npm run build`.

For the legacy web stack: `npm install && npm run dev` at the repo root serves
the Express API + React SPA on `http://localhost:3000` (see
[web/README.md](web/README.md)).

## Safety

Detection is **read-only**: ValorPredict reads the local Riot Client lockfile
and local HTTP endpoints — it never reads game memory, injects, sniffs
packets, or automates gameplay. Riot tokens and raw match IDs never leave the
local process. ValorPredict isn't endorsed by Riot Games.

## License

[MIT](LICENSE)
