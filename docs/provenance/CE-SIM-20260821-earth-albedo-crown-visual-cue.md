# CE-SIM-20260821 — Earth-albedo outer-crown visual cue

- Date: 2026-08-21
- Objective: make weak Earth-reflected photon detections visibly identifiable on the exposed outer crown without changing simulated counts.
- Author decision: `AUTHOR-APPROVED` through the explicit request in the task.
- Scope: presentation layer and selected-pixel readout; no change to photon allocation, detector totals, history, celestial geometry, or platform occlusion.
- Publication: not performed.

## Implementation

- The existing `detectorEarthExpectedCounts` vector remains the authoritative per-physical-ID Earth component.
- A pure display helper separates `Earth-only` excitation from Earth overlapping Sun, Moon, or GRB excitation.
- Earth-only pixels use a restrained blue-to-cyan blend capped in the low-impact visual range and receive no normal active-source mesh enlargement.
- Overlap pixels retain the dominant source color and receive only a thin cyan outline in the planar map.
- Burst overlap retains the existing highest-priority burst styling.
- The selected-pixel summary now reports the actual Earth-albedo expected counts per 0.2 s bin.
- Center mounting, inner pixels, covered crown pixels, and nightside geometry still produce no Earth cue because their Earth vector is zero.

## Files

- `app/lib/detector-visual-response.ts`
- `app/page.tsx`
- `app/globals.css`
- `tests/detector-visual-response.test.ts`
- `tests/dashboard-layout.test.ts`

## Verification

```text
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit --allowImportingTsExtensions
npm run build:pages
```

- Full automated suite: `95/95 PASS` before the final styling-priority refinement.
- Final targeted albedo/layout suite: `19/19 PASS`.
- ESLint: `PASS`, zero warnings.
- TypeScript: `PASS`.
- GitHub Pages static build: `PASS`.
- Browser visual QA: not performed.

## Status and limitations

- Counts and component wiring: unchanged.
- Display-state logic: `VERIFIED` by automated tests.
- Visual cue strength: `PROVISIONAL` UI parameter, not a calibrated photon-to-luminance mapping.
- Outer-crown assignment uses the current V2R8 candidate-to-sphere projection and still requires physics-domain validation.
