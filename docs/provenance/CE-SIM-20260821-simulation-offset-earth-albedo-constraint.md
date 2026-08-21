# CE-SIM-20260821 — Simulation start offset and Earth-albedo mount constraint

## Status

- Simulation start policy: `AUTHOR-APPROVED` and `VERIFIED` in implementation tests.
- Earth-albedo geometric constraint: `AUTHOR-APPROVED`; implementation behavior `VERIFIED` by deterministic tests.
- Earth photon-rate and directional-lobe calibration: `PROVISIONAL`.
- Publication status: not published in this task.

## Author decisions

1. Simulation Mode must start 30 minutes after the canonical ECI replay origin.
2. Reference Replay must retain the canonical ECI origin.
3. Reflected light from sunlit Earth may reach only exposed pixels in the Crystal Eye outer crown.
4. The exposed subset must depend on the Crystal Eye mount position on the 60 × 60 cm satellite platform; the platform blocks nadir light where it geometrically covers the detector.
5. Nightside Earth must provide no Earth-albedo response.

## Implementation

- `getModeReplayStartMs` applies an exact 1,800-second offset only to Simulation Mode and fails closed when the ephemeris interval cannot contain it.
- Reset initialization, ECI sampling, displayed UTC and event-log timestamps all use the selected replay start.
- Earth-albedo support continues to use the stored `mountX`/`mountZ` payload placement.
- Inner rings always receive zero nadir support.
- A centered payload has no exposed outer pixel centers in the current binary point-center model.
- Edge and corner placements expose different strict subsets of the 35 outer-crown pixel centers.
- Solar incidence gates the albedo term: illumination at or below the nightside threshold yields zero support.

## Files

- `app/lib/simulation-timeline.ts`
- `app/page.tsx`
- `tests/simulation-timeline.test.ts`
- `tests/earth-albedo-occlusion.test.ts`
- `tests/dashboard-layout.test.ts`
- this execution record

## Scientific boundary

The current occlusion rule is a deterministic geometric candidate based on vertical nadir rays and pixel-center visibility. It verifies the qualitative mount-dependent blocking requirement but is not a ray-traced spacecraft optical model. The absolute Earth-albedo rate, exponent and directional lobe remain provisional pending domain validation.

## Validation executed

- 81/81 automated tests passed;
- exact Simulation/Reference timeline-offset tests passed;
- center, opposite-edge and corner mount-support tests passed;
- nightside and inner-ring zero-support tests passed;
- ESLint and TypeScript no-emit checks passed;
- static GitHub Pages build and `git diff --check` passed.
