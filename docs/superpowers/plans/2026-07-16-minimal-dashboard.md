# Minimal Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the connected ValorPredict workspace to a status-first dashboard with two preset rows and one collapsed secondary-content area.

**Architecture:** Keep the existing detector and dashboard polling paths independent. Simplify presentation inside `MonitorSection`, `ActivePrediction`, and `PredictionsDashboard`; no backend endpoint or polling frequency changes are required. CSS removes decorative atmosphere and turns secondary cards into flat, separated content.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS, Tauri 2, Rust integration tests.

## Global Constraints

- Default hierarchy is “status, presets, done.”
- Solid connected-dashboard background is `#090A0C`; the primary surface is `#111216`.
- Valorant red `#FF4655` is reserved for the primary action, live predictions, and errors.
- Keep bootstrap recovery, onboarding behavior, visibility-aware polling, and settings batching unchanged.
- Do not add backend endpoints, WebSockets, navigation, charts, or animations.
- Preserve visible keyboard focus, reduced-motion behavior, and a 560px minimum layout without horizontal overflow.
- Existing capabilities remain available; secondary actions move behind disclosures.

---

### Task 1: Hide idle prediction chrome and group secondary prediction tools

**Files:**
- Modify: `companion/src/components/predictions/ActivePrediction.tsx`
- Modify: `companion/src/components/predictions/PredictionsDashboard.tsx`
- Modify: `companion/src/components/predictions/PredictionsDashboard.test.tsx`

**Interfaces:**
- Consumes: existing `PredictionSession`, `DashboardData`, `companionApi`, and `useVisiblePolling` interfaces.
- Produces: `ActivePrediction` returns `null` unless `activeSession.status === "prediction_open"`; `PredictionsDashboard` renders a native `details.more-disclosure` containing test, activity, and settings content.

- [ ] **Step 1: Write failing dashboard hierarchy tests**

Add a live session fixture and tests that require idle prediction chrome to disappear, live controls to remain, and secondary tools to be visually hidden until More opens:

```tsx
import type { DashboardData, PredictionSession } from "../../types";

const liveSession: PredictionSession = {
  id: 7,
  twitch_user_id: "42",
  status: "prediction_open",
  twitch_prediction_id: "prediction-7",
  outcome_a_label: "Win",
  outcome_b_label: "Loss",
  title: "Will test_streamer win?",
  started_at: "2026-07-16T20:00:00Z",
  resolved_at: null,
  result: null,
  channel_points_wagered: 0,
  created_at: "2026-07-16T20:00:00Z",
  updated_at: "2026-07-16T20:00:00Z",
};

function openMore() {
  fireEvent.click(screen.getByText("More"));
}

it("does not render an empty current-prediction card", async () => {
  render(<PredictionsDashboard />);
  await screen.findByText("Prediction presets");
  expect(screen.queryByText("Current prediction")).not.toBeInTheDocument();
  expect(screen.queryByText("Waiting for a match")).not.toBeInTheDocument();
});

it("keeps live prediction resolution controls visible", async () => {
  vi.mocked(companionApi.getDashboard).mockResolvedValue({
    ...dashboard,
    activeSession: liveSession,
  });
  render(<PredictionsDashboard />);
  expect(await screen.findByText("Current prediction")).toBeVisible();
  expect(screen.getByRole("button", { name: /Resolve.*Win/i })).toBeVisible();
});

it("keeps occasional tools inside More", async () => {
  render(<PredictionsDashboard />);
  const more = await screen.findByText("More");
  expect(screen.getByText("Recent prediction activity")).not.toBeVisible();
  fireEvent.click(more);
  expect(screen.getByText("Recent prediction activity")).toBeVisible();
  expect(screen.getByRole("slider", { name: "Detection polling interval" })).toBeVisible();
});
```

Update the three existing safeguard tests to call `openMore()` before querying the test button or settings slider.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd run test:run -- src/components/predictions/PredictionsDashboard.test.tsx
```

Expected: FAIL because the idle card renders, there is no More summary, and secondary tools are visible by default.

- [ ] **Step 3: Implement the minimal hierarchy**

In `ActivePrediction`, return nothing for an idle/non-open session before rendering the existing live controls:

```tsx
const active = activeSession?.status === "prediction_open";
if (!active || !activeSession) return null;

