# CE-SIM-20260810 — Reproducible adaptive-background demonstrator

## Task, authorization, and boundary

- **Date:** 2026-08-10 (Europe/Rome).
- **Objective:** add a presentation demonstrator with versioned scenarios,
  seeded Poisson observations, an aggregate background Kalman estimator, plots,
  provisional metrics, and the same analysis path for presets and the current
  simulator GRB stream.
- **Author authorization:** explicit on 2026-08-10 for the recommended minimal
  demonstrator, subsequently clarified so that GRB scenarios are an alternative
  to Earth occultation. A follow-up quantitative sanity check required a
  separate bright 100%-amplitude presentation case;
  the weak GRB remains visible as a limitations case and Crab as a secondary
  benchmark.
- **Pre-change checkpoint:** annotated tag
  `checkpoint-pre-kalman-scenarios-20260810`, tag object
  `b8541f670594ad2c58f7f0b323ca5ffe59278d2f`, resolving to commit
  `0963901032f6b5eb8ba5ca63e11f14b61b81cf80`.
- **Out of scope:** physical/domain validation, calibrated detection claims,
  manuscript edits, new dependencies or datasets, deployment, push, and
  modification of `Materiale/` or `Appunti/`.

The permanent public label is:

> Synthetic engineering demonstrator — physical calibration pending.

All scenario truth, filter parameters, metrics, residuals and intervals remain
`PROVISIONAL` engineering outputs. The feature does not declare a validated
detection capability.

## Inputs and versions

- Simulator baseline: commit `0963901032f6b5eb8ba5ca63e11f14b61b81cf80`.
- Application package version: `0.1.0`.
- Required Node runtime: `>=22.13.0`; verification used the cached compatible
  runtime supplied by the workspace.
- Pixel-background runtime asset:
  `public/data/pixbkg.txt`, SHA-256
  `88ae8a6f3b918eebcc1e9f94650fe22a6f6f3c9251bc1a5f3cedd7a203e7587d`.
- Current simulator reference source model: aggregate peak coefficient
  `135 counts/0.2 s` at 100% configured intensity and exponential tick scale
  `5.5`; both remain provisional.
- Secondary Crab benchmark lead: local PRIN facsimile pp. 14–15, with the
  reported 15-pixel rates `496 counts/s` background and `13.3 counts/s` source.
  Those physical semantics remain pending domain validation.

No external dataset, package, service, or network scientific source was added.

## Versioned scenarios

Scenario schema version: `1`.

| Scenario ID | Intended use | Parameters | Status |
|---|---|---|---|
| `bright-grb-presentation-v1` | presentation sanity case | 60 s, 0.2 s exposure and simulation step, `5711.5784 counts/s` background, `675 counts/s` peak FRED source at 20 s, 1.1 s decay, 4 s bounded interval | `PROVISIONAL`; synthetic 100%-amplitude simulator case |
| `weak-grb-v1` | limitations/sub-threshold-per-bin demonstration | 60 s, 0.2 s exposure and simulation step, `5711.5784 counts/s` background, `202.5 counts/s` peak FRED source at 20 s, 1.1 s decay, 4 s bounded interval | `PROVISIONAL` |
| `quiet-background-v1` | background-only control | 60 s, 0.2 s exposure/step, `5711.5784 counts/s`, no source | `PROVISIONAL` |
| `crab-emergence-15px-v1` | secondary Earth-occultation benchmark | 100 s, 0.2 s exposure/step, `496 counts/s` baseline, `13.3 counts/s` source after a 1 s smooth transition | `PROVISIONAL`; domain validation pending |
| `live-simulator-v1` | current configured simulator GRB | consumes the current `background` and `source` expected-count stream; seeded observations are derived without changing the persisted photon schema | `PROVISIONAL` |

