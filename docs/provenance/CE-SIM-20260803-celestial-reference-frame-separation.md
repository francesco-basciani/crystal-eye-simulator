# CE-SIM-20260803-celestial-reference-frame-separation

## Task, authorization, and scope

- Task ID: `CE-SIM-20260803-celestial-reference-frame-separation`.
- Date: 2026-08-03 (Europe/Rome).
- Baseline repository revision:
  `9f135e685a88106d75a7c65219344994bce5c48f`.
- Author authorization: correct the simulator so that Sun and Moon use the
  physicist workbook ECI positions as independent celestial trajectories;
  use geocentric ECI directions in the central Earth-system view and
  topocentric directions from the selected satellite position in detector/FOV
  calculations; make the canonical ECI satellite replay the default; keep a
  clearly separate parametric scenario; remove misleading automatic camera
  motion; add source-point tests and provenance.
- Scope: `crystal-eye-simulator/` only. No change was made to `Materiale/`,
  `Appunti/`, the manuscript, dependencies, external services, or deployment.
- Existing dirty worktree content was preserved. No commit, push, publication,
  or deployment was performed.

## Inputs and versions

- Source workbook:
  `/Users/basciani/Downloads/Posizioni-SAT-SUN-MOON.xlsx`.
- Workbook SHA-256:
  `99d5b7c55815dfdb52b91387056f6e06ef54242a25adda8f5136c438894e1d75`.
- Worksheet used: `ECI`, 9,304 UTC-ordered records with satellite, Sun, and
  Moon Cartesian positions in km.
- Derived runtime asset: `public/data/eci-ephemeris-2033.tsv`.
- Runtime asset SHA-256:
  `95d42bdbf86e0452e50b2096a2d14c101a92a700b54af16475e1abd41b24e7e6`.
- Supported interval: `2033-01-01T00:00:00.000Z` through
  `2033-03-01T23:50:39.000Z`.
- Runtime/tool versions used for verification: Node 22.19.0, Python 3.12.2,
  TypeScript 5.9.3, ESLint 9.39.4, Vite 8.0.13, vinext 0.0.50.
- Extraction was rerun with the existing Python standard-library extractor;
  the result compared byte-for-byte equal to the bundled TSV.

## Defect observed

Before this correction, `getCelestialGeometry` subtracted the selected
satellite position from the workbook Sun and Moon ECI vectors and supplied
those topocentric directions to every consumer. That is appropriate for an
instantaneous detector/FOV observer but not for a geocentric Earth-system
display. The central 3-D and 2-D geometry views therefore coupled the displayed
celestial directions to the satellite scenario. In addition, the parametric
satellite override was applied unconditionally using default altitude and
inclination values, so the nominal initial state was not the canonical
satellite replay. The orbit camera also added yaw automatically while playback
was running, which could visually suggest common motion.

## Implemented frame contract

`app/lib/celestial-reference-frames.ts` now derives two explicit sets of
directions from one ECI sample:

- geocentric Earth-system directions:
  `unit(SUN_ECI)` and `unit(MOON_ECI)`;
- detector/FOV topocentric directions:
  `unit(SUN_ECI - SAT_ECI)` and `unit(MOON_ECI - SAT_ECI)`.

The selected satellite may be the canonical workbook satellite or an explicit
parametric scenario satellite. Changing that satellite changes the detector's
topocentric directions and boresight separation, but it cannot change the
geocentric Sun or Moon directions.

`app/page.tsx` applies this contract as follows:

- `GlobeScene` receives the geocentric Sun/Moon directions;
- the `SystemGeometryCanvas` geometry tab receives the geocentric Sun/Moon
  directions;
- Sky/Mask/Events FOV rendering, mounted visibility, separation, Moon distance,
  and Sun/Moon response use the topocentric directions;
- state starts in `canonical` mode, which uses `sample.satelliteKm` directly;
- `parametric` mode is separately and explicitly selectable, and only then are
  altitude/inclination controls shown and the satellite ECI position replaced;
- UI labels identify `CANONICAL ECI REPLAY` versus
  `PARAMETRIC SATELLITE SCENARIO`;
- automatic orbit-camera yaw was removed; orbit-camera rotation now changes
  only through pointer drag, while satellite-follow remains an explicit camera
  mode.

No physical orbit propagator, body ephemeris, attitude law, or response model
was introduced.

## Quantitative reference checks

The existing independent quantitative audit supplied the workbook and TSV
hashes, record count, exact first/last source vectors, and selected separation
metrics. The implementation tests additionally use the exact middle record at
index 4,652. Reference directions and angles were independently recomputed
from the ECI Cartesian values with normalized dot products.

Selected source points covered by automated tests:

