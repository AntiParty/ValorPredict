# Minimal Dashboard Design

## Goal

Make the connected ValorPredict workspace calm and immediately understandable. The dashboard should answer two questions without scrolling or interpretation:

1. Is ValorPredict ready and monitoring?
2. Which prediction presets are enabled?

All existing capabilities remain available, but secondary information must not compete with those answers.

## Product principles

- Show status before configuration.
- Use one primary surface, not a collection of equally weighted cards.
- Render information only when it is useful. Healthy states do not need banners.
- Keep frequent actions visible and move occasional actions behind one disclosure.
- Use plain language and sentence case.
- Preserve keyboard access, reduced-motion behavior, and the 560px minimum layout.

## Information hierarchy

The connected workspace uses this order:

1. Compact header with the ValorPredict brand and Twitch account.
2. One status panel with the current monitoring state, one monitoring action, and three facts: Valorant, detector state, and mode.
3. An attention message only when Twitch, monitoring, or detection needs action.
4. Live prediction controls visually attached to the primary status area when a prediction is open. No empty prediction card is shown when idle.
5. Two simple preset rows: Competitive and Custom.
6. One collapsed **More** disclosure containing test prediction, recent activity, polling settings, and development-only diagnostics.

The default healthy dashboard should read as “status, presets, done.”

## Visual system

The dashboard retains the existing local desktop identity but removes decorative atmosphere and excessive chrome.

- Background: solid ink `#090A0C`.
- Primary surface: elevated ink `#111216`.
- Separators: hairline `#26282D`.
- Primary text: chalk `#F3F2EF`.
- Secondary text: ash `#8D8F96`.
- Accent: Valorant red `#FF4655`, reserved for the primary action, live predictions, and errors.
- Success green remains available for concise healthy-state indicators.

There is no coordinate grid, starfield, glass gradient, ambient glow, heading gradient, or decorative card shadow on the connected dashboard. Aptos Display is used sparingly for the current state. Aptos is used for controls and readable copy. Cascadia is limited to compact status labels.

The status panel is the only prominent rounded surface. Presets and secondary content use plain rows and separators. Pills are used only when they convey a real state.

## Component behavior

### Header

The header stays small and contains only the brand and connected Twitch identity. It does not add navigation.

### Status panel

The status panel owns the strongest hierarchy. Its title is the current plain-language state, such as “Ready when you queue,” “Monitoring is paused,” or “Match detected.” Supporting copy is limited to one short sentence.

The monitoring button is the only primary button in the default view. Three compact facts report Valorant state, detector state, and supported game mode.

When a prediction is live, its title, outcome resolution actions, and cancellation action appear as a visually connected extension directly below the status panel. When no prediction is live, no prediction surface is shown.

### Attention states

At most two attention messages may appear. Each message explains the problem and provides a direct action when one exists. Healthy conditions render nothing.

### Presets

Competitive and Custom appear as two flat rows separated by hairlines. Each row shows its name, shortened title, on/off toggle, and Edit action. Editing may expand the selected row into the existing form; the other row remains collapsed.

### More disclosure

The single collapsed **More** section contains:

- Send test prediction action and its safety explanation.
- Recent prediction activity.
- Detection polling setting.
- Detector telemetry and logs in development builds only, inside a nested Diagnostics disclosure.

Opening More must not change polling behavior or trigger extra requests. It only changes presentation.

## Data flow and implementation boundaries

The dashboard continues using the existing visibility-aware polling hooks and backend commands. The detector and prediction polling paths remain independent so this visual simplification does not introduce extra requests or coordination work.

`MonitorSection` remains responsible for detector status and monitoring actions. `PredictionsDashboard` remains responsible for presets, activity, settings, active prediction rendering, and prediction mutations. CSS and component order create the connected visual hierarchy; no shared data layer, new backend endpoint, or faster polling is introduced.

Presentation state for preset editing and disclosures stays local to the relevant component. Background refreshes must not overwrite a preset while it is being edited.

## Error handling

- Existing bootstrap recovery remains unchanged.
- Mutation failures appear next to the affected area in plain language.
- Failed settings saves continue to preserve the visible unsaved value and identify it as unsaved.
- A failed polling request does not replace valid existing dashboard data.
- The More disclosure remains usable when activity or settings loading fails.

## Accessibility and responsive behavior

- Preserve visible `:focus-visible` treatment.
- Maintain at least 40px control height for primary actions.
- Do not rely on color alone for live, enabled, success, or error states.
- At 560px, status facts stack or wrap without horizontal overflow.
- Preset rows reflow into a simple two-column arrangement with Edit taking a full row only when necessary.
- Honor `prefers-reduced-motion`.

## Testing and verification

Implementation follows test-first changes for observable behavior:

- Idle predictions do not render a standalone empty card.
- Live prediction controls appear directly after the primary status area.
- Test prediction, activity, settings, and diagnostics are hidden until More opens.
- Preset toggles and edit behavior remain available.
- Existing polling and settings-save tests continue to pass.

Final verification includes the complete frontend test suite, production build, Rust test suite, and rendered checks at desktop width and 560px with keyboard focus and horizontal overflow inspection.

## Out of scope

- Backend API changes.
- WebSocket transport.
- New navigation, analytics, charts, or animations.
- Changes to onboarding styling beyond shared tokens required to prevent regressions.
- Removal of existing features.
