# CE-SIM-20260811 — Sky & Energy Analysis MVP

## Task, authorization, and boundary

- **Date:** 2026-08-11 (Europe/Rome).
- **Objective:** replace the live aggregate Kalman presentation surface with a
  versioned, per-pixel Sky & Energy engineering analysis while preserving the
  existing simulator source, environment, geometry, persistence, and mode
  contracts.
- **Baseline:** commit `5bd92e5`, preserved by annotated tag
  `checkpoint-pre-sky-energy-analysis-20260811`.
- **Author approvals:** explicit approval on 2026-08-11 for CountCube v1,
  current radial attitude, one integrated existing-count band, optional
  synthetic six-band visualization, sequential per-pixel/per-band residual
  bookkeeping, non-operative localization interfaces, and the integrated
  dashboard replacement. The author subsequently approved the mode-specific
  observation allocation: seeded conditional multinomial in Simulation Mode
  and deterministic proportional allocation in Reference Mode.
- **Out of scope:** calibrated energy response, measured attitude, an operative
  GRB/fault detector or localizer, physical/domain validation, new external
  datasets or dependencies, IndexedDB schema migration, manuscript claims,
  commit, push, deployment, and changes to `Materiale/` or `Appunti/`.

All new outputs are `PROVISIONAL`. The UI states that this is an engineering
demonstrator and makes no detection or localization claim.

## Inputs and invariant contracts

- Physical pixel identity is the existing `0..125` domain: exactly 126 pixels.
- Acquisition exposure remains `0.2 s`; accelerated orbital replay time remains
  separate metadata.
- Aggregate expected background, source, and observed counts are produced by
  the pre-existing simulator pipeline; no amplitude or source parameter was
  added by this task.
- Reference Mode retains the Rito `pixbkg.txt` reference contribution and the
  existing supported Sun, Moon, and Earth contributions.
- Simulation Mode excludes Rito and retains the existing Sun, Moon, Earth, and
  configured GRB contributions followed by the existing seeded aggregate
  Poisson sample.
- Existing GRB support continues to be derived from its configured RA/Dec,
  detector direction, mount visibility, and footprint response. No count vector
  is independently rotated or synthesized by the analysis module.
- Earth-albedo support and source/environment component reconciliation remain
  the previously implemented detector-response contracts.

## CountCube v1 and observation lineage

`CountCubeFrameV1` is an in-memory, versioned frame with axes:

```text
time frame × physical pixel (126) × energy band
```

Each cell stores observed counts, expected-background counts, and expected
source counts. The default band is `integrated-existing-counts`, which is an
identity view of existing counts and is not an energy calibration.

Per-pixel **observations are derived, not telemetry**:

- **Simulation Mode:** the already sampled aggregate integer is conditionally
  allocated over the existing expected per-pixel weights by a separate seeded
  multinomial draw. Seed and frame index make replay deterministic. The pixel
  integers sum exactly to the existing aggregate and do not perturb its random
  stream.
- **Reference Mode:** the existing deterministic aggregate is allocated in
  proportion to the same expected per-pixel weights. The last supported pixel
  is recomputed from the aggregate minus the preceding left-to-right sum;
  following zero-support pixels remain zero. This preserves the aggregate
  exactly under the consumer reduction order without inventing pixel support.
- A positive aggregate with zero pixel support fails closed; a zero aggregate
  maps to an all-zero vector.

The expected-background vector passed to CountCube is the reconciled,
mode-correct `backgroundExpectedCounts`: Rito plus supported environment in
Reference Mode and supported physical environment with Rito excluded in
Simulation Mode. The GRB source vector is the existing reconciled source
component. This avoids introducing a persistent artificial Reference residual.

## Energy representation

- **Integrated existing counts:** one identity band, usable with current data.
- **Six-band synthetic view:** a configurable six-fraction partition; the UI
  default is equal fractions. Fractions are normalized, must be finite and
  non-negative, and each per-pixel observed/background/source total is exactly
  reconciled by assigning the floating-point remainder to the final band.
- The six bands are permanently labeled `SYNTHETIC` and `NON-CALIBRATED`; they
  do not claim measured photon energies or a Crystal Eye response matrix.

## Radial attitude and coordinates

The approved current engineering convention maps detector `+Y` to the
geocentric radial scene boresight by the shortest rotation. Roll is the
deterministic minimum-rotation convention. Scene coordinates map to ICRS-like
ECI as `[X,Y,Z] = [x,z,y]`; RA is `atan2(Y,X)` in `[0,360)` and declination is
`asin(Z)` in `[-90,90]`.

