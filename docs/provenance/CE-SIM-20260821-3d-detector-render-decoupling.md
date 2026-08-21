# CE-SIM-20260821 — 3D detector render decoupling

- Date: 2026-08-21
- Objective: remove visible 3D animation stutter after adding per-pixel Earth-albedo presentation state.
- Author decision: `AUTHOR-APPROVED` through the explicit performance correction request.
- Scope: rendering cadence only; no change to simulation time, ECI interpolation, detector counts, source composition, or event persistence.
- Publication: not performed.

## Observed hot path

The Three.js animation loop runs through `requestAnimationFrame`, while scientific telemetry changes every 200 ms. The loop nevertheless validated four 126-element detector vectors, derived Earth-only/overlap state, scanned burst groups, and rewrote color, emissive intensity, and scale for all 126 pixel materials on every rendered frame.

At 60 fps this caused about 7,560 complete pixel material updates per second even when the detector frame had not changed.

## Correction

- Pixel material state is now recalculated only when one of its input vector references, burst groups, or selected physical pixel changes.
- Satellite, Earth, Sun, Moon, camera, and orbital interpolation remain in the animation loop and continue to render independently at display cadence.
- A new scientific telemetry frame still refreshes all detector materials immediately, normally five times per second.

## Verification

```text
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit --allowImportingTsExtensions
npm run build:pages
```

- Tests: `96/96 PASS`.
- ESLint: `PASS`, zero warnings.
- TypeScript: `PASS`.
- GitHub Pages static build: `PASS`.
- Browser frame-time profiling: not performed.

## Status and limitations

- Update gating: `VERIFIED` by source regression and build checks.
- Perceived smoothness still depends on device GPU, browser load, display refresh rate, and the 200 ms scientific sampling cadence.
- This change does not alter or interpolate the detector counts themselves.
