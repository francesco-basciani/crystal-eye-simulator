# CE-SIM-20260824-melissa-satellite-groundtrack-staging

## Objective and authorization

- Date: 2026-08-24 (Europe/Rome).
- Objective: stage the satellite ground-track supplied by Melissa as an
  immutable, validated simulator input and prepare bounded interpolation,
  before changing the canonical runtime trajectory.
- Baseline revision: `b81de46` (`Shorten orbital observation title`).
- Author authorization: replace the simulator satellite trajectory with the
  supplied equatorial LEO scenario (550 km, 5° inclination, nominal 95.65 min,
  epoch 2031-01-01, 8 s samples).
- Scope gate: because the input contains only one satellite orbit and no
  Sun/Moon positions for 2031, the runtime switch and any continuation policy
  remain pending explicit author decisions. No deployment was authorized.

## Input and provenance

- Original path: `/Users/basciani/Downloads/groundtrack_orbit1.txt`.
- Repository asset: `public/data/groundtrack-orbit1-melissa.txt`.
- Copy check: byte-for-byte equality verified with `cmp`.
- SHA-256:
  `a35d9d4e62f7715a211fb904ceb65d94b552fd27de11bdc3ee1e0f4eb6ff027e`.
- Source schema: UTC, ECI XYZ km, ECEF XYZ km, geocentric latitude degrees,
  longitude degrees, altitude km.
- Source extent: 718 records from `2031-01-01T00:00:00Z` through
  `2031-01-01T01:35:36Z`, at an exact 8 s cadence.
- Random seed: none; parsing and interpolation are deterministic.

## Verified facts and unresolved physical questions

Engineering checks reproduce these source properties:

- ECI radius is approximately 6928.1 km;
- latitude spans exactly -5° to +5°;
- the altitude column is uniformly 550 km;
- sampled duration is 5736 s;
- the header declares 95.65 min, equal to 5739 s;
- 718 records at 8 s cadence correctly place the final source row at 5736 s,
  leaving an unsampled 3 s tail before the declared orbital period;
- the angle between the final and initial ECI vectors is approximately
  0.67770364°.

Independent quantitative validation found that the 95.65 min declaration is
consistent with the Keplerian period at 6928.1 km: using
`mu=398600.4418 km^3/s^2` gives 5738.94684 s (95.64911 min). It also found that
the ECI vectors are reproduced to approximately 2.48 m by a provisional
circular-orbit model including J2 nodal precession. Thus the endpoint angle is
not evidence of a period inconsistency. The source contains no next-orbit row,
however, so interpolating directly back to its initial vector would discard
the accumulated plane precession. No continuation policy has been selected.

The existing canonical celestial asset supplies satellite, Sun, and Moon ECI
positions for 2033. Melissa's input supplies only the satellite for 2031.
Pairing these sources by changing one timestamp would be physically
misleading. A composition policy or a coherent Sun/Moon source for 2031 is a
human/domain gate.

The source ECI and ECEF vectors are identical at the initial timestamp. Its
ECEF transformation is consequently scenario-relative and is not assumed to
use standard absolute GMST. The ECEF, latitude, and longitude columns are
preserved but are not yet wired into Earth rotation or detector physics.

The input's 6928.1 km radius minus its 550 km altitude implies a 6378.1 km
reference radius. The simulator currently uses 6371 km for spherical Earth
geometry. Changing that radius affects occultation and albedo and requires
physicist validation plus author approval.

## Implementation

- `public/data/groundtrack-orbit1-melissa.txt`: immutable source asset.
- `app/lib/satellite-groundtrack.ts`:
  - strict schema, extent, cadence, range, and SHA-256 validation;
  - typed preservation of all source columns;
  - binary-search sampling inside the supplied interval only;
  - radius-preserving ECI/ECEF interpolation between adjacent source rows;
  - shortest-path longitude and linear scalar interpolation;
  - explicit continuity diagnostics exposing the 3 s unsampled tail and
    endpoint separation without inferring a new period;
  - no extrapolation, wrap, modulo, propagator, or runtime source switch.
- `tests/satellite-groundtrack.test.ts`: asset golden test, source properties,
  exact/interpolated sampling, range rejection, continuity diagnostics, cadence
  rejection, and hash tamper rejection.

## Agents and tools

- Coordinator: `ce_coordinator` task context.
- Domain requirements analysis: `physics_requirements_analyst` (read-only).
- Architecture analysis: `dt_architect` (read-only).
- Implementation and test execution: coordinating agent because the available
  thread limit prevented starting a separate `simulator_engineer` task.
- Tools: Git, SHA-256, `cmp`, TypeScript, Node test runner, ESLint, and Next.js
  production build. No new runtime dependency was introduced.

## Commands and current results

```sh
cmp -s /Users/basciani/Downloads/groundtrack_orbit1.txt \
  public/data/groundtrack-orbit1-melissa.txt
# PASS

shasum -a 256 public/data/groundtrack-orbit1-melissa.txt
# a35d9d4e62f7715a211fb904ceb65d94b552fd27de11bdc3ee1e0f4eb6ff027e

node --experimental-strip-types --test tests/satellite-groundtrack.test.ts
# PASS: 5/5

npx tsc --noEmit
# PASS

git diff --check
# PASS
```

```sh
npm test
# PASS: 115/115

npm run lint
# PASS: 0 errors; one pre-existing Next.js <img> optimization warning

npm run build:pages
# PASS: 5 static application routes plus the not-found route

npx tsc --noEmit
# PASS

git diff --check
# PASS
```

## Status and gates

- Asset identity/schema/cadence: engineering **VERIFIED**.
- Interpolation inside recorded adjacent samples: engineering **VERIFIED**.
- 550 km and 5° reproduction: engineering **VERIFIED**, still requiring domain
  confirmation before supporting a scientific claim.
- ECI/ECEF absolute frame interpretation: **PROVISIONAL**.
- Declared 95.65 min period: numerically **VERIFIED** against the circular
  Keplerian period at the supplied radius; physicist confirmation still
  required before scientific use.
- J2 precession interpretation: **PROVISIONAL**, quantitatively supported but
  not documented by the source file.
- Runtime replacement: **PLANNED**, pending author decision.
- Periodic extension beyond the first orbit: **PLANNED**, pending author and
  domain approval.
- 2031 satellite plus Sun/Moon composition: **PLANNED**, pending a coherent
  source/policy and approval.
- Earth reference radius change: **PLANNED**, pending domain validation and
  author approval.
- No commit, push, online deployment, manuscript edit, or modification of
  `Materiale/` or `Appunti/` was performed in this staging task.
