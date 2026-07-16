# ValorPredict Usability and Performance Improvement Design

## Objective

Improve first-time setup, everyday monitoring, and recurring runtime performance without redesigning ValorPredict or weakening match-detection reliability.

Success means users can understand the app at a glance, recover from common setup and connection problems, use the interface at narrower desktop-window sizes, and leave monitoring running with less recurring CPU, IPC, and storage work.

## Scope

This is a balanced, surgical improvement pass. It preserves the existing visual identity, React/Tauri architecture, Twitch and Riot integrations, prediction lifecycle, and supported game modes.

The pass covers:

- onboarding usability and recovery;
- dashboard readability and state communication;
- actionable error handling;
- responsive desktop layout;
- UI polling and render behavior;
- settings persistence behavior;
- process-detection efficiency; and
- focused regression and performance verification.

It does not add Riot WebSocket detection. The local WebSocket is undocumented and does not directly replace the authoritative remote pre-game/current-game requests. The existing polling architecture remains the reliability baseline.

## User Experience Design

### Readability and layout

Essential instructions, form labels, status descriptions, and action labels will use readable desktop sizes. Muted text will retain the current hierarchy but gain enough contrast to remain legible. Decorative microcopy may remain smaller only when it is nonessential.

The app will no longer require a 720-pixel-wide content viewport. Cards, progress indicators, status rows, action groups, and preset fields will reflow for narrower desktop windows without horizontal scrolling. The existing dark Valorant-inspired visual identity will remain intact.

### Application bootstrap

The application will distinguish these states:

1. authentication state is loading;
2. the backend reports that Twitch is not configured;
3. Twitch is configured but no user is connected;
4. a connected user is ready; and
5. the Tauri/backend bridge cannot be reached.

A backend failure will show a dedicated recovery state with a retry action and concise explanation. It will not silently route an existing user into onboarding. Plain Vite development preview may still render a deterministic preview state, but that behavior must be explicit and limited to development.

### Onboarding

The three-step flow remains Create app, Add keys, and Connect. It will gain:

- Back navigation where no irreversible state has been persisted;
- an Edit credentials path after credentials have been saved;
- clear Affiliate/Partner eligibility guidance before authorization;
- a concise explanation of local credential storage;
- explicit browser-return guidance during Twitch authorization;
- persistent, actionable errors that do not discard entered values; and
- buttons and progress indicators that remain usable in narrow windows.

The redirect URL remains copyable and visible. No credentials are sent anywhere except through the existing local backend and Twitch authorization flow.

### Monitoring and predictions

The primary status card will communicate exactly one leading state: paused, waiting for Valorant, preparing for a match, match detected, monitoring normally, or action required. Supporting detail will explain the next expected user action without exposing detector terminology.

Errors will be normalized into plain-language categories such as backend unavailable, Twitch authorization expired, credentials invalid, or Riot Client unavailable. Development logs retain technical detail.

Actions will reflect prerequisites. A real test prediction will not be offered as ready when the Competitive preset is missing or disabled; the interface will direct the user to enable or configure it. Busy states will prevent conflicting operations.

The detection interval setting will update visually while dragged but persist only after the interaction settles. A save failure will restore or clearly mark the unsaved state.

## Performance Design

### Process detection

The current implementation creates `System::new_all()` and collects every process name on each detector pass. It will be replaced with a reusable process detector owned by the monitoring loop. The detector will refresh only process information required to identify Riot Client and Valorant, avoid allocating a complete process-name vector, and short-circuit once both target processes are found.

Process-name matching remains case-insensitive and preserves the existing executable names. Match-state decisions, cooldown behavior, hashing, and Riot request semantics do not change.

The one-off match-result path will reuse an existing detector when invoked from the monitoring lifecycle. Truly isolated calls may construct a detector locally, but recurring monitoring must not rebuild a full system snapshot.

### UI polling and state updates

Status and dashboard data have different freshness requirements, but their scheduling will share one visibility-aware polling primitive. This removes duplicated timer lifecycle code and guarantees that all UI polling pauses while the window is hidden.

