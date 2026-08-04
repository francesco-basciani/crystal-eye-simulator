# CE-SIM-20260803 — Simulator UI reorganization

## Record

- **Date:** 2026-08-03 (Europe/Rome)
- **Task:** Reorganize the simulator UI without changing the scientific model,
  replay behavior, navigation, persistence, or data pages.
- **Approval:** AUTHOR-APPROVED task supplied by the author through the Crystal
  Eye coordinator.
- **Agent:** `simulator_engineer`-scoped implementation subtask.
- **Tools:** repository inspection with Git/Ripgrep, `apply_patch`, ESLint,
  Node test runner, Next.js static build, and local browser layout inspection.

## Requirements and acceptance criteria

1. **Detector Response visibility.** The configured 126-pixel planar map and
   the current expected response must be visible and readable. Acceptance:
   Detector Response owns the flexible row in the right panel, retains the
   configured `1.18` aspect ratio, renders 126 pixel controls, and exposes the
   selected pixel ID, total expected response, and background expected count.
2. **Single simulated UTC control.** Remove the duplicate Mission Control
   date control. Acceptance: exactly one `datetime-local` replay UTC control is
   rendered in the top-right title bar and remains bounded to the approved 2033
   replay interval.
3. **Playback controls in title bar.** Acceptance: pause/resume, slower,
   faster, and `1×`, `50×`, `200×`, `500×` presets are adjacent to simulated
   UTC.
4. **Remove non-functional indicators.** Acceptance: `SCIENCE MODE` and
   `LINK/NOMINAL` are absent from the rendered page.
5. **Move remaining Mission Control options.** Acceptance: the left-side
   Mission Control block is removed; replay status, derived mission metrics,
   provenance pointer, and reset-to-start action are available under
   Configuration → Mission and replay.
6. **Regression safety.** Acceptance: lint, full unit tests, and static build
   succeed with a repository-compatible Node runtime; ECI replay, navigation,
   IndexedDB implementation, and data pages remain unchanged.

## Inputs and decisions

- Existing working tree on 2026-08-03, including uncommitted ECI replay,
  photon persistence, data-page, navigation, and pixel-configuration work.
- No new dependency, dataset, physical formula, or physical constant was
  introduced.
- The light curve and celestial-interference readout were moved into the left
  monitoring column so the detector map can own the right panel's flexible
  space. This is presentation-only; their inputs and calculations are
  unchanged.
- Prominent `PROVISIONAL` wording was removed from live UI labels. Scientific
  status is not upgraded: the Configuration mission panel points to durable
  provenance, and the pre-existing scientific provenance records remain the
  authority for model status and limitations.
- Replay reset starts a new run at the first loaded ECI sample, using the
  pre-existing `resetSimulation` behavior. Replay UTC editing remains in the
  single top-bar control.

## Files changed

- `app/page.tsx` — title-bar playback and UTC controls; Configuration mission
  item/panel; left/right panel reorganization; selected detector-response
  summary; removal of non-functional status indicators and prominent status
  wording.
- `app/globals.css` — accessible controls, configuration panel, detector
  sizing, responsive layout, and presentation styles.
- `docs/provenance/CE-SIM-20260803-ui-reorganization.md` — this record.

No files under `Materiale/`, `Appunti/`, or the manuscript were changed.

## Verification

The shell initially resolved Node `v16.20.2`, below the repository requirement
(`>=22.13.0`). That runtime could not start ESLint, the TypeScript test runner,
or Next.js. Checks were therefore executed using an ephemeral Node `v22.19.0`
runtime through `npx`; repository dependencies and manifests were not changed.

- `git diff --check` — passed.
- `npx --yes --package node@22.19.0 --call 'npm run lint'` — passed.
- `npx --yes --package node@22.19.0 --call 'npm test'` — passed: 16 tests,
  16 passed, 0 failed.
- `npx --yes --package node@22.19.0 --call 'npm run build:pages'` — passed;
  TypeScript passed and static routes `/`, `/ephemeris`, and
  `/photon-history` were generated.
- Local browser, `1280 × 720` — Detector section `329 × 347.26 px`; configured
  map `327.15 × 277.25 px`; ratio `1.17998`; 126 pixels; one UTC input;
  `SCIENCE MODE`, `MISSION CONTROL`, and `NOMINAL` absent.
- Local browser, `900 × 900` — map `337.77 × 286.25 px`; 126 pixels; UTC input
  visible.
- Local browser, `620 × 900` — Detector section `619 × 360 px`; map
  `342.20 × 290 px`; ratio `1.17998`; 126 pixels.

## Assumptions, limits, and open validation

- `actual expected response` denotes the simulator's existing composed
  expected-count value for the current 0.2 s bin; this task does not reinterpret
  it as measured detector data or validated physics.
- The top-bar slower/faster controls select the next lower/higher approved UI
  preset; direct presets remain the authoritative discrete values.
- Browser inspection covered the stated representative viewports. It did not
  perform exhaustive device/browser visual regression or screen-reader testing.
- Pixel-background and celestial-interference scientific status remains as
  documented in the pre-existing provenance records and still requires the
  existing domain-validation/author-approval gates where applicable.
