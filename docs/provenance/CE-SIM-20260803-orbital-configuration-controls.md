# CE-SIM-20260803 — Orbital configuration controls

## Record

- **Date:** 2026-08-03 (Europe/Rome)
- **Task:** Replace Configuration → Mission and replay with functional orbital
  scenario controls while retaining the timestamped canonical ECI dataset.
- **Approval:** AUTHOR-APPROVED change supplied by the author through the
  Crystal Eye coordinator.
- **Agent:** `simulator_engineer` implementation subtask.
- **Tools:** Git/Ripgrep inspection, `apply_patch`, Node test runner, TypeScript,
  ESLint, Next.js static build, and local in-app browser inspection.
- **Initial state:** the worktree already contained coordinated, uncommitted
  changes to `app/page.tsx`, `app/globals.css`, data pages, ECI replay, photon
  persistence, tests, assets, and prior provenance. Those changes were
  preserved; no commit, push, deployment, dependency, dataset, `Materiale/`,
  `Appunti/`, or manuscript change was made.

## Requirements and acceptance criteria

1. **Orbital configuration surface.** Configuration contains a single
   `Orbital Configuration` entry and panel; the previous Mission/replay labels
   and content are absent.
2. **Altitude override.** A functional `400–700 km` slider defaults to and
   identifies the `550 km` reference. Its value sets satellite radial distance
   to the existing simulator Earth radius plus the selected altitude.
3. **Inclination override.** A functional `0–60°` slider defaults to and
   identifies the original `20°` setting. It is explicitly presented as a
   parametric orbit-plane override.
4. **Physical time warp.** A functional `1–500×` slider shares one React state
   with top-bar pause/slower/faster and `1×`, `50×`, `200×`, `500×` presets.
   Modal preset selection updates both surfaces; top-bar changes are reflected
   when the same modal is open/reopened.
5. **Scientific honesty.** The timestamp and complete canonical ECI sample are
   retained. Canonical Sun/Moon positions are not transformed. UI identifies
   the active scenario as an override, not unmodified ECI replay, an orbit
   propagator, or a physically validated model.
6. **Regression safety.** Unit tests, explicit TypeScript checking, lint, and
   static build pass with the repository-compatible Node runtime; browser QA
   confirms control bounds/defaults and modal layout.

## Architecture and decision

`app/lib/orbital-overrides.ts` is a small, dependency-free scientific-model
boundary. It receives an immutable `EciEphemerisSample` and returns the same
canonical sample plus an overridden satellite ECI position. It does not own UI
or runtime state. `app/page.tsx` composes the canonical ephemeris, parametric
override, twin state, photon-response calculations, and React controls. CSS is
presentation-only.

For each canonical satellite vector, the override uses
`u = atan2(SAT_y, SAT_x)` as a parametric phase/longitude and fixes RAAN
conventionally to `0`. In ECI coordinates the overridden direction is
`[cos(u), cos(i) sin(u), sin(i) sin(u)]`; its radius is the existing simulator
Earth radius plus the selected altitude. This is a synthetic circular
orbit-plane scenario, not a physical transformation of the canonical orbit and
not an orbit propagator.

The canonical sample, timestamp, satellite direction, and canonical altitude
remain separately available in runtime telemetry. Canonical Sun and Moon ECI
positions remain unchanged. Observer-relative Sun/Moon directions, angular
separations, Moon distance, illumination-dependent geometry, background terms,
and detector response are recomputed from the overridden satellite position so
the simulator scenario remains internally consistent. Slider changes refresh
this geometry even while playback is paused.

## Files changed

- `app/page.tsx` — orbital state, ECI/override composition, immediate paused
  refresh, single Configuration panel, control synchronization, and explicit
  scenario labels.
- `app/globals.css` — compact orbital panel layout, warning, controls, and
  responsive modal.
- `app/lib/orbital-overrides.ts` — pure parametric orbit-plane helper.
- `tests/orbital-overrides.test.ts` — radial-distance, zero-inclination,
  synthetic-plane, phase, input immutability, timestamp, and Sun/Moon retention
  checks.
- `docs/provenance/CE-SIM-20260803-orbital-configuration-controls.md` — this
  record.

## Verification

The default shell resolved Node `v16.20.2`, below the repository requirement
(`>=22.13.0`). Checks used ephemeral Node `v22.19.0` through `npx`; manifests
and installed dependencies were not changed.

- `git diff --check` — passed.
- `npx --yes --package node@22.19.0 --call 'npm test'` — passed: 19 tests,
  19 passed, 0 failed, including 3 new orbital-override tests.
- `npx --yes --package node@22.19.0 --call './node_modules/.bin/tsc --noEmit --allowImportingTsExtensions'`
  — passed. The explicit flag is required because repository Node tests use
  `.ts` import suffixes; the production build independently ran TypeScript.
- `npx --yes --package node@22.19.0 --call 'npm run lint'` — passed.
- `npx --yes --package node@22.19.0 --call 'npm run build:pages'` — passed;
  static routes `/`, `/ephemeris`, and `/photon-history` were generated.
- Local browser at `1280 × 720` — the final compact Orbital Configuration
  content, including its footer, was visible without internal scrolling. The
  three range controls exposed the exact defaults/bounds `550 [400,700]`,
  `20 [0,60]`, and `50 [1,500]`. Both modal and top bar initially selected
  `50×`; selecting a modal time-warp preset updated the shared slider and the
  top-bar preset state.

## Assumptions, limitations, and open requirements

- The author-approved `550 km`, `20°`, and time-warp bounds are scenario/UI
  inputs. This task does not claim domain validation or introduce an orbit
  propagation model.
- Fixing RAAN to `0` and deriving `u` from canonical satellite x/y is a declared
  parametrization. It does not preserve the canonical orbit plane, velocity,
  energy, period, or dynamics.
- Changing overrides affects derived geometry and photon response but does not
  modify the canonical ECI asset or its in-memory sample.
- `PhotonRecord` schema v1 does not store altitude or inclination override
  values, and changing either slider does not start a new `runId`. Persisted
  photon history therefore cannot reconstruct the complete orbital scenario
  for each bin. Extending the persistence schema/run-boundary semantics is an
  open requirement outside this approved task.
- Browser QA covered one desktop viewport and direct preset synchronization; it
  was not exhaustive cross-browser, mobile, or assistive-technology testing.
