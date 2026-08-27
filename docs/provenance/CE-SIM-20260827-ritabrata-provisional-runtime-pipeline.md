# CE-SIM-20260827 — Ritabrata provisional runtime pipeline

## Status and authorization

- Date: 2026-08-27 (Europe/Rome)
- Baseline: `632fcf3752cf62a1790df4a2213849c0dc4c4962`
- Author authorization: integrate the Ritabrata pipeline as `PROVISIONAL`, test
  configured/random bursts, stage the verified converted web kernels, keep the
  engineering positive-excess centroid as a comparison, and do not push before
  review.
- Implementation: COMPLETE LOCAL CANDIDATE
- Quantitative benchmark: `VERIFIED` by an independent validator
- Scientific/domain status: `PROVISIONAL`
- Publication: NOT PERFORMED

## Objective

Create one working browser vertical slice:

```text
configured/random detector-local direction
  -> nearest CEGenGRB database response + default CPL
  -> 126 pixel rate + deposited-energy spectrum + MC Sumw2 errors
  -> exact CELoc observation bridge
  -> provisional CELoc localization
  -> explicit ROOT-local to Three.js/scene adapter
  -> RA/Dec and comparison with injected truth and engineering centroid
```

Orbit, albedo, payload geometry and existing dashboard layout were not changed.

## Inputs and provenance

Source inputs and original hashes remain those recorded in
`CE-SIM-20260826-ritabrata-grb-generator-port.md`. No ROOT file is included in
the web bundle.

The source conversion directory was
`/tmp/cegen-converted-20260826`. It contained a pre-frame-migration manifest
and a golden JSON using the historical key `amplitudeAt100KeV`. The checked
promotion script verifies every source artifact hash, changes only the declared
frame, approved parity metadata and the key `normalization`, and reproduces the
public bundle byte-for-byte.

### Published-directory candidate (local only)

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| manifest | 1,151,551 | `0c1c608ad0c541936d70ea3472ee4b164b1fd069c7b54ab7cb64d1cf2cd01922` |
| golden JSON | 14,986 | `dbac50fc10b70d567a0d480700207088651e9d04b259e65574320a992437d0ff` |
| pixel mean kernel | 31,794,218 | `8defd2df8ee92ae9e1914a0d658bf432e4d5fda179cae49f744538d1f8614a71` |
| pixel variance kernel | 32,061,632 | `6131c4a92ac3a3830879184a3f1bc9552c0a4d921de00f4f704417cb2e8ee70b` |
| deposited-energy mean kernel | 5,453,761 | `cea5de1de9d7b4335f5a31ecff29ae758af7ababa935c75f36990ee7bd17d76b` |
| deposited-energy variance kernel | 5,450,387 | `5962641d8a21d65597ff5ade3a1826c1ae3ccc9291c36dcdd1fa29dbc7030728` |

Total: 75,926,535 bytes. The four neutral-extension `.bin` files contain 3,940
independently hashed, range-addressable gzip members. The `.bin` transport name
prevents development/static servers from applying automatic whole-file gzip
content decoding to a partial member response. Member bytes are unchanged. The
original 697.9 MB ROOT database is not shipped.

## Trust boundary

The approved source provenance, supplied ROOT golden output and exact promoted
manifest SHA-256 are code-pinned. The loader hashes the raw manifest bytes
before parsing JSON. Each downloaded member is then verified against the pinned
manifest, decompressed and length-checked. This prevents a downloaded manifest
from authorizing arbitrary replacement kernels.

The loader caches the manifest and up to 24 most-recently-used directions.
Concurrent requests for the same direction share one promise. Failed-promise
eviction uses identity checks to avoid deleting a newer cache entry.

Range audit for `(40 deg,120 deg)`:

- first request: manifest plus four `206` members, 1,229,830 transferred bytes;
- concurrent/repeated same direction: no additional request;
- full-file `200` fallback: PASS, but transfers 75,911,545 bytes;
- local Vinext behavior for the neutral-extension generator assets: `206`,
  exact `Content-Range`, `application/octet-stream`, and no automatic content
  encoding. Browser verification of a deployed Pages candidate remains gated
  by publication authorization.

GitHub Pages build output is about 110 MB, below the documented 1 GB Pages
limit; every file is below Git's 100 MiB hard limit. This is a technical
feasibility result, not publication authorization.

## CEGenGRB to CELoc bridge

