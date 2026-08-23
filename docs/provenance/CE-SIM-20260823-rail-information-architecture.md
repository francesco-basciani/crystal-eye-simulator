# CE-SIM-20260823 — Dashboard rail information architecture

## Task

- Date: 2026-08-23.
- Objective: make the left and right dashboard rails semantically coherent, give every rail window a visible and consistent heading, return the test-burst controls to the right rail, and preserve responsive reachability.
- Repository revision before the task: `594157a`.
- Author approval: explicit approval of Option A after reviewing the alternatives and trade-offs.

## Approved decision

- Left rail — **Observation Context**: Crystal Eye View with Geometry first/default, followed by compact Celestial Interference.
- Right rail — **Injection & Science Response**: Test Burst Configuration, Detector Response, Photon Stream / Adaptive Background Analysis, Burst Direction Reconstruction, and compact Data & Archive Status.
- The ordering follows the causal workflow: configure a source, inspect the pixel response, inspect the time stream, then inspect the derived direction.
- The right rail is intentionally longer than the left rail; independent desktop scrolling and document scrolling at compact breakpoints keep every panel reachable.

## Implementation

- Moved the unchanged test-burst form from the left rail to the top of the right workflow.
- Placed Detector Response immediately after the injection controls and before time-series analysis.
- Integrated the photon-history entry point and row count into the Adaptive Background Analysis heading.
- Kept Burst Direction Reconstruction as a distinct, titled result section.
- Consolidated persistence and background-source diagnostics into one compact panel, collapsed by default.
- Added accessible collapse controls to Burst, Celestial Interference, Detector Response, Adaptive Background Analysis, Burst Direction Reconstruction, and diagnostic status. Primary scientific and control panels are expanded by default.
- Introduced a shared rail-window title hierarchy: 7 px category, 11 px title, common minimum header height, spacing, border, and actions.
- Preserved Geometry as the first and initially active Crystal Eye View tab.
- Preserved responsive order at compact widths: 3D stage, right rail, left rail.
- No detector, photon, celestial, burst-injection, filtering, or reconstruction algorithm was changed.

## Files changed

- `app/page.tsx`
- `app/components/adaptive-analysis-panel.tsx`
- `app/globals.css`
- `tests/dashboard-layout.test.ts`
- this execution record

## Verification

- TypeScript: bundled Node.js runtime, `node_modules/typescript/bin/tsc --noEmit` — passed.
- ESLint on changed TypeScript files: zero errors; one pre-existing advisory for the direct logo `<img>`.
- Automated tests: 110/110 passed, including updated rail ownership/order and unified-heading regression tests.
- GitHub Pages static build: passed; all five application routes were generated.
- `git diff --check`: passed.
- Browser QA was initially unavailable in the implementation-agent session (`agent.browsers.list()` returned an empty list), so no alternate browser-control backend was substituted there.
- The coordinating agent completed browser QA at 1280 × 720: both rail headings are visible, window headings are readable, the left order is View → Celestial, the right order is Burst → Detector → Analysis → Diagnostics, and no console error was observed.
- The coordinating agent completed browser QA at 390 × 844: responsive document order is 3D stage → right rail → left rail, Burst/Detector/Adaptive sections are reachable through vertical scrolling, Geometry is initially active, and horizontal overflow is zero.

## Scientific impact and limits

- This is a presentation, navigation, and responsive-layout change only.
- Existing labels such as `PROVISIONAL`, truth-withheld evaluation, and non-flight-telemetry warnings remain unchanged.
- No scientific capability is newly claimed or validated by this task.
- The change is committed locally only. Publication to GitHub or GitHub Pages was not authorized.
