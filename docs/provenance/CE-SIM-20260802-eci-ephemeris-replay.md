# CE-SIM-20260802-eci-ephemeris-replay

## Objective, authorization, and acceptance criteria

- Date: 2026-08-02 (Europe/Rome).
- Objective: make the approved `ECI` worksheet the canonical runtime source
  for the satellite, Sun, and Moon positions during the supplied 60-day 2033
  scenario.
- Baseline simulator revision:
  `9f135e685a88106d75a7c65219344994bce5c48f`.
- Author decision: integration of
  `/Users/basciani/Downloads/Posizioni-SAT-SUN-MOON.xlsx` was explicitly
  **AUTHOR-APPROVED** on 2026-08-02.
- Acceptance criteria implemented:
  1. all three positions come from the same ECI row pair;
  2. replay is limited to the dataset interval and never extrapolates;
  3. satellite interpolation does not introduce chord-induced altitude loss;
  4. the primary UI is fixed to the 2033 replay instead of editable synthetic
     altitude/inclination controls;
  5. Earth texture rotation follows replay UTC through documented GMST, without
     the former synthetic axial tilt or wall-clock rotation;
  6. display-only spherical interpolation removes 5 Hz direction jumps while
     detector geometry remains on the exact replay sample;
  7. coordinate-frame mapping and anti-Earth attitude remain explicitly
     **PROVISIONAL** in this record pending domain validation.

This authorization covers simulator integration only. It does not make the
frame, attitude, environmental response, or scientific interpretation
`DOMAIN-VALIDATED`, and it does not authorize a manuscript result or deploy.

## Input and derived runtime asset

- Source workbook: `Posizioni-SAT-SUN-MOON.xlsx`.
- Workbook size: 2,113,280 bytes.
- Workbook SHA-256:
  `99d5b7c55815dfdb52b91387056f6e06ef54242a25adda8f5136c438894e1d75`.
- Canonical worksheet: `ECI`, columns `UTC time`, satellite XYZ, Sun XYZ,
  and Moon XYZ, with every position in km.
- Records: 9,304, strictly increasing.
- Supported interval: `2033-01-01T00:00:00.000Z` through
  `2033-03-01T23:50:39.000Z`.
- Runtime asset: `public/data/eci-ephemeris-2033.tsv`.
- Runtime asset size: 936,952 bytes.
- Runtime asset SHA-256:
  `95d42bdbf86e0452e50b2096a2d14c101a92a700b54af16475e1abd41b24e7e6`.

The standard-library extraction script reads the workbook container directly,
selects only `ECI`, validates the exact schema and 2033 extent, and emits LF
terminated ASCII TSV. It removes spreadsheet binary-float display artifacts by
rounding only within `1e-9` km of the effective source precision: satellite
XYZ to 0.01 km, Sun XYZ to 1 km, and Moon XYZ to 0.1 km. Extraction fails if a
cell exceeds that tolerance. No third-party parser or runtime dependency was
added.

## Implementation and traceability

- `scripts/extract-eci-ephemeris.py`: reproducible XLSX-to-TSV derivation and
  schema/precision validation.
- `app/lib/eci-ephemeris.ts`: strict parser, full-asset SHA-256 validation,
  binary-search sampler, explicit range error, interpolation, deterministic
  GMST, and unit-direction spherical interpolation. Dataset integrity metadata
  is kept separate from frame and attitude assumptions; the validated profile
  has no scientific-status field.
- `app/page.tsx`: fail-closed asset loading, 2033-only UTC selector, exact stop
  at the last sample, reset to the first sample, and direct ECI replay wiring
  into celestial geometry, detector boresight, 3-D scene, and geometry views.
  The former synthetic orbit ellipse and editable synthetic altitude and
  inclination controls are not used in replay mode. Earth has no synthetic
  `23.4°` scene tilt and no wall-clock rotation.
- `tests/eci-ephemeris.test.ts`: asset golden test, exact endpoints, range
  rejection, shared SAT/SUN/MOON row interpolation, satellite-radius
  preservation, malformed-input rejection, hash rejection, absence of a
  profile status field, GMST reference checks, and spherical display-direction
  interpolation checks.

Satellite interpolation uses spherical interpolation of direction and linear
interpolation of endpoint radii. Consequently the interpolated satellite norm
equals the linearly interpolated radius instead of the shorter Cartesian chord
radius. Sun and Moon ECI positions use linear Cartesian interpolation between
the same bracketing timestamps. At the midpoint of the first interval, the
linear Cartesian satellite chord would reduce the radius by more than 200 km;
the implemented radius-preserving interpolation avoids that artifact.

The scene remaps ECI `(x, y, z)` to the existing Three.js convention
`(x, z, y)`. The payload boresight is the normalized geocentric satellite
vector (anti-Earth). These are visualization/attitude assumptions, not
validated properties of the source workbook, and remain **PROVISIONAL**.
No ECI coordinate is presented as terrestrial latitude or longitude. Moon
phase continues to come from the pre-existing Astronomy Engine calculation at
the replay timestamp; it is not a position source. Existing Sun/Moon/albedo
amplitude formulas remain separate provisional simulator models.