return (
  <section className="active-card is-live" aria-label="Live prediction">
    <div className="preset-head">
      <div>
        <span className="card-kicker">Twitch channel</span>
        <h3>Current prediction</h3>
      </div>
      <span className="status-pill live"><i />Live</span>
    </div>
    <div className="active-copy">
      <strong>{activeSession.title}</strong>
      <span>Started {formatDate(activeSession.started_at)}</span>
    </div>
    <div className="resolution-row">
      <button className="button secondary" type="button" disabled={busy} onClick={() => onResolve("A")}>
        Resolve — {activeSession.outcome_a_label || "Outcome A"}
      </button>
      <button className="button secondary" type="button" disabled={busy} onClick={() => onResolve("B")}>
        Resolve — {activeSession.outcome_b_label || "Outcome B"}
      </button>
    </div>
    <button className="button danger wide" type="button" disabled={busy} onClick={onCancel}>
      Cancel prediction
    </button>
  </section>
);
```

In `PredictionsDashboard`, keep the live `ActivePrediction` immediately before the preset heading, keep both preset rows visible, and wrap occasional tools in one disclosure:

```tsx
<ActivePrediction
  activeSession={data.activeSession}
  busy={busy}
  onResolve={(winner) =>
    run(() => companionApi.resolvePrediction(winner), "Prediction resolved.")
  }
  onCancel={() =>
    run(() => companionApi.cancelPrediction(), "Prediction cancelled.")
  }
/>

<div className="panel-heading">
  <h2>Prediction presets</h2>
  <span className="quiet-count">{enabledCount}/2 enabled</span>
</div>
<div className="preset-list">
  {competitive && (
    <PresetCard preset={competitive} busy={busy} onSave={(input) => savePreset("competitive", input)} />
  )}
  {custom && (
    <PresetCard preset={custom} busy={busy} onSave={(input) => savePreset("custom", input)} />
  )}
</div>

<details className="more-disclosure">
  <summary>More</summary>
  <div className="more-content">
    <div className="test-row">
      <button
        className="button primary"
        type="button"
        disabled={busy || !competitiveReady}
        onClick={() => run(() => companionApi.simulateMatchStart("competitive"), "Test prediction sent.")}
      >
        {competitiveReady ? "Send test prediction" : "Enable Competitive to test"}
      </button>
      <small>
        {competitiveReady
          ? "Opens a real prediction from your Competitive preset so you can confirm everything works — cancel it below anytime."
          : "Enable your Competitive preset before sending a real test prediction."}
      </small>
    </div>
    <EventsCard events={data.events} />
    <div className="settings-section">
      <label className="poll-setting">
        <span>Detection polling — higher is lighter on your PC</span>
        <div className="range-row">
          <input
            type="range"
            min={10}
            max={60}
            step={5}
            value={pollInterval}
            disabled={busy}
            aria-label="Detection polling interval"
            aria-invalid={settingsSaveFailed}
            onChange={(event) => {
              setPollInterval(Number(event.target.value));
              setSettingsSaveFailed(false);
            }}
            onPointerUp={() => void persistPollInterval()}
            onKeyUp={() => void persistPollInterval()}
            onBlur={() => void persistPollInterval()}
          />
          <strong>{pollInterval}s</strong>
        </div>
      </label>
    </div>
  </div>
</details>
```

Do not add state or API calls for opening More; native disclosure state changes presentation only.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused Vitest command. Expected: all dashboard tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/components/predictions/ActivePrediction.tsx companion/src/components/predictions/PredictionsDashboard.tsx companion/src/components/predictions/PredictionsDashboard.test.tsx
git commit -m "feat: simplify prediction dashboard hierarchy"
```

---

### Task 2: Simplify detector status and collapse development diagnostics

**Files:**
- Create: `companion/src/components/MonitorSection.test.tsx`
- Modify: `companion/src/components/MonitorSection.tsx`

**Interfaces:**
- Consumes: existing `DetectionStatus`, `SafeUser`, `companionApi`, `StatusGrid`, and `LogPanel`.
- Produces: a primary status panel with facts labeled `Valorant`, `State`, and `Mode`; a closed `details.diagnostics-disclosure` in development builds.

- [ ] **Step 1: Write the failing monitor test**

Mock `companionApi.getStatus` with a monitoring/idle state and assert the simplified facts and collapsed diagnostics:

```tsx
it("shows only the essential detector facts and collapses diagnostics", async () => {
  render(<MonitorSection user={user} onReconnect={vi.fn()} />);

  expect(await screen.findByRole("heading", { name: "Waiting for Valorant" })).toBeVisible();
  expect(screen.getByText("Valorant")).toBeVisible();
  expect(screen.getByText("State")).toBeVisible();
  expect(screen.getByText("Mode")).toBeVisible();
  expect(screen.queryByText("Cooldown")).not.toBeInTheDocument();

  const diagnostics = screen.getByText("Diagnostics");
  expect(screen.getByText(/Raw detection signals/i)).not.toBeVisible();
  fireEvent.click(diagnostics);
  expect(screen.getByText(/Raw detection signals/i)).toBeVisible();
});
```