The bright-GRB peak is the current synthetic 100%-amplitude coefficient:
`135 counts/0.2 s = 675 counts/s`. With fixed seed `0x43450004`, the implemented
run produces one gated bin and a maximum absolute normalized innovation of about
`4.021`; this is a presentation sanity check, not validated significance. The
weak-GRB peak is an explicit engineering derivation from 30% of the current
simulator coefficient: `135 × 0.30 = 40.5 counts/0.2 s = 202.5 counts/s`.
The decay conversion is `5.5 ticks × 0.2 s = 1.1 s`. The 30% fraction, 4 s
bounded interval, small background drift and all estimator tuning values are
presentation-demonstrator parameters, not physical claims.

## Observation and time contract

Each frame keeps distinct fields for:

- `simulationTimeSeconds`: state-evolution/replay time;
- `exposureSeconds`: count-accumulation exposure, fixed at 0.2 s in the included
  scenarios and current simulator adapter;
- expected background and source rates in `counts/s`;
- sampled integer `observedCounts`.

The live adapter uses the persistent simulator frame identity to derive an
independent per-frame random stream. The same seed and same versioned input
frames therefore replay identical observations even when the live display uses
time warp. Time warp changes differences in simulation time; it does not change
the declared exposure.

The dependency-free Poisson generator uses a seeded xorshift32 stream. Large
intensities are decomposed into independent Poisson terms of at most 20 before
using Knuth sampling. Poisson additivity retains the target distribution and
avoids `exp(-lambda)` underflow at the aggregate background rate.

## Estimator and robust gating

The aggregate state is:

```text
x = [background_rate_counts_per_second, background_drift_counts_per_second_squared]
```

The transition uses the actual difference in `simulationTimeSeconds`. The
measurement is `observedCounts / exposureSeconds`; its provisional variance is
the predicted background rate divided by exposure, following the Poisson mean–
variance relationship under a high-count Gaussian approximation.

Version `ce-aggregate-background-kf-v1` uses:

- confidence multiplier `1.96`;
- robust innovation gate `|normalized innovation| > 4`;
- acceleration-process standard deviation `0.35 counts/s²`;
- minimum positive rate `1 count/s`.

A gated measurement is not assimilated, so a large transient is not immediately
absorbed into the background state. The gate is an uncalibrated robustness rule,
not a detection threshold. The displayed source/GRB residual is the positive
one-step innovation; the source-interval metric separately reports the signed
residual only where the synthetic/configured source reference is positive.

## Outputs

- observed seeded Poisson samples;
- synthetic/simulator-reference background truth;
- filtered background estimate and 95% covariance band;
- source/GRB truth interval and positive residual overlay;
- normalized innovation with visible ±4 engineering gate;
- background RMSE, bias, 95% coverage, gated-bin count, and signed
  source-interval residual versus reference counts;
- visible scenario ID, schema/version, seed, exposure and simulation step.

Metrics are computed against synthetic or simulator-reference expected values.
They do not measure accuracy against Crystal Eye hardware or flight data.

## Approved dashboard-mode revision

The author subsequently approved replacing the standalone full-screen scenario
dialog with an inline `Adaptive Background Analysis` panel so the three-
dimensional orbit remains visible. The dashboard contract is now:

- **Reference Mode** is the default. It retains the Rito `pixbkg.txt` background
  reference rates and the existing additive Sun, Moon and Earth terms. No
  automatic or random burst is created in this mode; the configured manual test
  burst remains available.
- **Simulation Mode** starts only through the prominent top-bar control and
  resets the ECI replay to its origin. It samples photon counts with a seeded
  Poisson generator and schedules automatic synthetic GRBs. The editable run
  seed is locked while the run is active.
- Observation and automatic-event random streams are distinct xorshift32
  streams derived from the same run seed. The first automatic event occurs at
  bin 50 (10 s of 0.2 s exposures). Further events are separated by a seeded
  90–150 bins (18–30 s of exposures); duration is seeded in 0.8–2.4 s,
  footprint in 4–28 pixels and intensity in 72–100%. The scheduler also checks
  that no automatic event is active before starting another. Manual/test events
  may overlap and every active source remains additive with all environmental
  terms. This is a presentation-compressed synthetic cadence, not a realistic
  or validated astrophysical occurrence rate.