Earth rotation uses the Greenwich Mean Sidereal Time expression in equation
3-47 of Vallado et al., *Revisiting Spacetrack Report #3* (AIAA 2006-6753),
available from
<https://celestrak.org/publications/AIAA/2006-6753/>. The ECI-to-Three.js axis
mapping makes the equatorial pole the scene Y axis; therefore the Earth group
has zero X/Z tilt and a Y rotation equal to negative GMST under Three.js's
rotation convention. The workbook supplies UTC but no DUT1/EOP values, so the
implementation uses UTC as a UT1 proxy. This approximation affects Earth
texture longitude, not the canonical ECI vectors or detector geometry.

The render transitions satellite, Sun, and Moon unit directions, displayed
satellite altitude, and the timestamp driving GMST over 220 ms. Because replay
telemetry targets normally arrive every 200 ms, transitions overlap and each
new transition starts at the currently rendered state rather than freezing for
the remainder of a tick. This smoothing is display-only. At steady nominal
cadence its peak temporal display lag is approximately `speed × 0.22` simulated
seconds (about 110 simulated seconds at 500×); browser throttling can increase
wall-clock latency. Detector response, FOV decisions, history, and telemetry
continue to use the exact unsmoothed ECI sample.

## Agents, tools, and versions

- Coordination and scope: `ce_coordinator` task delegation.
- Implementation: `simulator_engineer` subtask.
- Tools: Git, Python standard library (`zipfile`, XML, `decimal`), SHA-256,
  Node test runner, ESLint, TypeScript, and vinext/Vite build.
- Python: 3.x system runtime; extraction is deterministic and seedless.
- Verification Node runtime: 22.19.0, consistent with the repository engine
  requirement `>=22.13.0`.

## Commands and results

```sh
python3 scripts/extract-eci-ephemeris.py \
  /Users/basciani/Downloads/Posizioni-SAT-SUN-MOON.xlsx \
  public/data/eci-ephemeris-2033.tsv
# PASS: records=9304 bytes=936952
# sha256=95d42bdbf86e0452e50b2096a2d14c101a92a700b54af16475e1abd41b24e7e6

npx --yes node@22.19.0 --experimental-strip-types \
  --test tests/*.test.ts
# PASS: 11/11 tests (7 ECI replay + 4 existing background tests)

npx --yes node@22.19.0 node_modules/eslint/bin/eslint.js . \
  --ignore-pattern dist --ignore-pattern .next
# PASS

npx --yes node@22.19.0 node_modules/typescript/bin/tsc \
  --noEmit --allowImportingTsExtensions
# PASS

WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  npx --yes node@22.19.0 node_modules/vinext/dist/cli.js build
# PASS; existing non-blocking chunk-size warning (>500 kB)
```

The first plain `npm test` attempt did not execute tests because the active
shell exposed Node 16.20.2, which does not support
`--experimental-strip-types`. Verification was rerun successfully under Node
22.19.0 without changing project dependencies.

## Coordinator review gate

The coordinator independently regenerated the TSV from the recorded workbook,
compared it byte-for-byte with the bundled asset, and reproduced its SHA-256.
The coordinator also reran all eleven tests, ESLint, TypeScript with incremental
output disabled, and `git diff --check`; all passed. Two untracked pnpm files
created as incidental build artifacts were removed because no package-manager
or dependency change was authorized.

Review also confirmed that the scene, detector view, and burst boresight use
the replayed satellite direction directly; no ECI coordinate is labelled as a
terrestrial latitude/longitude, and the former synthetic orbit line is absent.
At the author's direction, the provisional frame/attitude status remains only
in this provenance record and is not attached to the validated dataset profile
or displayed as a status label in the user interface. Review additionally
removed the former synthetic Earth tilt and wall-clock spin; GMST and display
direction interpolation have deterministic unit coverage.

## Status and limitations

- Workbook identification and hash: engineering checks reproduced; independent
  `quantitative_validator` audit pending.
- Derived runtime asset schema, hash, records, and interval: engineering checks
  reproduced; independent `quantitative_validator` audit pending.
- Parser, bounded sampling, and interpolation behavior: engineering checks
  reproduced; independent `quantitative_validator` audit pending.
- Type checking, lint, and production build: engineering checks reproduced.
- Dataset integration decision: **AUTHOR-APPROVED**.
- ECI frame epoch/equinox, handedness, scene-axis interpretation, and payload
  attitude: **PROVISIONAL**, pending physicist validation and final author
  approval.
- The source workbook remains outside the repository in the author's Downloads
  directory; exact regeneration requires that byte-identical input or another
  archived copy with the recorded hash.
- The last source record precedes the nominal end of 60 complete days by
  9 minutes 21 seconds. Replay stops at that record and does not fill or
  extrapolate the missing interval.
- Interpolation is an engineering replay policy, not an orbit propagator; no
  uncertainty, covariance, velocity, maneuver, or higher-order dynamics are
  supplied by the workbook.
- Earth rotation uses UTC as a UT1 proxy because DUT1/EOP data were not
  supplied; this is a bounded visualization limitation, not a change to ECI
  dataset integrity.
- The 220 ms display smoother deliberately lags visual targets slightly and
  does not alter detector calculations or exported telemetry.
- No commit, push, deployment, publication, manuscript edit, or change to
  `Materiale/` or `Appunti/` was performed.