The exact and near-antipodal case follows the installed Three.js
`Quaternion.setFromUnitVectors` convention: the 180-degree fallback is about
scene `Z`, so `(x,y,z) -> (-x,-y,z)`, with the same
`dot(from,to) + 1 < 1e-8` branch threshold. This removes an orbit-dependent
runtime hole while preserving the viewer's deterministic roll convention.
These are derived directions under assumed radial attitude, not measured
spacecraft attitude or validated sky localization.

## Sequential analysis and scenario separation

For each pixel and band, the current bookkeeping subtracts the supplied
expected background and updates a cumulative Welford state:

```text
corrected_t = observed_t - expected_background_t
residual_t  = corrected_t - mean(corrected_1..corrected_(t-1))
```

The panel displays the latest residual on the derived ICRS map. It has no
threshold, event declaration, false-alarm model, or localization result. The
three scenario semantics shown in the UI are deliberately separate:

- environment: the mode-correct expected-background input;
- GRB: the existing configured RA/Dec footprint and source truth;
- sensor fault: a seed-selected pixel for inspection only; no fault amplitude
  is injected by this MVP.

The common `LocalizationAlgorithm` interface exposes exactly three
non-operative future stubs: `template-ks`, `cnn`, and
`statistical-sky-estimator`. Every stub returns `not-operative` and produces no
position estimate.

## Persistence and history

The IndexedDB schema remains version 1. Existing photon rows contain aggregate
observed/background/source data but not the new per-pixel or energy-resolved
CountCube. The history page therefore retains row selection and paging, shows
only an aggregate integrated-count history, and explicitly states that past
CountCube, sky localization, or calibrated energy analysis cannot be
reconstructed from schema-v1 rows. Live CountCube frames are a bounded
120-frame in-memory window.

## Files and roles

- `app/lib/sky-energy-analysis.ts`: CountCube, observation allocation, energy
  partition, attitude mapping, sequential bookkeeping, and localization stubs.
- `app/components/sky-energy-analysis-panel.tsx`: integrated live panel and
  aggregate legacy-history plot.
- `app/page.tsx`: mode-aware live adapter using existing detector-response
  vectors and current radial geometry.
- `app/photon-history/page.tsx`: honest aggregate-only history limitation.
- `app/globals.css`: integrated/responsive panel layout and sky map.
- `tests/sky-energy-analysis.test.ts`, `tests/dashboard-layout.test.ts`, and
  `tests/photon-history-ui.test.ts`: numerical and integration regressions.

Implementation was performed by the `simulator_engineer` role under
`ce_coordinator`; calculations and invariants were independently re-audited by
the `quantitative_validator` role. The workspace-compatible Node runtime was
used; no package installation or network service was required.

## Verification record

Commands are executed from `crystal-eye-simulator/` with the workspace cached
Node runtime prepended to `PATH`:

```text
npm test
npm run lint
npx tsc --noEmit --allowImportingTsExtensions --incremental false
npm run build:pages
git diff --check
```

Final results on the stabilized shared worktree:

- `npm test`: **PASS**, 76/76 tests;
- `npm run lint`: **PASS**;
- `npx tsc --noEmit --allowImportingTsExtensions --incremental false`:
  **PASS**;
- `npm run build:pages`: **PASS**, four static routes generated (`/`,
  `/_not-found`, `/ephemeris`, `/photon-history`);
- `git diff --check`: **PASS**.

The independent quantitative re-audit used 10,000 arbitrary Reference
allocations and 10,000 live-shaped allocations. Both reported zero aggregate
identity failures, zero negative derived counts, and zero maximum reduction
error after the final reconciliation fix. Simulation allocation preserved an
integer total of 713 exactly, replayed identically for the same seed/frame, and
changed for a different seed. Energy partition reconciliation passed for all
378 audited pixel/component combinations and for the aggregate 713-count
fixture. The final normalized fraction is also reconciled as the remainder from
one, so the default six-band metadata and the operational count partition both
reduce exactly under the declared order.

The coordinator's live browser QA passed the desktop Reference panel, integrated
and six-band selectors, all B1–B6 controls, Simulation provenance label, active
GRB footprint status, split focus with the 3D view preserved, and console-error
check. Browser policy blocked direct History-link navigation in that pass; the
history route is covered by tests, production build, static review, and a local
HTTP 200 check. Generated build output is ignored and is not a deliverable.

## Limits and remaining gates

- Pixel observations are aggregate-preserving derivations, not independently
  sampled detector telemetry.
- The Rito asset is a ground/reference background-rate input, not flight data.
- The six-band view contains no calibrated energy boundaries or response.
- Radial attitude is assumed; spacecraft attitude/roll telemetry is absent.
- Welford residual bookkeeping is not a Kalman replacement claim, detector,
  classifier, or localizer.
- No sensor-fault injection/diagnosis, KS template, CNN, or statistical sky
  estimator is operative.
- Physical models, detector calibration, thresholds, performance metrics, and
  scientific claims require domain-expert validation and explicit author
  approval before publication use.
