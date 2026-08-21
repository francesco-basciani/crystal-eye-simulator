# CE-SIM-20260821 — System Geometry directional layout correction

- Date: 2026-08-21
- Objective: remove the misleading placement of Sun and Moon inside the displayed LEO orbit in the portrait `Crystal Eye View → Geometry` panel.
- Author decision: `AUTHOR-APPROVED` through the explicit correction request and supplied screenshot.
- Scope: display geometry and regression tests only; no changes to ECI ephemeris, celestial mechanics, detector response, FOV, or albedo.
- Publication: not performed.

## Observed defect

The orbit ellipse used radii proportional to the full viewport width and height. Sun and Moon used independent distances based on `min(width, height)` and an additional vertical compression. In a portrait panel this placed both celestial markers inside the illustrative satellite orbit even though their inputs were the correct geocentric ECI directions.

## Implemented correction

- Earth and the illustrative LEO ring now occupy a compact circular inner region derived from the smaller viewport dimension.
- The satellite remains on the inner LEO ring.
- Moon and Sun are direction markers on distinct outer rings, with the invariant `Sun radius > Moon radius > satellite-orbit radius`.
- Labels state `DIRECTION TO` rather than implying that the displayed radius is physical distance.
- The panel states `ECI X–Z DIRECTION SCHEMATIC · RADIAL DISTANCES NOT TO SCALE` prominently.
- Directions nearly perpendicular to the ECI X–Z display plane are explicitly flagged as out of plane.
- The Geometry view continues to consume `geocentricSunDirection` and `geocentricMoonDirection`.

## Files

- `app/lib/system-geometry-projection.ts`
- `app/page.tsx`
- `tests/system-geometry-projection.test.ts`
- `tests/dashboard-layout.test.ts`

## Verification

Bundled Node.js runtime v24.19.0:

```text
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit --allowImportingTsExtensions
npm run build:pages
```

- Automated tests: `90/90 PASS` before the final portrait-bound regression addition; the added test is covered by the final targeted rerun.
- ESLint: `PASS`, zero warnings.
- TypeScript: `PASS`.
- GitHub Pages static build: `PASS`.
- Browser screenshot QA: not performed.

## Status and limitations

- Layout invariant and wiring: `VERIFIED` by automated tests.
- Celestial vectors: unchanged from the approved bounded ECI replay.
- Diagram: intentionally schematic and not a physical distance plot.
- The orbit ring is illustrative and does not claim to show the projected osculating orbit plane.