The test mock must include `getStatus`, `startMonitoring`, `stopMonitoring`, `resetCooldown`, `clearLogs`, and `connectTwitch`. Mock `useWindowVisible` to return `true`.

- [ ] **Step 2: Run the monitor test and verify RED**

```powershell
npm.cmd run test:run -- src/components/MonitorSection.test.tsx
```

Expected: FAIL because Cooldown still renders and diagnostics are always expanded.

- [ ] **Step 3: Implement the simplified status content**

Replace the status strip with:

```tsx
<dl className="status-strip">
  <div>
    <dt>Valorant</dt>
    <dd className={status.valorantRunning ? "good" : ""}>
      {status.valorantRunning ? "Running" : "Not running"}
    </dd>
  </div>
  <div>
    <dt>State</dt>
    <dd className={status.localState === "current_game" ? "live" : ""}>
      {formatLabel(status.localState)}
    </dd>
  </div>
  <div>
    <dt>Mode</dt>
    <dd className={status.gameMode !== "unknown" ? "good" : ""}>
      {modeLabel}
    </dd>
  </div>
</dl>
```

Shorten the healthy supporting sentence to `Monitoring runs in the tray while you play.` Keep the paused instruction and existing action behavior.

Wrap the existing development telemetry, controls, and logs without changing their commands:

```tsx
{developmentMode && (
  <details className="diagnostics-disclosure">
    <summary>Diagnostics</summary>
    <section className="developer-zone">
      <div className="developer-heading">
        <span>Detector telemetry</span>
        <p>Raw detection signals and sanitized runtime logs.</p>
      </div>
      <StatusGrid status={status} />
      <div className="control-grid">
        <button className="button secondary" disabled={busy || status.monitoring} onClick={() => run(companionApi.startMonitoring)}>
          Start Monitoring
        </button>
        <button className="button secondary" disabled={busy || !status.monitoring} onClick={() => run(companionApi.stopMonitoring)}>
          Stop Monitoring
        </button>
        <button className="button secondary" disabled={busy} onClick={() => run(companionApi.resetCooldown)}>
          Reset Cooldown
        </button>
        <button className="button secondary" disabled={busy} onClick={() => run(companionApi.clearLogs)}>
          Clear Logs
        </button>
      </div>
      <LogPanel logs={status.logs} onClear={() => run(companionApi.clearLogs)} />
    </section>
  </details>
)}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the monitor test. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/components/MonitorSection.tsx companion/src/components/MonitorSection.test.tsx
git commit -m "feat: focus dashboard on essential status"
```

---

### Task 3: Remove decorative chrome and enforce the minimum window contract

**Files:**
- Modify: `companion/src/styles.css`
- Modify: `companion/src/styles.test.ts`
- Modify: `companion/src-tauri/tauri.conf.json`
- Modify: `companion/src-tauri/tests/milestone_one.rs`

**Interfaces:**
- Consumes: the class names produced in Tasks 1 and 2.
- Produces: solid connected workspace styling, flat preset rows, one primary status surface, responsive More/diagnostics disclosures, and matching 560x640 Tauri minimums.

- [ ] **Step 1: Write failing style and window-contract tests**

Add to `styles.test.ts`:

```ts
it("uses a solid minimal workspace without decorative viewport layers", () => {
  expect(styles).toMatch(/body\s*\{[^}]*background:\s*#090a0c/s);
  expect(styles).not.toContain("body::before");
  expect(styles).not.toContain("body::after");
  expect(styles).toContain(".more-disclosure");
  expect(styles).toContain(".diagnostics-disclosure");
});
```

Add to `milestone_one.rs`:

```rust
#[test]
fn configured_and_rebuilt_windows_share_minimum_size() {
    let config = include_str!("../tauri.conf.json");
    let window_builder = include_str!("../src/lib.rs");
    assert!(config.contains(r#"\"minWidth\": 560"#));
    assert!(config.contains(r#"\"minHeight\": 640"#));
    assert!(window_builder.contains(".min_inner_size(560.0, 640.0)"));
}
```

- [ ] **Step 2: Run both focused tests and verify RED**

```powershell
npm.cmd run test:run -- src/styles.test.ts
cargo test configured_and_rebuilt_windows_share_minimum_size
```

Expected: CSS test FAILS on decorative layers/current background; Rust test FAILS because `tauri.conf.json` still contains 760x680.

- [ ] **Step 3: Implement the restrained visual system**