- Stopping restores Reference Mode and removes only automatic events. Existing
  manual events, if any, are not silently discarded.
- The 3D HUD reads `REFERENCE REPLAY` (or `REFERENCE PARAMETRIC REPLAY`) in
  Reference Mode and `SIMULATION MODE` while active.

The Rito input is described only as a background-rate reference. Neither its
deterministic replay nor the synthetic Poisson samples are presented as real
flight measurements. Scheduler ranges and event amplitude remain
`PROVISIONAL` engineering choices already within the approved demonstrator;
they do not imply an astrophysical population or event rate.

Following author feedback, the large central title is the unambiguous
`Simulation Mode` or `Reference Replay`; seeded-observation detail stays in the
eyebrow and orbit detail in the suffix. The inline plot was enlarged without changing the dashboard
grid: 680×342 SVG view box, 82-unit left gutter, five rate ticks with compact
`k` formatting, visible `-4/0/+4` innovation labels, 14-unit label text and a
minimum 25% rate span around the current center, rounded to 1/2/5×10^n tick
steps. Observations and uncertainty bands are still included when deriving the
range and therefore are not clipped. This scale floor is visualization-only: it
does not modify observations, filter inputs, covariance, residuals or metrics.
The panel now has a 340 px
minimum height and scrolls within the existing right column. A larger dashboard
quadrant architecture remains a separate author decision and is not implemented.

## Approved return to three columns and split focus

The author rejected the four-area cockpit commit `3d60369`. It was reverted in
isolation with `git revert --no-edit 3d60369`, producing commit `7de1827`; this
preserved the preceding `c33afa2` title/plot revision and all scenario/state
work. The checkpoint tag still resolves to
`0963901032f6b5eb8ba5ca63e11f14b61b81cf80`.

The restored desktop default is the prior 286 px / flexible 3D / 330 px
three-column layout. Two always-accessible workspace controls independently
collapse or restore the left and right columns, and the 3D viewer consumes the
released space. Hidden columns are marked `aria-hidden` and `inert`.

Analysis and detector expansion now use a non-modal `45% / 55%` split:

- the 3D viewer remains in the left split;
- the existing right panel supplies either Photon Stream plus Adaptive
  Background Analysis, or Rito status plus the configured detector map;
- unrelated side content is hidden only for the focus state;
- `RESTORE DASHBOARD` or Escape returns to the prior independent column state;
- the detector retains aspect ratio `1.18`; the analysis focus explicitly uses
  a three-row grid so its graph owns the flexible row without overflow;
- at widths up to 900 px the same focus states stack 3D before the selected
  analysis/detector surface.

The former detector full-screen backdrop/dialog and its CSS were removed. That
split-focus revision changed presentation state and layout only; scientific
models, parameters, streams, source scheduling and detector mapping were not
altered at that gate.

## Approved edge controls and isolated-event refinement

From clean commit `d468a85`, the author approved three focused refinements:

- the former top-center text toolbar was replaced by 22×54 px chevron tabs at
  each column boundary. CSS variables hold the 286/330 px desktop and 250/292 px
  compact widths, so each tab follows its own boundary and moves to the viewport
  edge when hidden. The split restore action is anchored at the 45% focus edge;
- the display-only analysis range floor changed from 4% to 25% of the current
  rate center so background count noise appears comparatively near-flat while
  all observations/bands remain inside nice rounded bounds;
- automatic synthetic events now use the isolated timing contract documented
  above. The seed streams, environmental additions, intensity and footprint
  ranges are unchanged. Manual/test overlap remains permitted.

These settings remain `PROVISIONAL` presentation behavior and are not a claim
about astrophysical rate, duration distribution or detector performance.

## Files produced or modified

