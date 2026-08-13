# CE-SIM-20260813 — Payload occlusion and detector-excitation integration

## Scope and authorization

- Date: 2026-08-13 (Europe/Rome).
- Baseline: `cbb4322`.
- Author-approved mode contract (option B): Reference includes the Rito pixel
  reference plus visible Sun, Moon, and Earth components; Simulation excludes
  Rito and contains visible Sun, Moon, and Earth only. A configured GRB remains
  separate and additive in both modes.
- Approved implementation evidence inspected selectively: `bca5a00`,
  `8e9cb67`, and `eab443e`. The commits were not cherry-picked because later
  checkpoint/revert work and the current filter/localizer overlap `app/page.tsx`.

The change is PROVISIONAL software behavior. It is not a calibrated detector
response, flight telemetry, or domain validation of the physical model. No
dependency, amplitude, temporal response, incidence exponent, or physical
constant was added or changed.

## Implemented contract

- Mount X/Z use a versioned local-browser record and fail closed on malformed
  storage. The configuration hub states persistence, and the geometry view
  shows the selected location on the 60 × 60 cm platform.
- Earth albedo uses local sub-satellite solar incidence
  `max(0, dot(outward, geocentric Sun))` and binary point-center nadir
  visibility. Only outer-ring centers strictly beyond the opaque platform
  boundary have support; center/edge/corner placement changes that support.
- The detector response is composed once per frame from separate Rito, Sun,
  Moon, Earth, and GRB vectors. Rito contributes to Reference background only
  and never contributes to the excitation vector. Sun, Moon, Earth, and GRB
  excitation drives the same planar, Sensor, and 3D active-pixel state.
- Aggregate background and total expected values are the actual JavaScript
  reductions of their composed pixel vectors. Source is the residual total
  expected minus background, while Reference observations and the Poisson
  intensity use total expected directly. Deterministic fuzz fixtures verify the
  resulting aggregation path in both modes. Requested component totals can
  differ by floating-point summation residue; no scientific amplitude adjustment
  is claimed.
- Present detector excitation vectors must contain exactly 126 finite,
  non-negative entries. An absent vector is accepted only as a zero bootstrap
  frame.

## Verification

Targeted tests cover:

- noon, terminator, and midnight solar incidence;
- center, edge, and corner placement plus outer-ring-only support;
- actual aggregate/vector reconciliation with 10,000 deterministic fixtures
  in each mode;
- Reference/Simulation option-B semantics;
- Rito baseline without excitation and visible-source excitation;
- 126-entry detector guard; and
- versioned placement round-trip and malformed-storage rejection.

Workspace-compatible Node runtime: `v24.19.0`. Final commands:

```text
npm test -- --runInBand
npm run lint
npx tsc --noEmit --incremental false --allowImportingTsExtensions
GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/crystal-eye-simulator npm run build:pages
git diff --check
```

Results: **63/63 tests PASS**, ESLint **PASS**, TypeScript **PASS**, static
Next.js build **PASS** for `/`, `/_not-found`, `/ephemeris`, and
`/photon-history`, and diff check **PASS**. An alternative build invocation in
the implementing agent process was blocked before compilation by existing
macOS Team-ID/native-binding errors; no dependency was installed. The
coordinator's workspace-runtime build above completed successfully.

The independent quantitative validator used fresh imports of the frozen files.
It reproduced the mode-B canonical fixture, the center/edge/corner supports
`0/35`, `18/35`, and `26/35`, noon/terminator/midnight incidence `1/0/0`, the
126-entry guard, Rito-free excitation, and byte-identical pre-existing filter
and localizer modules. Across 20,000 standard and 40,000 adversarial composed
frames, aggregate background and aggregate total expected were bitwise equal to
their authoritative pixel-vector reductions, and the reconciled source
residual was always non-negative. Across 50,000 component allocations, the
reported allocated total equaled the actual vector reduction.

The residual source `totalExpected - background` is not claimed to be bitwise
equal to the independently reduced source vector. The largest standard-fixture
difference was `8.30e-12` counts/bin; adversarial values near `1.34e13` counts
had relative difference about `1.94e-14`. This is floating-point aggregation
order, not a calibrated physical uncertainty. Reference output and Simulation
Poisson intensity use authoritative total expected directly, so it does not
alter the observation total.

Browser QA on the frozen functional snapshot passed with zero console errors.
Reference displayed `RITO + VISIBLE SUN/MOON/EARTH`, retained the blue Rito
per-pixel baseline, and showed Earth at `0 c/s` on the sampled nightside.
Simulation displayed `VISIBLE SUN/MOON/EARTH ONLY · RITO EXCLUDED`; Rito was
absent from its detector response. The placement panel was accessible and
reported center `0/35`, edge `18/35`, and corner `26/35` exposed outer pixels.
After selecting corner `(+30, -30) cm` and reloading, `26/35` was restored,
confirming browser persistence. Visual layout was coherent. The screenshot was
used only for transient QA and was not retained as a project artifact.

No commit, push, deployment, publication, or generated QA artifact was
performed or retained by the implementing agents.