Independent source audit established the literal bridge:

- CEGen `hNormEdepPix` is canonical ROOT histogram-bin/pixel-ID order `0..125`;
- counts and errors are copied without reordering or exposure rescaling;
- `pixelMcSumw2ErrorsPerSecond` are ROOT weighted-Monte-Carlo `Sumw2` errors,
  not Poisson measurement noise or confidence;
- all 101 deposited-energy edges must match CELoc exactly;
- the 100 deposited-energy contents are copied directly;
- background, duration, time profile and Poisson sampling are not added.

The lexicographic IDs in `upCal.txt` are now separate
`pixelPositionRowIds`. CELoc ignores that ID column and pairs canonical
histogram bin index `i` with raw `upCal` row `i`; this behavior is preserved for
C++ fidelity. The frozen localizer fixtures were migrated to canonical
histogram metadata without changing numeric arrays. Their new SHA-256 is
`a7be1de412ba02976986e4290192302f182da47014271778540bada553667e12`.

The 25 MiB CELoc template response is likewise transported as a neutral `.bin`
file containing unchanged gzip bytes (SHA-256
`87582b14a5f8c2e4affc4fddd70d59e940a3e54d31493022e6176f0adf7a2959`).
This prevents automatic server decoding of the compressed response before the
loader performs its explicit hash check and decompression.

An explicit test of the rejected old behavior (reordering counts by the
lexicographic `upCal` IDs) produced `zero-template-probability`.

## Runtime behavior and UI

Every configured or deterministic-random visible burst starts an asynchronous
lazy pipeline for its detector-local direction. The simulator remains smooth;
the pipeline result does not block the animation loop. The right rail reports:

- pipeline method and `PROVISIONAL`/CELoc ROOT-parity-pending status;
- requested detector direction;
- selected CEGen database direction;
- requested-to-selected quantization;
- Ritabrata/CELoc reconstructed RA/Dec;
- selected-database-to-reconstruction angular separation;
- requested-truth-to-reconstruction end-to-end angular separation;
- engineering positive-excess centroid RA/Dec and truth separation.

The three separations are deliberately distinct because CEGen generates the
selected database response, not the exact requested direction. No KS value is
shown as localization confidence. The pipeline currently uses Ritabrata's
default CPL `(A=0.026, alpha=-1.07, Epeak=756.4 keV)`; the existing visual
impact percentage is not silently mapped to physical flux.

## Numerical checks

### Smoke test

For request `(theta,phi)=(40 deg,120 deg)` and the default CPL:

```text
selected CEGen direction       (41.9897995 deg, 117.1460037 deg)
pixel total                    3788.387694 counts/s
deposited-energy total         3788.387697 counts/s
CELoc reconstructed theta      42.1875000 deg
CELoc reconstructed phi        124.8980026 deg
selected templates             1
maximum KS diagnostic          0.00433477
selected DB -> reconstruction  5.197572 deg
requested -> reconstruction    3.891019 deg
```

The KS diagnostic is not a localization probability or confidence.

### Deterministic random upper-hemisphere benchmark

- version: `ritabrata-random-upper-hemisphere-v1`
- seed: `20260827`
- PRNG: Mulberry32
- sampling: uniform solid angle, `theta=acos(U)`, `phi=360V`
- 128 attempted, 128 successful, 0 failed, failure rate 0
- percentiles: Hyndman-Fan type 7 empirical percentiles; not confidence limits

| Angular metric | median | p68 | p90 | p95 | max |
|---|---:|---:|---:|---:|---:|
| requested -> selected database | 2.1570 | 2.7883 | 3.8655 | 4.2930 | 6.5631 |
| selected database -> reconstructed CELoc | 2.3528 | 3.1245 | 4.4733 | 4.9760 | 6.2364 |
| requested -> reconstructed end-to-end | 3.4451 | 4.3465 | 5.6871 | 7.4121 | 11.0524 |

Units are degrees. Evidence:
`docs/evidence/ritabrata-pipeline-benchmark-20260827.json`, SHA-256
`0ce228f8c593be42bb0ced9ebb7b452c8fb3dbddf86b0e7b6b1480390e0fa595`.

Independent validation reran the benchmark byte-identically and recomputed the
PRNG, haversine separations and type-7 percentiles in Python. Maximum per-case
difference was `2.08e-12 deg`; maximum aggregate difference was
`1.74e-13 deg`.

## Reproduction and verification