- `app/lib/kalman-scenarios.ts`: pure scenario, seeded observation and Kalman
  analysis core.
- `app/components/adaptive-background-panel.tsx`: inline live plot, compact
  metrics, seed control, permanent warning and split-focus action.
- `app/page.tsx`: explicit modes, deterministic stochastic streams, automatic
  GRB scheduler, additive current-stream adapter, mode-aware 3D labels, column
  visibility state and shared split-focus state.
- `app/globals.css`: simulation control, three-column collapse rules, 45/55
  split-focus views, responsive stacking and inline plot styling.
- `tests/kalman-scenarios.test.ts`: replay, Poisson, scenario, live-time,
  gating, metric and covariance tests.
- `tests/dashboard-layout.test.ts`: inline placement, mode contract, naming,
  seeded observation, column visibility, split focus, overflow/aspect and
  automatic-event integration assertions.
- `docs/provenance/CE-SIM-20260810-kalman-scenarios.md`: this record.

Final implementation hashes before handoff:

- `app/lib/kalman-scenarios.ts`:
  `e9ac3d5346e16e687f972de7691589f34580bd8707fc2cb78e6a9611628b7e92`;
- `app/components/adaptive-background-panel.tsx`:
  `5281f57bb5a6a1939152df87d07af2759ceed28b88a08eaf4e8aedfc9c58b708`;
- `app/page.tsx`:
  `90962f5d4c16a4e9cdbcd59cb83a5a9ae54a3018dead9c4c9395a2c26bc94aaa`;
- `app/globals.css`:
  `36224e68000370bc485857ef6d83079b8aa7cfff57cc0f6038ea04618aaf154b`;
- `tests/kalman-scenarios.test.ts`:
  `4bf2866c7ac8d00676646dc2ede543165af97ce22377bcc4ef81af17ad55c78d`;
- `tests/dashboard-layout.test.ts`:
  `332b2f4d02436874def182eeac78a232f4403cb85521dd8aa7c92b5f9521d1c3`.

## Agents and tools

- `ce_coordinator`: baseline inspection, implementation, integration, tests and
  provenance record; a new `simulator_engineer` thread could not be created
  because the collaboration thread limit had been reached.
- Prior read-only `physics_requirements_analyst`: scenario/data requirements and
  physical-risk analysis.
- Prior read-only `literature_researcher`: primary-source leads for Kalman,
  Poisson count estimation and gamma-background context; those citations are
  not introduced into the application or manuscript here.
- Independent quantitative validation: requested after implementation; result
  recorded below when available.
- Tools: Git, SHA-256, Node test runner, TypeScript, ESLint, Next static build,
  local vinext server, HTTP inspection, and attempted in-app browser QA.

## Verification commands and results

```sh
PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm test
# PASS: 44 tests, 44 passed, 0 failed

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ./node_modules/.bin/tsc --noEmit --allowImportingTsExtensions --incremental false
# PASS

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run lint
# PASS

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build:pages
# PASS: compiled, TypeScript checked, 5/5 static pages generated

curl --fail --silent --show-error http://localhost:3001/
# PASS: HTTP 200; server-rendered output contains HIDE LEFT, HIDE RIGHT,
# both split-focus action labels, Reference Replay and START SIMULATION.

git diff --check
# PASS
```

The local development server started successfully on port 3001, but the browser
runtime again reported `No browser is available`. Interactive visual QA could
not be completed. Static split ownership, desktop overflow, aspect-ratio and
responsive CSS plus rendered HTTP labels were verified, but that is not treated
as a visual pass.

## Status and open gates

- Scenario schemas, deterministic replay behavior, mathematical code path and
  build integration: locally tested; independent quantitative audit pending.
- Physical rate meanings, source profiles, Poisson independence, drift model,
  process/measurement covariances, gate, uncertainty coverage and applicability
  to Crystal Eye: **PROVISIONAL**, not `DOMAIN-VALIDATED`.
