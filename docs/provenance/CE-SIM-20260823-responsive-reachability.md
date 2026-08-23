# CE-SIM-20260823 — Responsive reachability

## Task

- Date: 2026-08-23
- Objective: make every simulator region reachable on reduced browser windows,
  laptops, tablets, phones, and browser zoom without changing the scientific
  model.
- Author authorization: explicit request to make the complete application
  responsive after a domain stakeholder reported that the right-hand detector
  was clipped and could not be scrolled into view.
- Baseline Git revision: `b8a8f4bda52be580ad61bb320daa6a54f0687828`
- Publication authorization: not granted for this task; changes remain local.

## Inputs and observed failure

- User-provided stakeholder report: the detector at the right edge was not
  completely visible on a smaller computer display and no usable scroll option
  was apparent.
- Source files inspected:
  - `app/page.tsx`
  - `app/globals.css`
  - `app/components/app-nav.tsx`
  - `tests/dashboard-layout.test.ts`
- Observed constraints before the change:
  - viewport-locked `body`, application shell, and workspace;
  - non-wrapping header above the old 900 px breakpoint;
  - clipped left rail and only implicit right-rail scrolling;
  - stacked layout still constrained to `100dvh`;
  - mobile `display:block` restored the undesired DOM order and placed the
    detector after the left rail;
  - the Three.js canvas captured every wheel event, blocking document scroll;
  - Configuration Hub and the mobile pixel editor could exceed the viewport.

## Roles and tools

- Coordinator: Codex program coordinator.
- Independent read-only review:
  - `dt_architect`: responsive layout analysis, requirements, trade-offs, and
    acceptance criteria;
  - `simulator_engineer`: selector-level audit and problematic viewport list.
- Implementation tools: repository inspection with `rg`/`sed`, `apply_patch`,
  Git diff inspection, ESLint, Node test runner, Next.js static Pages build.
- Browser verification: local simulator through the in-app browser with
  explicit viewport overrides and DOM geometry checks.

## Requirements and implementation decisions

- `RSP-01 — Reachability`: all primary simulator panels and actions must be
  reachable; no global horizontal clipping is allowed.
- `RSP-02 — Desktop preservation`: screens wider than 1100 CSS px retain the
  three-column cockpit. Both rails use independent, visible vertical scrolling.
- `RSP-03 — Compact flow`: at 1100 px and below, the document becomes the only
  vertical scroll surface; the stage spans the width and the two rails follow.
- `RSP-04 — Phone order`: at 700 px and below the explicit order is 3D stage,
  detector/analysis, then Crystal Eye View. CSS Grid is retained instead of
  reverting to DOM flow.
- `RSP-05 — Detector integrity`: the configured detector projection keeps an
  aspect ratio of 1.18 in all layouts.
- `RSP-06 — Interaction`: wheel-to-zoom is desktop-only; in compact layouts the
  wheel over the 3D canvas scrolls the document and the visible zoom slider
  remains available.
- `RSP-07 — Configuration reachability`: Configuration Hub uses a viewport-
  bounded grid with a scrollable body. The mobile pixel editor keeps header and
  footer fixed while its body, canvas, and inspector remain scrollable.
- `RSP-08 — Header reachability`: header content wraps before it can force a
  wider document. Mobile navigation is a two-column grid and Configuration
  remains a labelled button.

The recommended hybrid layout was selected because it preserves simultaneous
desktop monitoring while avoiding nested scrolling on compact devices. A
drawer-based redesign was not introduced because it would add state and focus
management without being required for reachability.

## Files changed

- `app/globals.css`
  - responsive reachability layer;
  - explicit rail scrollbars and sticky photon heading on desktop;
  - header compaction/wrapping;
  - compact and mobile grid areas;
  - viewport-bounded configuration surfaces;
  - responsive data pages, detector summary, burst form, and pixel editor.
- `app/page.tsx`
  - canvas wheel capture is limited to the desktop cockpit.
- `tests/dashboard-layout.test.ts`
  - two regression tests for panel reachability, explicit ordering, wheel
    behavior, and scrollable configuration surfaces.

## Commands and results

Runtime used for verification:

`/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`

- `git diff --check`: pass.
- `npm run lint`: pass with zero errors and one pre-existing warning for the
  direct logo `<img>` used to avoid the incompatible local image optimizer.
- `npm test`: 106 tests passed, 0 failed.
- `npm run build:pages`: pass; all static routes generated.
- A standalone `tsc --noEmit` invocation reports the existing TS5097 test-file
  import configuration issue; the production Pages build TypeScript phase
  passes.

## Browser acceptance results

Tested viewports:

- 1920 × 1080
- 1440 × 900
- 1366 × 768
- 1280 × 720
- 1024 × 768
- 900 × 700
- 768 × 1024
- 568 × 320
- 390 × 844
- 360 × 800

Results:

- zero global horizontal overflow at every tested viewport;
- desktop right rail scrolls independently while the page remains fixed;
- compact scroll gestures over the 3D canvas move the document;
- detector is reachable and fully visible in the mobile flow;
- detector map measured aspect ratio: approximately 1.18;
- topbar, navigation, stage title, and camera controls do not overlap at
  390 × 844 after the mobile header correction;
- Configuration remains visibly labelled;
- Configuration Hub stays within the viewport;
- at 390 × 844 the pixel editor body is independently scrollable
  (`clientHeight` 675 px, `scrollHeight` 1396 px) while its header and footer
  remain accessible;
- no application error overlay was observed.

## Scope and limits

- This task changes layout and input routing only. Detector physics, ephemeris,
  background data, GRB generation, localization, and analysis calculations are
  unchanged.
- The responsive checks cover the listed representative viewport sizes; they
  are not an exhaustive device/browser certification matrix.
- Platform-native overlay scrollbars may still look different by operating
  system, but all required content remains reachable.
- No online deployment or GitHub publication was performed.