The status view may retain a faster cadence than the dashboard. A new fetch will not overlap an in-flight request of the same type. State setters will avoid rerendering when the relevant response has not changed.

The Rust detector continues running while the window is hidden; only presentation-layer IPC polling pauses. Prediction correctness therefore remains independent of window visibility.

### Settings and bounded data

The polling-interval control will debounce or commit on interaction completion so one slider gesture produces one backend write. Dashboard event history and logs will remain explicitly bounded at their data-source boundary. The UI will not request or render unbounded history.

Bundle splitting is not a priority: the existing production JavaScript bundle is modest for a local desktop application. Runtime work offers greater value than adding loading complexity.

## Component Boundaries

- `App` owns bootstrap state and selects onboarding, recovery, or connected workspace views.
- Onboarding components own step navigation and input state; backend authentication state remains authoritative after persistence.
- A shared visibility-aware polling hook owns timer setup, overlap prevention, immediate refresh on window reveal, and cleanup.
- `MonitorSection` translates detector status into the primary user-facing state.
- `PredictionsDashboard` owns presets, test-prediction prerequisites, and settings save state.
- The Tauri monitoring lifecycle owns a reusable Rust process detector.
- Match transition and prediction lifecycle modules retain their existing responsibilities.

These boundaries keep error presentation, polling mechanics, system inspection, and match decisions independently testable.

## Error Handling

API failures will be classified without discarding their original technical message. User-facing copy will state what failed, whether automation is still running, and the safest recovery action.

Polling failures will not erase the last known good status. Repeated failures will not create repeated notices or overlapping retries. Successful refresh clears transient connection warnings.

Settings changes will distinguish local draft state from persisted state. If persistence fails, the UI will communicate that the displayed value was not saved.

Process-detection failures degrade to existing unknown/not-running states and logs rather than terminating monitoring.

## Testing Strategy

### React and TypeScript

Focused tests will be added for:

- backend failure routes to recovery rather than onboarding;
- development preview behavior is explicit;
- onboarding forward/back/edit navigation;
- eligibility and authorization guidance;
- monitoring-state labels and recovery actions;
- disabled or missing Competitive preset test behavior;
- polling pauses while hidden and resumes immediately when visible;
- polling does not overlap in-flight requests; and
- slider interaction produces one persisted settings update.

Where the current project lacks a UI test runner, the implementation plan will introduce the smallest suitable test setup rather than testing React internals manually.

### Rust

Tests will cover:

- case-insensitive recognition of both target process names;
- early completion once both processes are found;
- preservation of detection decisions and cooldown behavior; and
- reusable detector integration with the monitoring lifecycle.

Process enumeration will be separated behind a small interface or pure matching helper so deterministic unit tests do not depend on processes running on the test machine.

### Verification

Completion requires fresh evidence from:

- the full UI test suite;
- TypeScript compilation and the production Vite build;
- Rust tests for `vap_core` and the Tauri companion;
- rendered onboarding and connected-state checks at normal and narrow desktop widths;
- keyboard focus and reduced-motion checks for changed interactions; and
- a before/after comparison showing that recurring monitoring no longer constructs a full system snapshot and that one settings gesture causes one backend write.

## Rollout and Risk Control

Changes will be organized so UX, shared polling, and Rust detector improvements can be reviewed independently even if delivered together. Existing IPC command names and persisted data formats will remain compatible.

The highest-risk area is detector lifecycle ownership. Tests will verify that starting, stopping, and restarting monitoring constructs and drops detector state correctly and never creates duplicate loops. If reuse cannot be introduced without changing public detection APIs broadly, the fallback is a targeted refresh implementation inside the existing call path; correctness takes priority over marginal optimization.

## Explicit Non-goals

- Riot local WebSocket or XMPP integration;
- new supported game modes;
- changes to prediction settlement rules;
- account hosting, telemetry, or analytics;
- replacement of Tauri, React, SQLite, or Twitch OAuth;
- a new visual brand or full dashboard redesign; and
- unrelated backend refactoring.