Set the body to a solid background and delete both decorative pseudo-elements:

```css
body {
  min-width: 560px;
  min-height: 100vh;
  margin: 0;
  color: var(--text);
  background: #090a0c;
  -webkit-font-smoothing: antialiased;
}
```

Use these layout rules as the source of truth, removing or overriding older duplicate dashboard selectors:

```css
.companion-shell { width:min(920px,calc(100% - 48px)); padding:24px 0 40px; }
.companion-header { margin-bottom:32px; }
.status-card { padding:28px; border:1px solid #26282d; border-radius:18px; background:#111216; box-shadow:none; }
.status-card__main h1 { color:#f3f2ef; background:none; -webkit-text-fill-color:initial; }
.status-strip { border:0; border-top:1px solid #26282d; border-radius:0; background:transparent; }
.predictions-panel { margin-top:24px; }
.preset-list { border-top:1px solid #26282d; }
.preset-row { border:0; border-bottom:1px solid #26282d; border-radius:0; background:transparent; }
.active-card { margin-top:-1px; padding:22px 28px; border:1px solid rgba(255,70,85,.32); border-radius:0 0 18px 18px; background:#111216; }
.more-disclosure,.diagnostics-disclosure { border-top:1px solid #26282d; background:transparent; }
.more-disclosure summary,.diagnostics-disclosure summary { min-height:40px; color:var(--muted-bright); }
.events-card { padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
```

Keep one-column reflow at 700px, 40px primary controls, focus-visible outlines, and reduced-motion rules. Remove obsolete empty-prediction, dashed test-row, glass card, starfield, and heading-gradient styling when no remaining component uses it. Do not alter onboarding-specific `.wizard-*`, `.bootstrap-*`, field, or button behavior.

Change `tauri.conf.json` to `"minWidth": 560` and `"minHeight": 640` so initial and tray-rebuilt windows match.

- [ ] **Step 4: Run focused and full verification**

```powershell
npm.cmd run test:run -- src/styles.test.ts
cargo test configured_and_rebuilt_windows_share_minimum_size
npm.cmd run test:run
npm.cmd run build
cargo test
```

Expected: all frontend tests PASS, production build exits 0, and all Rust tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add companion/src/styles.css companion/src/styles.test.ts companion/src-tauri/tauri.conf.json companion/src-tauri/tests/milestone_one.rs
git commit -m "style: make dashboard clean and minimal"
```

---

### Task 4: Rendered usability verification

**Files:**
- Modify only if a rendered defect is found: files from Tasks 1–3 and their corresponding tests.

**Interfaces:**
- Consumes: the completed connected dashboard.
- Produces: evidence that the dashboard is readable, keyboard accessible, and overflow-free at supported desktop sizes.

- [ ] **Step 1: Start the real Tauri development app**

```powershell
npm.cmd run tauri -- dev
```

Use existing local app data; do not delete, rename, or overwrite saved credentials.

- [ ] **Step 2: Inspect the healthy default view**

Confirm visually that only the compact header, primary status area, attention state when applicable, preset rows, More summary, and development Diagnostics summary are visible. Confirm no decorative background, empty prediction card, recent activity card, settings slider, or test-prediction panel competes in the default view.

- [ ] **Step 3: Inspect interaction states**

Open More and Diagnostics, tab through controls, and verify visible focus. Open and cancel a preset edit without saving. Do not send a real test prediction or mutate Twitch state during visual QA.

- [ ] **Step 4: Inspect 560x640 behavior**

Resize to the configured minimum. Confirm `document.documentElement.scrollWidth <= window.innerWidth`, readable labels, no clipped buttons, and orderly wrapping of status facts and preset rows.

- [ ] **Step 5: Fix any defect test-first and rerun the complete gate**

For any observed defect, add a failing component/style test first, make the smallest fix, then rerun:

```powershell
npm.cmd run test:run
npm.cmd run build
cargo test
git diff --check
```

Expected: zero failing tests, build exit 0, Rust test exit 0, and no whitespace errors.

- [ ] **Step 6: Commit rendered-QA fixes if needed**

```powershell
git add companion/src/components/MonitorSection.tsx companion/src/components/MonitorSection.test.tsx companion/src/components/predictions/ActivePrediction.tsx companion/src/components/predictions/PredictionsDashboard.tsx companion/src/components/predictions/PredictionsDashboard.test.tsx companion/src/styles.css companion/src/styles.test.ts companion/src-tauri/tauri.conf.json companion/src-tauri/tests/milestone_one.rs
git commit -m "fix: polish minimal dashboard layout"
```

If no files changed, do not create an empty commit.