```text
node --experimental-strip-types \
  scripts/promote-ritabrata-grb-web-assets.ts \
  /tmp/cegen-converted-20260826 /tmp/promoted

node --experimental-strip-types \
  scripts/migrate-ritabrata-localizer-pixel-metadata.ts

node --experimental-strip-types \
  scripts/validate-ritabrata-grb-generator.ts

node --experimental-strip-types \
  scripts/validate-ritabrata-localizer.ts

node --experimental-strip-types \
  scripts/benchmark-ritabrata-pipeline.ts

node --experimental-strip-types --test tests/*.test.ts
# PASS 138/138

npx tsc --noEmit
# PASS

npx eslint . --ignore-pattern dist --ignore-pattern .next
# PASS: 0 errors; one pre-existing no-img-element warning

GITHUB_PAGES=true NEXT_PUBLIC_BASE_PATH=/crystal-eye-simulator npx next build
# PASS: five static application routes

git diff --check
# PASS
```

`build:pages` now runs the exact CEGenGRB validator before the Pages build.
Browser smoke testing against the local Vinext application first exposed
automatic `Content-Encoding: gzip` handling for the generator files and then
the same problem for the CELoc template file. Both transport filenames were
changed from `.gz` to neutral `.bin` extensions while preserving the compressed
bytes and their SHA-256 hashes; manifests, converters and validators were
updated accordingly.

The final configured-boresight browser smoke test completed the full lazy
CEGenGRB-to-CELoc pipeline without a new application error and displayed:

```text
requested detector direction       (8.77 deg, 346.31 deg)
selected CEGen database direction  (8.42 deg,   0.94 deg)
requested -> selected quantization  2.21 deg
CELoc reconstruction               RA 90.40 deg, Dec 2.03 deg
selected DB -> reconstruction      0.14 deg
requested -> reconstruction        2.07 deg
positive-excess centroid error     1.81 deg
```

The only browser-console warning observed was the pre-existing Three.js
`THREE.Clock` deprecation warning. This smoke check verifies the browser data
path and presentation, not scientific validity or ROOT parity.

## Files

Principal additions/changes:

- `app/lib/ritabrata-provisional-pipeline.ts`
- `app/lib/ritabrata-grb-generator.ts`
- `app/lib/ritabrata-grb-generator-assets.ts`
- `app/lib/legacy-template-localizer.ts`
- `app/lib/ritabrata-localizer-assets.ts`
- `app/page.tsx`, `app/globals.css`
- `public/data/ritabrata-grb-generator/*`
- `public/data/ritabrata-localizer/ritabrata-localizer-samples.json`
- promotion, metadata-migration, validator and benchmark scripts
- focused bridge, Range/cache, trust-root and pipeline tests
- benchmark evidence and this record.

## Agents and tools

- Coordinator/implementation: `/root/port_ritabrata_grb_generator`
- Independent quantitative audit:
  `/root/port_ritabrata_grb_generator/validate_grb_celoc_bridge`
- Independent reproducibility audit:
  `/root/port_ritabrata_grb_generator/audit_cegen_runtime_assets`
- Tools: Git, SHA-256, Node/TypeScript, gzip, local HTTP Range test server,
  Next.js, ESLint and independent Python numerical recomputation.

## Limits and open gates

1. CELoc official ROOT outputs remain pending; this is a TypeScript
   characterization, not validated algorithm parity.
2. CEGen parity is pinned to one supplied ROOT golden fixture; it does not prove
   parity for the other 984 stored directions or other spectra.
3. Responses are source-only expected rates. There is no background, Poisson
   observation, duration or temporal GRB profile in this algorithmic path.
4. Generator and localizer templates are not an independent scientific test
   set. Benchmark metrics do not establish detector accuracy.
5. The `upCal` order anomaly and effective-area-row behavior require Ritabrata's
   confirmation.
6. Detector-to-spacecraft roll/attitude is not scientifically validated, so
   celestial RA/Dec remains simulation-frame output.
7. Upstream Geant4 version/configuration, physics list, cuts, seed and primary
   statistics are not fully captured; the web conversion is reproducible from
   the hashed ROOT input, not from primary simulation generation.
8. No repository LICENSE/NOTICE or explicit Ritabrata redistribution permission
   has been recorded. The assets are staged locally under author authorization,
   but **must not be pushed or deployed** until the author confirms that
   permission and approves publication.
