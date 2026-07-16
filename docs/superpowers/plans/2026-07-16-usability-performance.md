# ValorPredict Usability and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-time setup and everyday monitoring easier to understand while reducing recurring UI, settings, and process-detection work.

**Architecture:** Preserve the React/Tauri split and existing IPC contracts. Add small frontend seams for bootstrap errors and visibility-aware polling, then make the Rust monitoring loop own a reusable process detector without changing match-transition decisions.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Vitest, Testing Library, Tauri 2, Rust 1.77.2, sysinfo 0.37.

## Global Constraints

- Preserve existing Twitch OAuth, SQLite data, Riot HTTP detection, supported game modes, prediction lifecycle, and visual identity.
- Do not add Riot WebSocket, XMPP, telemetry, analytics, hosted services, or new game modes.
- Keep existing IPC command names and persisted data formats compatible.
- Keep technical error detail in development logs while presenting actionable plain-language errors to users.
- The Rust detector remains authoritative while the presentation layer pauses polling when its window is hidden.
- Use test-first development for every behavior change.

---

## File Structure

**Create**

- `companion/src/test/setup.ts` — shared DOM test cleanup and matchers.
- `companion/src/errors.ts` — maps unknown IPC failures to stable user-facing error categories.
- `companion/src/components/BootstrapError.tsx` — dedicated application-start recovery view.
- `companion/src/hooks/useVisiblePolling.ts` — visibility-aware, non-overlapping polling primitive.
- `companion/src/App.test.tsx` — bootstrap routing tests.
- `companion/src/components/predictions/OnboardingWizard.test.tsx` — setup navigation and guidance tests.
- `companion/src/hooks/useVisiblePolling.test.tsx` — timer, visibility, and overlap tests.
- `companion/src/components/predictions/PredictionsDashboard.test.tsx` — test-prediction and settings-save tests.

**Modify**

- `companion/package.json`, `companion/package-lock.json`, `companion/vite.config.ts` — add the smallest Vitest/DOM test setup.
- `companion/src/App.tsx` — explicit loading, preview, recovery, onboarding, and connected states.
- `companion/src/components/predictions/OnboardingWizard.tsx` — reversible local navigation and credential-edit mode.
- `companion/src/components/predictions/CreateAppStep.tsx` — clearer eligibility/setup guidance.
- `companion/src/components/predictions/CredentialsStep.tsx` — back navigation and local-storage guidance.
- `companion/src/components/predictions/ConnectStep.tsx` — edit credentials, browser-return guidance, and normalized errors.
- `companion/src/components/MonitorSection.tsx` — shared polling and stable last-known-good status.
- `companion/src/components/predictions/PredictionsDashboard.tsx` — shared polling, test prerequisites, draft settings, and one-write persistence.
- `companion/src/styles.css` — readable type, stronger contrast, responsive layout, recovery and unsaved states.
- `companion/src-tauri/src/lib.rs` — reduce minimum window width.
- `companion/src-tauri/src/process_detection.rs` — reusable targeted process detector.
- `companion/src-tauri/src/valorant_detector.rs` — accept detector ownership from the monitoring loop.
- `companion/src-tauri/src/commands.rs` — construct one detector per monitoring lifecycle and reuse it for result lookup.
- `companion/src-tauri/tests/detection.rs` — process matching and unchanged decision regressions.

---

### Task 1: Frontend Test Harness and Bootstrap Recovery

**Files:**
- Modify: `companion/package.json`
- Modify: `companion/package-lock.json`
- Modify: `companion/vite.config.ts`
- Create: `companion/src/test/setup.ts`
- Create: `companion/src/errors.ts`
- Create: `companion/src/components/BootstrapError.tsx`
- Create: `companion/src/App.test.tsx`
- Modify: `companion/src/App.tsx`

**Interfaces:**
- Produces: `friendlyError(error: unknown, fallback: string): UserFacingError`.
- Produces: `BootstrapError({ error, onRetry, retrying })`.
- Produces: explicit `AuthState` variants `loading`, `ready`, and `error`.

- [ ] **Step 1: Install and configure the test harness**

