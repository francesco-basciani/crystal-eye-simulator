# CE-SIM-20260813 — Burst response and direction reconstruction MVP

## Task, authorization, and boundary

- **Date:** 2026-08-13 (Europe/Rome).
- **Baseline:** clean commit `6b5d5eddd77fc7773aa312092a9b1c8e92693364`.
- **Checkpoint:** annotated tag
  `checkpoint-pre-burst-response-localization-20260813`, verified before work.
- **Author authorization:** explicit `procedi` after review of the minimum
  source-conditioned aggregate-filter and weighted-centroid proposal.
- **Objective:** make the response to a configured synthetic burst visible in
  the existing dashboard and reconstruct an engineering sky direction without
  representing the result as blind detection, flight telemetry, or validated
  localization.
- **Excluded:** new dependencies, history-schema expansion, calibrated physical
  response, blind decision threshold, confidence ellipse, multi-source
  separation, publication claim, commit, push, and deployment.

All new outputs have status `PROVISIONAL`. No physics/domain validation was
performed by the software agents.

## Existing inputs retained

- Rito `pixbkg.txt`: 126 provisional background-reference rates in counts/s,
  SHA-256 `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.
- Fixed acquisition exposure: `0.2 s`; this remains independent of accelerated
  orbital replay time (`0.2 × time-warp` simulated seconds per UI tick).
- Existing configured aggregate background: Rito plus current Sun, Moon, and
  Earth terms.
- Existing synthetic source amplitude, temporal decay, transmission, footprint,
  configured detector normals, physical pixel IDs, mount visibility, and
  radial-attitude visualization convention. No source amplitude or physical
  parameter was changed.
- Existing per-pixel detector response is a deterministic derived display
  response. It is not a vector of independently sampled measurements and does
  not reconcile all aggregate Sun/Moon/Earth/GRB terms.

## Observation contract

Reference Mode preserves the deterministic baseline behavior:

```text
Y_k = B_k + S_k  [counts per 0.2 s bin]
```

Simulation Mode uses a separate versioned observation random stream:

```text
Y_k ~ Poisson(B_k + S_k)
```

The dependency-free sampler splits a large Poisson intensity into independent
terms of at most 20 before exact Knuth sampling, avoiding exponential underflow.
The fixed observation seed is `0x43452001`. Its xorshift32 state is separate
from the existing event-generation calls, so observation sampling cannot alter
which synthetic event is generated. Reset or mode change restores the seed.
The sampled aggregate is synthetic and is never described as telemetry.

## Source-conditioned scalar offset filter

Version: `ce-source-conditioned-scalar-offset-kf-v1`.

The implementation uses counts per acquisition bin throughout. Configured
background `B_k` is a known input; the scalar state is only a slow residual
offset `δ_k`:

```text
δ_k^- = δ_(k-1)                 Q = 0
P_k^- = P_(k-1)
z_k   = Y_k - B_k
ν_k   = z_k - δ_k^-
R_k   = max(B_k, Number.EPSILON)
K_k   = P_k^- / (P_k^- + R_k)
δ_k   = δ_k^- + K_k ν_k
P_k   = (1 - K_k) P_k^-
bhat_k = B_k + δ_k
```

Initialization is exactly:

```text
δ_0 = 0
P_0 = R_0 = max(B_0, Number.EPSILON)
```

When the simulator states that one or more injected bursts are active, the
measurement update is skipped:

```text
δ_k = δ_k^- ; P_k = P_k^-
```

The innovation remains visible, but no injected onset or decay-tail bin can be
assimilated into the background state. This is explicitly a
`SOURCE-CONDITIONED ORACLE`, not a blind detector or a false-alarm-controlled
algorithm. The plotted band is estimate `±1` model-assumed standard deviation,
not an empirical confidence interval.

The live window retains the latest 120 frames. Streaming state is carried
separately, so truncating the display does not reinitialize the filter.

## Graph semantics

The integrated right-side panel leaves the three-dimensional scene visible and
plots, in counts per 0.2-second acquisition bin:

- the Reference deterministic or Simulation seeded-Poisson stream;
- configured expected aggregate background;
- source-conditioned cyan background estimate and `±1σ` model band;
- signed innovation in a separate lower region;
- exactly one marker for every injected burst ID at its known onset.

The upper display range has a visualization-only minimum span of 25% of its
center, includes observations and the uncertainty band, and provides numeric
ticks. It changes no model input or result.

Legacy `TRANSIENT DETECTED`, candidate, and sigma-significance claims were
removed. The source HUD now describes only active synthetic injection truth.

## Direction reconstruction and truth isolation

Method: `positive-excess-weighted-centroid-v1`.

For the current frame, the forward pipeline first saves its same-frame derived
no-source pixel response. It then adds the existing synthetic burst footprint.
The reconstruction API receives only:

- derived pixel values and same-frame baseline;
- detector normals;
- current radial boresight;
- acquisition frame and time.

It cannot accept injected RA/Dec, target pixel, footprint IDs, intensity,
transmission, spread, aggregate source, event ID, or active-burst metadata.
For pixel `i`:

```text
e_i = max(0, value_i - baseline_i)
s_local = normalize(sum_i e_i normalize(n_i))
```

It reports `UNAVAILABLE` for mismatched/invalid input, zero positive excess, or
a `degenerate-centroid` when positive opposing weights cancel. Active-pixel
count is the number of `e_i > 0`. Within a
known single-source interval, the UI retains the frame having the greatest
total positive excess. More than one simultaneous source is explicitly
`UNAVAILABLE · SIMULTANEOUS UNRESOLVED`.

The detector direction is rotated by the same engineering convention as the
viewer: minimum rotation taking detector `+Y` to the geocentric outward radial
boresight. The exact and near-antipodal branch matches the installed Three.js
threshold and deterministic 180-degree scene-Z fallback. Scene axes map to the
current ECI-like equatorial convention:

```text
ECI [X,Y,Z] = scene [x,z,y]
RA  = atan2(scene_z, scene_x) mod 360 degrees
Dec = asin(scene_y)
```

This is assumed radial attitude; measured payload roll is unavailable.

Injected truth is held outside the estimator module. Only after a reconstruction
exists does a separate scoring module compute the synthetic angular error:

```text
error_deg = acos(clamp(direction_estimate · direction_truth, -1, 1))
```

The UI labels this `SYNTHETIC EVALUATION · WITHHELD FROM ESTIMATOR`. It is
closed-loop same-model evaluation, not independent instrument performance.
There is no confidence ellipse.

## Implementation files and roles

- `app/lib/source-conditioned-kalman.ts`: seeded observation stream, Poisson
  sampler, filter initialization/step/replay.
- `app/lib/burst-direction-reconstruction.ts`: truth-free centroid and radial
  coordinate transformation.
- `app/lib/burst-direction-truth-score.ts`: separate post-estimation angular
  scorer.
- `app/components/adaptive-analysis-panel.tsx`: graph, mode/provenance labels,
  and direction panel.
- `app/lib/adaptive-analysis-scale.ts`: finite empty-series fallback and
  visualization-only plot range/ticks.
- `app/page.tsx`: existing-stream adapter, mode/reset behavior, event onset,
  source mask, derived pixel baseline, peak selection, and separate scoring.
- `app/globals.css`: integrated scroll-contained panel and plot presentation.
- `tests/source-conditioned-kalman.test.ts`,
  `tests/burst-direction-reconstruction.test.ts`,
  `tests/adaptive-analysis-scale.test.ts`, and
  `tests/dashboard-layout.test.ts`: numerical and static integration gates.

Implementation was delegated to `simulator_engineer`. Independent numeric
fixtures and final audit were assigned to `quantitative_validator`; the
coordinator reviewed the scientific boundary, provenance, integration, and
release gates.

## Verification record

Commands use the workspace-compatible Node runtime and are run from
`crystal-eye-simulator/`:

```text
export PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
npm test -- --runInBand
npm run lint
npx tsc --noEmit --allowImportingTsExtensions --incremental false
npm run build
git diff --check
```

The first coordinator invocation inherited Node `v16.20.2` and failed before
executing tests because that runtime does not support
`--experimental-strip-types`; lint likewise stopped because Node 16 lacks
`structuredClone`. This was a runtime-selection failure, not a test failure.
No dependency was installed or changed. The gates were rerun using the
workspace runtime Node `v24.19.0`:

- full tests: **51/51 PASS**;
- ESLint: **PASS**;
- TypeScript no-emit check: **PASS**;
- vinext production build: **PASS**, with only the existing advisory that a
  client chunk exceeds 500 kB;
- `git diff --check`: **PASS**.

The independent `quantitative_validator` reran 14 focused tests and the two
reported edge cases on the frozen files. Both are **PASS**: the reported
estimate is exactly `B + delta` (including an intentionally negative extreme
fixture), and cancelling positive weights return
`UNAVAILABLE / degenerate-centroid`. The validator also reproduced seeded
Poisson ensemble means within the predeclared five-standard-error sanity
bound: `0.20134` at lambda `0.2`, `25.00426` at lambda `25`, `100.00854` at
lambda `100`, and `1142.364` at lambda `1142.3`. These checks validate software
arithmetic and replay behavior, not the physical observation model.

Browser QA on the integrated dashboard passed in both modes: finite ticks at
empty/loading state; mode-aware `Reference Replay` / `Simulation Mode` title;
no console errors; exactly one onset circle for an isolated injected event;
and a source-conditioned reconstruction. One observed seeded example reported
RA `46.09 deg`, Dec `-48.45 deg`, 26 derived excess counts over 24 pixels, and
synthetic withheld-truth error `9.69 deg`. This is a QA example only, not a
performance result. A source injected outside the current FOV correctly
returned `UNAVAILABLE`. The browser emitted only pre-existing Three.js Clock
deprecation warnings. No generated screenshot or test artifact is retained.

## Limitations and future gates

- Rito rates, environmental amplitudes, GRB response, detector normals, mount
  visibility, and radial attitude remain provisional engineering inputs.
- The per-pixel direction input is deterministic derived response, not
  independent Poisson telemetry. Sun and Moon are not allocated into this
  per-pixel display response.
- The simulator's per-pixel and aggregate formulas are not a calibrated common
  response model. Angular error therefore measures closed-loop demonstrator
  behavior only.
- Unknown spacecraft roll can rotate the reconstructed sky azimuth even when
  detector-local reconstruction is exact.
- Source-conditioned masking cannot establish detection sensitivity, false
  alarm rate, or blind localization performance.
- The approved linear offset state is unconstrained. In an extreme statistical
  fixture `B + delta` can be negative; the implementation reports the equation
  exactly rather than silently clamping it. A physically constrained estimator
  would be a separate author-approved model change.
- Multiple simultaneous bursts are unresolved; no historical per-pixel
  reconstruction is added.
- A blind profile-Poisson sky-grid method requires an author-approved,
  reconciled per-pixel integer observation contract and continuous calibrated
  forward response. Rito/KS additionally requires appropriate ordered
  distributions or templates; scalar pixel rates are insufficient.
- Any physical accuracy, uncertainty coverage, detection, localization, or
  flight-capability claim requires domain validation and explicit author
  approval.