| UTC | Sun–Moon geocentric separation | Sun boresight separation | Moon boresight separation |
| --- | ---: | ---: | ---: |
| 2033-01-01 00:00:00Z | 7.3150757581° | 154.4778916430° | 161.0075781958° |
| 2033-01-30 23:59:58Z | 4.9123997793° | 141.5624150555° | 144.6906038899° |
| 2033-03-01 23:50:39Z | 9.5486856445° | 95.3833823493° | 88.6036343712° |

Summing angular changes between every adjacent bundled ECI row gives
60.83604557° for the Sun and 795.50611845° for the Moon. The earlier audit
summary reported 60.8372° for the Sun and 795.5062° for the Moon. The Moon
values agree at the reported precision; the Sun difference is about 0.00115°.
Because the earlier computation method was not captured in this subtask, the
test records the value directly reproduced from the versioned TSV and does not
claim that the discrepancy is resolved.

## Files produced or modified by this task

- `app/lib/celestial-reference-frames.ts`: pure frame-specific direction and
  angular-separation functions.
- `app/page.tsx`: canonical/parametric mode selection, consumer-specific frame
  wiring, labels, actual displayed altitude, and removal of camera auto-yaw.
- `tests/celestial-reference-frames.test.ts`: exact source records and derived
  direction/separation checks at the start, middle, and end; independence test;
  complete-path regression test.
- `docs/provenance/CE-SIM-20260803-celestial-reference-frame-separation.md`:
  this execution record.

Other modified or untracked files shown by Git pre-existed this task and were
not reverted.

## Commands and results

```sh
python3 scripts/extract-eci-ephemeris.py \
  /Users/basciani/Downloads/Posizioni-SAT-SUN-MOON.xlsx \
  /tmp/eci-check.tsv
# PASS: 9304 records; SHA-256 95d42...e7e6

cmp /tmp/eci-check.tsv public/data/eci-ephemeris-2033.tsv
# PASS: byte-identical

npx --yes node@22.19.0 --experimental-strip-types \
  --test tests/*.test.ts
# PASS: 22/22

npx --yes node@22.19.0 node_modules/typescript/bin/tsc \
  --noEmit --allowImportingTsExtensions --incremental false
# PASS

npx --yes node@22.19.0 node_modules/eslint/bin/eslint.js . \
  --ignore-pattern dist --ignore-pattern .next
# PASS

WRANGLER_LOG_PATH=.wrangler/wrangler.log \
  npx --yes node@22.19.0 node_modules/vinext/dist/cli.js build
# PASS; existing non-blocking >500 kB chunk warning

git diff --check
# PASS
```

Independent root verification repeated the complete 22-test suite and the
TypeScript no-emit check successfully. The local simulator was then reloaded
and inspected in the in-app browser. The central scene rendered normally with
`CANONICAL ECI REPLAY`, the source altitude (`557.1 km` at the first row), and
the orbital configuration showed `CANONICAL ECI REPLAY · RECOMMENDED` selected
with the parametric scenario available separately. A second clean reload
produced no new console errors. Historical development-server errors recorded
during hot-module replacement, while component props were being rewired, were
not reproduced by the completed application.

The first combined test attempt had 21 passing tests and one failing newly
added total-Sun-path assertion because it used the rounded audit summary
60.8372°. Direct recomputation from all versioned ECI rows produced
60.83604557°. The golden value was corrected to the directly reproducible TSV
result and the complete suite then passed.

## Roles, approvals, and status

- Author decision to implement this correction: **AUTHOR-APPROVED**.
- Dataset identity, extraction equality, selected Cartesian values, normalized
  direction calculations, and automated checks: engineering **VERIFIED**.
- Quantitative audit inputs reused: workbook/TSV hashes, record count,
  endpoints, and separation/path summaries. The task could not start a new
  `quantitative_validator` or `simulator_engineer` thread because the active
  collaboration thread limit was reached; the coordinator explicitly directed
  direct implementation and reuse of the prior audit.
- Physical meaning of the workbook frame, ECI epoch/equinox, attitude law,
  detector response amplitudes, Moon illumination source, and environmental
  model: **PROVISIONAL**, pending domain-expert validation and later author
  approval where required.
- No manuscript claim or validated physical capability is asserted by this
  change.

## Limitations and open questions

- The workbook identifies the worksheet as ECI but does not, in the artifacts
  inspected here, provide epoch/equinox, reference realization, uncertainty,
  covariance, or Earth-orientation parameters.
- The scene mapping `(ECI x, y, z) -> (Three.js x, z, y)` and anti-Earth
  boresight attitude remain existing provisional visualization assumptions.
- Cartesian interpolation between source rows is an engineering replay policy,
  not an ephemeris or orbit propagator.
- The central view intentionally displays distant bodies at fixed illustrative
  radii. Their direction is data-derived; displayed distance and body size are
  not to scale.
- Satellite-follow camera motion remains available only through the explicit
  `SATELLITE TOP VIEW` camera selection. The default orbit camera has no
  automatic yaw.
- The Sun total-path discrepancy described above remains open until the earlier
  audit computation and exact input precision are reproduced side by side.
