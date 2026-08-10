# CE-SIM-20260810 — Reproducible Kalman scenarios demonstrator

## Task, authorization, and boundary

- **Date:** 2026-08-10 (Europe/Rome).
- **Objective:** add an ASI-presentation demonstrator with versioned scenarios,
  seeded Poisson observations, an aggregate background Kalman estimator, plots,
  provisional metrics, and the same analysis path for presets and the current
  simulator GRB stream.
- **Author authorization:** explicit on 2026-08-10 for the recommended minimal
  demonstrator, subsequently clarified so that GRB scenarios are an alternative
  to Earth occultation. A follow-up quantitative sanity check required a
  separate bright 100%-amplitude presentation case as the initial ASI display;
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
| `bright-grb-presentation-v1` | initial ASI presentation display | 60 s, 0.2 s exposure and simulation step, `5711.5784 counts/s` background, `675 counts/s` peak FRED source at 20 s, 1.1 s decay, 4 s bounded interval | `PROVISIONAL`; synthetic 100%-amplitude simulator case |
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

## Files produced or modified

- `app/lib/kalman-scenarios.ts`: pure scenario, seeded observation and Kalman
  analysis core.
- `app/components/kalman-scenario-dialog.tsx`: shared preset/live controls,
  plots, metrics and permanent warning.
- `app/page.tsx`: stable live analysis frames, current-source adapter, launcher
  and dialog integration.
- `app/globals.css`: launcher, responsive dialog and SVG plot styling.
- `tests/kalman-scenarios.test.ts`: replay, Poisson, scenario, live-time,
  gating, metric and covariance tests.
- `tests/dashboard-layout.test.ts`: launcher, label, live adapter and plot
  integration assertions.
- `docs/provenance/CE-SIM-20260810-kalman-scenarios.md`: this record.

Final implementation hashes before handoff:

- `app/lib/kalman-scenarios.ts`:
  `c6b2231e3d9c0e15be2845c59af7ed58a142d878f3fa14f0888b389982244190`;
- `app/components/kalman-scenario-dialog.tsx`:
  `d8fae131d8d3b528b89e0719e5d48949a2c8ee5b1024d9da844a94a4bec0050c`;
- `app/page.tsx`:
  `9b741622721d69aa6d57aef126f730439eb84d734d2a04677ba216e623075f3a`;
- `app/globals.css`:
  `d3654e19a1b336c5ebd9d875e4005ac2c93fade80b68fbc088b2152b03bd40e3`;
- `tests/kalman-scenarios.test.ts`:
  `4bf2866c7ac8d00676646dc2ede543165af97ce22377bcc4ef81af17ad55c78d`;
- `tests/dashboard-layout.test.ts`:
  `637d6580ee016ec9f15c33fa13ea3e98fab8dd306ac7c2bc0ae79e43f9432556`.

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
# PASS: 43 tests, 43 passed, 0 failed

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ./node_modules/.bin/tsc --noEmit --allowImportingTsExtensions
# PASS

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run lint
# PASS

PATH="/Users/basciani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build:pages
# PASS: compiled, TypeScript checked, 5/5 static pages generated

curl --fail --silent http://localhost:3000/
# PASS: rendered launcher contains the ASI bright-GRB label and permanent warning

git diff --check
# PASS
```

The in-app browser runtime exposed no available browser instance, so interactive
visual QA could not be completed in that surface. This is an explicit remaining
verification item rather than an inferred visual pass.

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
