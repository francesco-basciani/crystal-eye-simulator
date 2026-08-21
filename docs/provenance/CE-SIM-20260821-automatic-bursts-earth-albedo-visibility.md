# CE-SIM-20260821 — Automatic burst scenarios and Earth-albedo visibility

- Date: 2026-08-21
- Objective: add sparse automatic GRB injections to Simulation Mode, beginning during direct-Sun exposure, and make the Earth-albedo contribution visible on the exact exposed outer pixels.
- Author decision: `AUTHOR-APPROVED` through the explicit request in the project task.
- Starting revision: `f6be35c185c94359fdd5f314225024910aee22ef`
- Scope: simulator implementation and tests only; no publication or deployment.

## Inputs and assumptions

- The existing 2033 ECI replay remains the source of satellite, Sun, and Moon geometry.
- Simulation Mode continues to exclude the Rito reference background and composes visible Sun, Moon, Earth albedo, and injected GRBs.
- The first automatic GRB is eligible after T+120 s but is injected only when the mounted direct-Sun rate is at least 1 count/s. Therefore the scenario follows the replay exposure instead of assuming a fixed Sun direction.
- Later automatic GRBs are separated by a deterministic pseudo-random interval of 15–25 simulated minutes and by at least 15 seconds of wall-clock time. An active burst suppresses another injection.
- Earth albedo is supported only when local solar incidence is above 0.01 and only on outer pixels whose nadir ray is not blocked by the 60 × 60 cm satellite platform. A centered 30 cm-diameter Crystal Eye is therefore fully blocked in this simplified vertical-ray model; edge and corner placements expose subsets of the crown.

These scheduling and albedo parameters are `PROVISIONAL`. They are scenario controls and a geometric candidate model, not an astrophysical GRB occurrence model or calibrated photon-transport result.

## Implementation

- `app/lib/simulation-burst-scheduler.ts`: deterministic, sparse automatic scenario scheduler with an initial Sun-overlap gate.
- `app/lib/earth-albedo-occlusion.ts`: shared solar-incidence threshold for the albedo support model.
- `app/page.tsx`: Simulation-only scheduler; deterministic burst random stream; explicit 126-value Earth component propagated to the 3D detector, Sensor View, planar Detector Response, and telemetry; explicit platform-blocked status.
- `tests/simulation-burst-scheduler.test.ts`: timing, suppression, interval, and reproducibility checks.
- `tests/earth-albedo-occlusion.test.ts`: center/edge/corner, nightside, inner-ring, and threshold checks.
- `tests/dashboard-layout.test.ts`: wiring checks for the automatic scenarios and explicit Earth component.

## Verification record

Bundled Node.js runtime: v24.19.0.

Commands:

```text
npm test
npm run lint -- --max-warnings=0
npx tsc --noEmit --allowImportingTsExtensions
npm run build:pages
```

Results:

- Tests: `86/86 PASS`.
- ESLint: `PASS`, zero warnings.
- TypeScript: `PASS`.
- GitHub Pages static production build: `PASS`; `/`, `/ephemeris`, `/event-history`, and `/photon-history` prerendered.
- Browser visual QA: not performed in this task.

## Traceability and limitations

- The UI now uses the same allocated Earth vector as the signal composition, preventing a second display-only pixel-selection rule.
- The Earth allocation is indexed by the authoritative physical pixel ID and uses the V2R8 candidate angular geometry.
- The outer-crown occlusion boundary uses pixel-center vertical nadir rays. It does not yet model finite pixel area, platform scattering, wavelength-dependent albedo, Earth radiance maps, or Geant4 transport.
- The first automatic scenario is tagged `AUTO SOLAR-OVERLAP SCENARIO`; later ones are tagged `AUTO RANDOM SCENARIO` in the event log.
- No claim of physical validation is made. Physics-domain review is still required before changing the status from `PROVISIONAL`.

## File hashes

- `app/lib/simulation-burst-scheduler.ts`: `97d43787d1c19e0abf193b8f1d7ee8171235c72cb5192a38893f0c583e9778ac`
- `app/lib/earth-albedo-occlusion.ts`: `e19b54951a3ffc1b605e7243c5030d6430a357fc5beea022738a6e488a142a12`
