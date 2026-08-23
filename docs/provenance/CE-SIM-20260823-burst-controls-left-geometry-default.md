# CE-SIM-20260823 — Burst controls in left rail and Geometry default

## Task

- Date: 2026-08-23
- Objective: make the test-burst controls prominent in the left dashboard rail and open Crystal Eye View on its Geometry tab.
- Author instruction: move the existing burst test panel to the left column, reduce/recompose the existing left-column height allocation, and make Geometry the first and initially active tab.
- Interpretation: the repeated “left” in the request was treated as a wording error because the panel was observed in the right rail before this change; the requested destination is the left rail.

## Inputs and observed state

- Repository revision before this task: `8db464e`.
- Existing implementation: `TEST BURST CONFIGURATION` rendered after the detector map in the right rail; Crystal Eye View initialized to `mask`; tab order was Sky, Mask, Events, Geometry.
- No external datasets, physical parameters, dependencies, or services were introduced.

## Decision and implementation

- Moved the existing form without changing its fields, validation bounds, event handlers, random injection path, or deterministic test-burst path.
- Positioned the form before Crystal Eye View in the left rail so it remains immediately visible on the three-column desktop layout.
- Reallocated the left sensor slot from 65%/220 px minimum to 55%/200 px minimum. Existing independent rail scrolling and compact document scrolling remain available when vertical space is insufficient.
- Set `geometry` as the initial `SensorViewMode` and changed the visible tab order to Geometry, Sky, Mask, Events.
- Updated compact-height selectors from the former right-rail location to the new left-rail location.

## Files changed

- `app/page.tsx`
- `app/globals.css`
- `tests/dashboard-layout.test.ts`
- `docs/provenance/CE-SIM-20260823-burst-controls-left-geometry-default.md`

## Verification

- ESLint: completed with zero errors and one pre-existing `next/image` advisory for the supplied logo.
- TypeScript: `npx tsc --noEmit` passed.
- Automated tests: 109/109 passed, including a new structural regression test for rail ownership, order, and default tab.
- GitHub Pages static build: passed; all five application routes were generated.
- Browser QA at 1280×720: burst panel is first in the left rail, Geometry is pressed by default, no right-rail burst duplicate, no horizontal overflow, and no browser console errors.
- Browser QA at 390×844: all five burst inputs and Geometry view remain present in normal document scroll, with no horizontal overflow.

## Scientific impact and limits

- This is a presentation and navigation change only. Detector geometry, celestial mechanics, photon response, burst injection, and direction reconstruction were not modified.
- Geometry remains the existing engineering schematic with its existing provisional scientific status.
- The change was committed locally only. Publication to GitHub or GitHub Pages was not authorized by this task.