Add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` as dev dependencies. Add scripts:

```json
"test": "vitest",
"test:run": "vitest run"
```

Configure Vite with:

```ts
test: {
  environment: "jsdom",
  setupFiles: "./src/test/setup.ts",
  css: true,
  clearMocks: true,
}
```

The setup file imports `@testing-library/jest-dom/vitest` and calls Testing Library cleanup after each test.

- [ ] **Step 2: Write failing bootstrap tests**

Mock `companionApi.getMe` and assert:

```tsx
it("shows recovery instead of onboarding when bootstrap fails", async () => {
  vi.mocked(companionApi.getMe).mockRejectedValue(new Error("IPC unavailable"));
  render(<App />);
  expect(await screen.findByRole("heading", { name: "ValorPredict couldn't start" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Create your Twitch app" })).not.toBeInTheDocument();
});

it("retries bootstrap from the recovery screen", async () => {
  vi.mocked(companionApi.getMe)
    .mockRejectedValueOnce(new Error("IPC unavailable"))
    .mockResolvedValueOnce(connectedMe);
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText(connectedMe.user.twitch_login)).toBeVisible();
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npm run test:run -- src/App.test.tsx`

Expected: FAIL because bootstrap errors currently route to onboarding and `BootstrapError` does not exist.

- [ ] **Step 4: Implement categorized errors and recovery routing**

Define:

```ts
export interface UserFacingError {
  title: string;
  message: string;
  detail: string;
}

export function friendlyError(error: unknown, fallback: string): UserFacingError {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();
  if (lower.includes("twitch") && (lower.includes("expired") || lower.includes("unauthorized"))) {
    return { title: "Twitch needs to reconnect", message: "Reconnect Twitch to keep predictions working.", detail };
  }
  return { title: "ValorPredict couldn't start", message: fallback, detail };
}
```

Make `App.loadMe` set `{ status: "error", error }` on failure. Only use the unconfigured preview response when `import.meta.env.DEV` and the Tauri bridge is absent. Render `BootstrapError` with `Try again`; expose raw detail only in a `<details>` disclosure.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm run test:run -- src/App.test.tsx`

Expected: PASS with no React act warnings.

- [ ] **Step 6: Commit**

```powershell
git add companion/package.json companion/package-lock.json companion/vite.config.ts companion/src/test companion/src/errors.ts companion/src/components/BootstrapError.tsx companion/src/App.tsx companion/src/App.test.tsx
git commit -m "feat: add recoverable app bootstrap"
```

---

### Task 2: Recoverable Onboarding

**Files:**
- Create: `companion/src/components/predictions/OnboardingWizard.test.tsx`
- Modify: `companion/src/components/predictions/OnboardingWizard.tsx`
- Modify: `companion/src/components/predictions/CreateAppStep.tsx`
- Modify: `companion/src/components/predictions/CredentialsStep.tsx`
- Modify: `companion/src/components/predictions/ConnectStep.tsx`

**Interfaces:**
- `CredentialsStep` consumes `onBack: () => void`.
- `ConnectStep` consumes `onEditCredentials: () => void`.
- `OnboardingWizard` maintains a local override allowing a configured user to revisit credentials.

- [ ] **Step 1: Write failing onboarding tests**

Cover these visible behaviors:

```tsx
it("lets an unconfigured user go back from keys to app creation", async () => {
  render(<OnboardingWizard me={unconfiguredMe} onAdvance={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "I've created my app" }));
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Create your Twitch app" })).toBeVisible();
});

it("shows eligibility before Twitch authorization", () => {
  render(<OnboardingWizard me={configuredMe} onAdvance={vi.fn()} />);
  expect(screen.getByText(/Affiliate or Partner/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit credentials" })).toBeVisible();
});
```

Also assert that credentials copy says they remain on this PC and Connect explains that the browser returns control to the app.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- src/components/predictions/OnboardingWizard.test.tsx`

Expected: FAIL because Back, Edit credentials, and eligibility guidance are absent.

- [ ] **Step 3: Implement reversible navigation and guidance**

Use a local state with values `create`, `credentials`, or `connect`. Backend `me.configured` selects the initial value, while `Edit credentials` selects `credentials` without clearing stored data. Add:

```tsx
<button type="button" className="button ghost" onClick={onBack}>Back</button>
```

to the credentials action row and:

```tsx
<button type="button" className="button ghost" onClick={onEditCredentials}>
  Edit credentials
</button>
```

to Connect. State clearly that Channel Points Predictions require a Twitch Affiliate or Partner account, credentials stay on this PC, and users should return to ValorPredict after the browser confirms authorization.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:run -- src/components/predictions/OnboardingWizard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/components/predictions/OnboardingWizard.tsx companion/src/components/predictions/CreateAppStep.tsx companion/src/components/predictions/CredentialsStep.tsx companion/src/components/predictions/ConnectStep.tsx companion/src/components/predictions/OnboardingWizard.test.tsx
git commit -m "feat: make Twitch onboarding recoverable"
```

---

### Task 3: Shared Non-overlapping Visible Polling

**Files:**
- Create: `companion/src/hooks/useVisiblePolling.ts`
- Create: `companion/src/hooks/useVisiblePolling.test.tsx`
- Modify: `companion/src/components/MonitorSection.tsx`
- Modify: `companion/src/components/predictions/PredictionsDashboard.tsx`

**Interfaces:**
- Produces `useVisiblePolling(refresh: () => Promise<void>, intervalMs: number, visible: boolean): void`.
- The hook performs an immediate refresh, schedules the next refresh after completion, and cancels when hidden or unmounted.

- [ ] **Step 1: Write failing polling tests**

Using fake timers and a deferred promise, assert:

```tsx
it("refreshes immediately and never overlaps", async () => {
  const refresh = vi.fn(() => deferred.promise);
  renderHook(() => useVisiblePolling(refresh, 3000, true));
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9000);
  expect(refresh).toHaveBeenCalledTimes(1);
  deferred.resolve();
  await vi.advanceTimersByTimeAsync(3000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("does no work while hidden and refreshes on reveal", async () => {
  const { rerender } = renderHook(({ visible }) => useVisiblePolling(refresh, 3000, visible), {
    initialProps: { visible: false },
  });
  expect(refresh).not.toHaveBeenCalled();
  rerender({ visible: true });
  expect(refresh).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- src/hooks/useVisiblePolling.test.tsx`

Expected: FAIL because the shared hook does not exist.

- [ ] **Step 3: Implement the hook with recursive timeout scheduling**

Use an effect-local cancellation flag and timeout ID. Call `refresh`, then schedule the next call in `finally`; do not use `setInterval`, which can overlap slow requests. Clear the timeout and suppress future scheduling on cleanup.

- [ ] **Step 4: Replace both component timer effects**

In `MonitorSection`, call:

```ts
useVisiblePolling(refresh, STATUS_POLL_MS, windowVisible);
```

In `PredictionsDashboard`, call:

```ts
useVisiblePolling(refresh, DASHBOARD_POLL_MS, windowVisible);
```

Keep the last successful data when refresh fails. Only update notices when the normalized error message changes.

- [ ] **Step 5: Run polling and component tests**

Run: `npm run test:run -- src/hooks/useVisiblePolling.test.tsx src/App.test.tsx`

Expected: PASS with no leaked-timer or act warnings.

- [ ] **Step 6: Commit**

```powershell
git add companion/src/hooks/useVisiblePolling.ts companion/src/hooks/useVisiblePolling.test.tsx companion/src/components/MonitorSection.tsx companion/src/components/predictions/PredictionsDashboard.tsx
git commit -m "perf: prevent overlapping visible-window polling"
```

---

### Task 4: Prediction Prerequisites and One-write Settings

**Files:**
- Create: `companion/src/components/predictions/PredictionsDashboard.test.tsx`
- Modify: `companion/src/components/predictions/PredictionsDashboard.tsx`

**Interfaces:**
- Competitive preset readiness is `Boolean(competitive && competitive.enabled)`.
- Slider `onChange` changes local draft only; `onPointerUp`, `onKeyUp`, or `onBlur` calls a deduplicated `persistPollInterval()`.

- [ ] **Step 1: Write failing dashboard tests**

Assert:

```tsx
it("does not offer a ready test action when Competitive is disabled", async () => {
  vi.mocked(companionApi.getDashboard).mockResolvedValue(dashboardWithCompetitiveDisabled);
  render(<PredictionsDashboard />);
  const button = await screen.findByRole("button", { name: "Enable Competitive to test" });
  expect(button).toBeDisabled();
  expect(screen.getByText(/enable your Competitive preset/i)).toBeVisible();
});

it("persists one settings value after a slider gesture", async () => {
  render(<PredictionsDashboard />);
  const slider = await screen.findByRole("slider", { name: "Detection polling interval" });
  fireEvent.change(slider, { target: { value: "20" } });
  fireEvent.change(slider, { target: { value: "25" } });
  expect(companionApi.saveSettings).not.toHaveBeenCalled();
  fireEvent.pointerUp(slider);
  expect(companionApi.saveSettings).toHaveBeenCalledTimes(1);
  expect(companionApi.saveSettings).toHaveBeenCalledWith(25);
});
```

Add a rejection case showing `25s not saved` while retaining the persisted value for retry.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- src/components/predictions/PredictionsDashboard.test.tsx`

Expected: FAIL because test prerequisites and draft persistence do not exist.

- [ ] **Step 3: Implement explicit readiness and draft/persisted settings**

Maintain `pollInterval` and `persistedPollInterval`. Update the draft on every change, but call `saveSettings` only when interaction completes and the values differ. On success, set the persisted value and show `Settings saved.` On failure, retain the draft, add `aria-invalid="true"`, and show a retryable error identifying the unsaved value.

Give the slider `aria-label="Detection polling interval"`. Disable and relabel the test button when Competitive is absent or disabled.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:run -- src/components/predictions/PredictionsDashboard.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/components/predictions/PredictionsDashboard.tsx companion/src/components/predictions/PredictionsDashboard.test.tsx
git commit -m "feat: guard test predictions and batch settings saves"
```

---

### Task 5: Readable Responsive Interface

**Files:**
- Modify: `companion/src/styles.css`
- Modify: `companion/src-tauri/src/lib.rs`

**Interfaces:**
- The CSS supports widths down to the Tauri minimum of 560 pixels without horizontal page overflow.

- [ ] **Step 1: Add a failing rendered-width assertion**

Extend `App.test.tsx` with a connected dashboard fixture at `window.innerWidth = 560` and assert that primary action groups use the narrow-layout class contracts. Add a static CSS assertion that `body` no longer declares `min-width: 720px`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:run -- src/App.test.tsx`

Expected: FAIL because the current minimum is 720 pixels and narrow action layout is absent.

- [ ] **Step 3: Implement the responsive and readability pass**

Make these exact baseline changes, adjusting only selectors that already exist:

- body minimum width: `560px`;
- essential paragraph and muted line text: at least `13px` with `1.55` line height;
- form labels and field help: at least `12px` and `11px` respectively;
- action buttons: at least `12px`, 40-pixel minimum height;
- improve `--muted` and low-contrast copy so essential text meets readable dark-theme contrast;
- at `max-width: 700px`, stack wizard facts, status strip, preset rows, test row, and action groups;
- allow redirect URLs, account names, and preset titles to wrap or ellipsize without widening the page;
- add visible `:focus-visible` outlines; and
- retain the existing `prefers-reduced-motion` behavior.

Change Tauri `.min_inner_size(760.0, 680.0)` to `.min_inner_size(560.0, 640.0)`.

- [ ] **Step 4: Run frontend tests and production build**

Run: `npm run test:run`

Expected: all frontend tests PASS.

Run: `npm run build`

Expected: TypeScript and Vite exit 0 with no compilation errors.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/styles.css companion/src/App.test.tsx companion/src-tauri/src/lib.rs
git commit -m "feat: improve desktop readability and narrow layouts"
```

---

### Task 6: Reusable Targeted Rust Process Detection

**Files:**
- Modify: `companion/src-tauri/src/process_detection.rs`
- Modify: `companion/src-tauri/src/valorant_detector.rs`
- Modify: `companion/src-tauri/src/commands.rs`
- Modify: `companion/src-tauri/tests/detection.rs`

**Interfaces:**
- Produces `ProcessDetector::new() -> ProcessDetector`.
- Produces `ProcessDetector::detect(&mut self) -> ProcessSignals`.
- Produces pure `record_process_name(signals: &mut ProcessSignals, name: &str) -> bool`, returning `true` once both targets are found.
- Changes `detect_once(detector: &mut ProcessDetector)` and `fetch_match_won(match_id: &str, detector: &mut ProcessDetector)`.

- [ ] **Step 1: Write failing process-matching tests**

Add:

```rust
#[test]
fn process_matching_is_case_insensitive_and_stops_when_complete() {
    let mut signals = ProcessSignals::default();
    assert!(!record_process_name(&mut signals, "RIOTCLIENTSERVICES.EXE"));
    assert!(signals.riot_client_running);
    assert!(!signals.valorant_running);
    assert!(record_process_name(
        &mut signals,
        "Valorant-Win64-Shipping.exe"
    ));
    assert_eq!(signals, ProcessSignals {
        riot_client_running: true,
        valorant_running: true,
    });
}
```

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run: `cargo test --test detection process_matching_is_case_insensitive_and_stops_when_complete`

Working directory: `companion/src-tauri`

Expected: FAIL because `record_process_name` is undefined.

- [ ] **Step 3: Implement `ProcessDetector`**

Use `System::new()` once. On each `detect`, call the sysinfo 0.37 process-only refresh API with dead-process removal enabled. Iterate processes without building a `Vec<String>`, convert each `OsStr` with `to_string_lossy`, update signals through:

```rust
pub fn record_process_name(signals: &mut ProcessSignals, name: &str) -> bool {
    if name.eq_ignore_ascii_case("riotclientservices.exe") {
        signals.riot_client_running = true;
    } else if name.eq_ignore_ascii_case("valorant-win64-shipping.exe") {
        signals.valorant_running = true;
    }
    signals.riot_client_running && signals.valorant_running
}
```

Break as soon as it returns `true`.

- [ ] **Step 4: Thread one detector through the monitoring lifecycle**

Construct `let mut process_detector = ProcessDetector::new();` immediately inside the spawned monitoring task. Pass `&mut process_detector` to `detect_once`, `try_auto_resolve`, and `fetch_match_won`. Do not store it in global application state and do not alter `DetectorMemory`, cooldown, or transition logic.

- [ ] **Step 5: Run focused and full Rust tests**

Run: `cargo test --test detection`

Expected: all detection tests PASS.

Run: `cargo test`

Expected: all Tauri companion and `vap_core` dependency tests PASS.

- [ ] **Step 6: Verify the old allocation pattern is gone**

Run: `rg "System::new_all|Vec<String>" companion/src-tauri/src/process_detection.rs`

Expected: no matches.

- [ ] **Step 7: Commit**

```powershell
git add companion/src-tauri/src/process_detection.rs companion/src-tauri/src/valorant_detector.rs companion/src-tauri/src/commands.rs companion/src-tauri/tests/detection.rs
git commit -m "perf: reuse targeted process detection"
```

---

### Task 7: End-to-end Verification and Documentation Alignment

**Files:**
- Modify only if behavior text is inaccurate: `README.md`, `companion/README.md`

**Interfaces:**
- Consumes all prior task outputs; produces no new runtime API.

- [ ] **Step 1: Run all automated frontend verification**

Run from `companion`:

```powershell
npm run test:run
npm run build
```

Expected: every test passes and the production build exits 0.

- [ ] **Step 2: Run all Rust verification**

Run from `companion/src-tauri`:

```powershell
cargo test
```

Expected: every unit and integration test passes.

- [ ] **Step 3: Render and inspect normal and narrow layouts**

Run the Vite preview and inspect onboarding at 1280×720 and 560×720. Use deterministic frontend fixtures or development preview behavior for connected-state checks. Confirm:

- no horizontal overflow;
- all essential copy is legible;
- keyboard focus is visible;
- setup can move forward and back;
- backend recovery is distinct from onboarding;
- disabled Competitive preset explains why testing is unavailable; and
- reduced-motion mode suppresses decorative animation.

- [ ] **Step 4: Verify recurring-work improvements**

Confirm from tests and source that:

- hidden UI schedules no status or dashboard refresh;
- a slow refresh cannot overlap itself;
- one slider gesture calls `save_settings` once; and
- one monitoring lifecycle constructs one `ProcessDetector` and reuses its `System`.

- [ ] **Step 5: Check the final diff and documentation**

Run:

```powershell
git diff --check
git status --short
```

Update README wording only if setup or settings instructions became inaccurate. Do not add performance claims that were not measured.

- [ ] **Step 6: Commit any verification-driven documentation changes**

```powershell
git add README.md companion/README.md
git commit -m "docs: align setup guidance with improved companion"
```

Skip this commit when no documentation change is necessary.