- Presentation capability claim allowed: a synthetic reproducible engineering
  demonstrator exists.
- Detection-performance, sensitivity, false-positive, localization, energy or
  flight-validity claims: **not authorized**.
- Before any manuscript/result use: complete quantitative validation,
  reproducibility audit, domain-expert validation, author approval, citation
  audit where sources are cited, and scientific review.
- Before release: complete interactive browser/accessibility QA and obtain
  explicit author approval for deployment/publication.

No commit, push, deployment, publication, dataset change, dependency addition,
or edit to `Materiale/`, `Appunti/` or `Paper/` was performed.

## 2026-08-10 revision — mode-specific signal provenance

Task objective: implement the author-approved data contract at baseline commit
`005b9c8a592a4d5e3d3bd6c1789c5660eca6d926`.

Author-approved decisions implemented:

- Reference Mode retains the supplied Rito `pixbkg` per-pixel reference and the
  existing separate environmental terms.
- Simulation Mode contributes exactly zero Rito rate/counts to both aggregate
  and per-pixel expected observations. Its background mean is the sum of only
  the existing Sun, Moon and Earth provisional models; active GRBs remain a
  separate synthetic source term. Observations are seeded Poisson samples of
  that composed expectation.
- No environmental or GRB amplitude coefficient was changed. Directional
  non-negative weights allocate each already-defined aggregate component total
  over configured physical pixel IDs. A floating-point correction on the
  largest-weight pixel makes each pixel sum equal its aggregate component; no
  per-pixel minimum or independently rounded amplitude remains.
- Sun and Moon weights use local incidence squared times mount visibility.
  Earth retains the existing thresholded directional albedo response as its
  weight. GRB weights retain the configured footprint and incidence exponent.
- The live estimator now uses acquisition time (`frameIndex × 0.2 s`) for its
  state-transition interval. Accelerated orbital time remains separately stored
  on each sample and in persisted photon records.
- The positive-clipped curve previously labeled transient/residual was removed.
  The source area is explicitly labeled injected source truth, normalized
  innovation remains signed, and the source-window aggregate is labeled signed
  excess. The injected-source HUD is explicitly not a detection significance.

Inputs and versions:

- Rito `public/data/pixbkg.txt`, unchanged and checksum-validated under its
  existing provenance record; used only as the Reference Mode baseline.
- Existing ECI replay and current coefficients: Sun `260 counts/s` maximum,
  Moon `22 counts/s` coefficient, Earth `85 counts/s` coefficient and GRB
  `135 counts/0.2 s` maximum before transmission/time response. All remain
  **PROVISIONAL** and physically uncalibrated.
- Default observation and automatic-event random streams remain seed-derived
  and deterministic.

Files changed by this revision:

- `app/lib/signal-composition.ts` (new pure mode contract and reconciliation);
- `app/page.tsx`;
- `app/components/adaptive-background-panel.tsx`;
- `app/lib/kalman-scenarios.ts`;
- `tests/signal-composition.test.ts` (new);
- `tests/dashboard-layout.test.ts`;
- `tests/kalman-scenarios.test.ts`;
- this provenance record.

Independent read-only review: `simulator_engineer` confirmed the original Rito
leak into Simulation Mode, missing Sun/Moon pixel allocation, unreconciled
Earth/GRB totals, `pixbkg` availability dependency, and time-warp/filter `dt`
mismatch. No reviewer code was used without coordinator inspection.

Limits and open gates:

- Directional allocation changes bookkeeping consistency, not physical
  validity. Effective area, spectral response, dead time, correlations and
  environmental calibration remain absent.
- The Rito dataset's physical domain and possible overlap with environmental
  terms remain unresolved; Reference Mode therefore remains provisional.
- `±4` is an internal robust-filter gate, not a calibrated trigger or discovery
  significance. Injected source truth is known only because the simulator
  generated it.
- Quantitative, reproducibility, domain-expert and browser visual audits remain
  required before scientific-result or release claims.
